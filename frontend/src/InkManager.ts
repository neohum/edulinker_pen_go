import {
    recognizeShapeCandidates,
    recognizeShapeCandidatesMulti,
    mergeShapeCandidates,
    scaleShape,
    SHAPE_AUTO_APPLY_THRESHOLD,
    SHAPE_MIN_OFFER_THRESHOLD,
    type ShapeCandidate,
    type ShapeResult,
} from './ShapeRecognizer';

const SHAPE_GROUP_IDLE_FIRST_MS = 500;
const SHAPE_GROUP_IDLE_MULTI_MS = 1500;

export type ShapeAmbiguousInfo = {
    candidates: ShapeCandidate[];
    bbox: { x: number; y: number; w: number; h: number };
    // Smart-pen text candidates (filled async, after the chooser opens).
    textCandidates?: string[];
};

function bboxOf(pts: { x: number; y: number }[]): { x: number; y: number; w: number; h: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function manufactureFallbackCandidates(bbox: { x: number; y: number; w: number; h: number; }): ShapeCandidate[] {
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    return [
        { shape: { type: 'rectangle', x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h }, score: 0.10 },
        { shape: { type: 'circle', center: { x: cx, y: cy }, radius: Math.min(bbox.w, bbox.h) / 2 }, score: 0.08 },
        { shape: { type: 'triangle', vertices: [ { x: bbox.x, y: bbox.y + bbox.h }, { x: bbox.x + bbox.w, y: bbox.y + bbox.h }, { x: cx, y: bbox.y } ] }, score: 0.06 },
    ];
}

export type StrokePoint = { x: number; y: number; pressure: number; timestamp: number; };

export type StrokeState = {
    id: number;
    points: StrokePoint[];
    color: string;
    brushSize: number;
    isHighlighter: boolean;
    isEraser: boolean;
};

export type DrawElement =
    | { type: 'shape'; id: string; shape: ShapeResult; strokeConfig: { color: string; brushSize: number } }
    | { type: 'text'; id: string; text: string; x: number; y: number; w: number; h: number; font: string; color: string }
    | { type: 'ink'; id: string; stroke: StrokeState };

export class InkManager {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private objectCanvas: HTMLCanvasElement;
    private objectCtx: CanvasRenderingContext2D;
    private draftCanvas: HTMLCanvasElement;
    private draftCtx: CanvasRenderingContext2D;
    
    public activeTool: string = 'pen';
    private activeStrokes: Map<number, StrokeState> = new Map();
    private dirty: boolean = false;
    private renderId: number | null = null;

    public elements: DrawElement[] = [];
    public selectedElementIds: Set<string> = new Set();

    public color: string = '#000000';
    public brushSize: number = 4;
    public isHighlighter: boolean = false;
    public isEraser: boolean = false;
    public recognizeShapes: boolean = false;
    public textMode: boolean = false;
    public smartMode: boolean = false;
    public textFont: string = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

    private pendingTextStrokes: StrokePoint[][] = [];
    private preTextSnapshot: ImageData | null = null;

    private pendingShapeGroup: { snapshot: ImageData; strokes: StrokeState[]; } | null = null;
    private shapeGroupTimer: number | null = null;

    private pendingShapeChoice: { snapshot: ImageData; stroke: StrokeState; bbox: { x: number; y: number; w: number; h: number }; } | null = null;
    private pendingShapeChoiceTopShape: ShapeResult | null = null;
    public onShapeAmbiguous: ((info: ShapeAmbiguousInfo) => void) | null = null;
    public onRequestTextRecognition: ((strokesJson: string) => Promise<string[]>) | null = null;

    // Last committed element (shape / text / grade etc.). Tracked so the
    // post-commit +/- resize buttons know what to scale, and so the floating
    // resize widget can position itself near it.
    private lastCommittedElementId: string | null = null;
    public onLastCommitChange:
        | ((info: { bbox: { x: number; y: number; w: number; h: number }; scale: number } | null) => void)
        | null = null;

    private shapeGuides: any[] = [];

    constructor(canvas: HTMLCanvasElement, objectCanvas: HTMLCanvasElement, draftCanvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.objectCanvas = objectCanvas;
        this.draftCanvas = draftCanvas;
        const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        const objectCtx = this.objectCanvas.getContext('2d');
        const draftCtx = this.draftCanvas.getContext('2d');
        if (!ctx || !objectCtx || !draftCtx) throw new Error("Could not get 2d context");
        this.ctx = ctx; this.objectCtx = objectCtx; this.draftCtx = draftCtx;
        this.resize();
        window.addEventListener('resize', this.resize.bind(this));
    }

    private resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.canvas.width = w * dpr; this.canvas.height = h * dpr; this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (this.objectCanvas) { this.objectCanvas.width = w * dpr; this.objectCanvas.height = h * dpr; this.objectCanvas.style.width = w + 'px'; this.objectCanvas.style.height = h + 'px'; this.objectCtx.setTransform(dpr, 0, 0, dpr, 0, 0); }
        this.draftCanvas.width = w * dpr; this.draftCanvas.height = h * dpr; this.draftCanvas.style.width = w + 'px'; this.draftCanvas.style.height = h + 'px'; this.draftCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.redrawElements();
    }

    private markDirty() {
        this.dirty = true;
        if (this.renderId === null) this.renderId = requestAnimationFrame(this.render.bind(this));
    }

    private getWidth(stroke: StrokeState, index: number): number {
        const pts = stroke.points;
        const base = stroke.brushSize;
        if (stroke.isEraser || stroke.isHighlighter) return base;
        const p = pts[index];
        let pressure = p.pressure;
        if (pressure <= 0 || pressure >= 1) pressure = 0.5;
        const pressureFactor = 0.4 + pressure * 0.9;
        let speedFactor = 1.0;
        if (index > 0) {
            const prev = pts[index - 1];
            const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
            speedFactor = Math.max(0.5, Math.min(1.2, 1.3 - dist * 0.03));
        }
        const total = pts.length;
        const taperLen = Math.min(6, total / 3);
        let taperFactor = 1.0;
        if (index < taperLen) taperFactor = 0.3 + 0.7 * (index / taperLen);
        else if (index > total - taperLen - 1) taperFactor = 0.3 + 0.7 * ((total - 1 - index) / taperLen);
        return base * pressureFactor * speedFactor * taperFactor;
    }

    private drawFountainPenStroke(targetCtx: CanvasRenderingContext2D, stroke: StrokeState) {
        const pts = stroke.points;
        if (pts.length === 0) return;
        targetCtx.save();
        if (stroke.isEraser) {
            targetCtx.globalCompositeOperation = 'destination-out';
            targetCtx.fillStyle = 'rgba(0,0,0,1)';
            targetCtx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            targetCtx.globalCompositeOperation = 'source-over';
            targetCtx.fillStyle = stroke.color;
            targetCtx.strokeStyle = stroke.color;
            if (stroke.isHighlighter) targetCtx.globalAlpha = 0.5;
        }
        if (stroke.isEraser || stroke.isHighlighter) {
            this.drawSimpleStroke(targetCtx, stroke);
            targetCtx.restore();
            return;
        }
        if (pts.length === 1) {
            const w = this.getWidth(stroke, 0);
            targetCtx.beginPath(); targetCtx.arc(pts[0].x, pts[0].y, w / 2, 0, Math.PI * 2); targetCtx.fill();
        } else {
            targetCtx.lineCap = 'round'; targetCtx.lineJoin = 'round';
            for (let i = 0; i < pts.length; i++) {
                const w = this.getWidth(stroke, i);
                targetCtx.beginPath(); targetCtx.arc(pts[i].x, pts[i].y, w / 2, 0, Math.PI * 2); targetCtx.fill();
                if (i < pts.length - 1) {
                    const w2 = this.getWidth(stroke, i + 1);
                    const p1 = pts[i], p2 = pts[i + 1];
                    const dx = p2.x - p1.x, dy = p2.y - p1.y;
                    const len = Math.hypot(dx, dy);
                    if (len < 0.5) continue;
                    const nx = -dy / len, ny = dx / len;
                    targetCtx.beginPath();
                    targetCtx.moveTo(p1.x + nx * w / 2, p1.y + ny * w / 2);
                    targetCtx.lineTo(p2.x + nx * w2 / 2, p2.y + ny * w2 / 2);
                    targetCtx.lineTo(p2.x - nx * w2 / 2, p2.y - ny * w2 / 2);
                    targetCtx.lineTo(p1.x - nx * w / 2, p1.y - ny * w / 2);
                    targetCtx.closePath(); targetCtx.fill();
                }
            }
        }
        targetCtx.restore();
    }

    private drawSimpleStroke(targetCtx: CanvasRenderingContext2D, stroke: StrokeState) {
        const pts = stroke.points;
        targetCtx.lineCap = 'round'; targetCtx.lineJoin = 'round'; targetCtx.lineWidth = stroke.brushSize;
        if (pts.length === 1) {
            targetCtx.beginPath(); targetCtx.arc(pts[0].x, pts[0].y, stroke.brushSize / 2, 0, Math.PI * 2); targetCtx.fill();
        } else if (pts.length === 2) {
            targetCtx.beginPath(); targetCtx.moveTo(pts[0].x, pts[0].y); targetCtx.lineTo(pts[1].x, pts[1].y); targetCtx.stroke();
        } else {
            targetCtx.beginPath(); targetCtx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length - 1; i++) {
                const midX = (pts[i].x + pts[i + 1].x) / 2, midY = (pts[i].y + pts[i + 1].y) / 2;
                targetCtx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
            }
            const last = pts[pts.length - 1];
            targetCtx.lineTo(last.x, last.y); targetCtx.stroke();
        }
    }

    public redrawElements() {
        if (!this.objectCanvas || !this.objectCtx) return;
        const w = this.objectCanvas.width;
        const h = this.objectCanvas.height;
        this.objectCtx.save();
        this.objectCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.objectCtx.clearRect(0, 0, w, h);
        
        for (const el of this.elements) {
            if (el.type === 'shape') {
                this.drawRecognizedShape(this.objectCtx, el.shape, { color: el.strokeConfig.color, brushSize: el.strokeConfig.brushSize } as any);
            } else if (el.type === 'text') {
                this.drawTextElement(this.objectCtx, el);
            }
            if (this.selectedElementIds.has(el.id)) {
                this.drawSelectionBox(this.objectCtx, el);
            }
        }
        this.objectCtx.restore();
    }

    private drawTextElement(ctx: CanvasRenderingContext2D, el: any) {
        ctx.save();
        ctx.font = el.font;
        ctx.fillStyle = el.color;
        ctx.textBaseline = 'top';
        ctx.fillText(el.text, el.x, el.y);
        ctx.restore();
    }

    private drawSelectionBox(ctx: CanvasRenderingContext2D, el: DrawElement) {
        let x = 0, y = 0, w = 0, h = 0;
        if (el.type === 'text') {
            x = el.x; y = el.y; w = el.w; h = el.h;
        } else if (el.type === 'shape') {
            const bbox = this.getShapeBoundingBox(el.shape);
            x = bbox.x; y = bbox.y; w = bbox.w; h = bbox.h;
        } else return;

        const pad = 6;
        ctx.save();
        ctx.strokeStyle = '#4A90E2'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
        ctx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
        ctx.fillStyle = '#FF3B30'; ctx.beginPath(); ctx.arc(x + w + pad, y - pad, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'white'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('X', x + w + pad, y - pad);
        ctx.restore();
    }

    private getShapeBoundingBox(shape: ShapeResult) {
        switch (shape.type) {
            case 'line': case 'arrow': return { x: Math.min(shape.from.x, shape.to.x), y: Math.min(shape.from.y, shape.to.y), w: Math.abs(shape.to.x - shape.from.x), h: Math.abs(shape.to.y - shape.from.y) };
            case 'circle': return { x: shape.center.x - shape.radius, y: shape.center.y - shape.radius, w: shape.radius * 2, h: shape.radius * 2 };
            case 'ellipse': return { x: shape.center.x - shape.rx, y: shape.center.y - shape.ry, w: shape.rx * 2, h: shape.ry * 2 };
            case 'rectangle': case 'heart': return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
            case 'triangle': case 'rotatedRectangle': case 'parallelogram':
                const xs = shape.vertices.map(v => v.x); const ys = shape.vertices.map(v => v.y);
                const minX = Math.min(...xs), minY = Math.min(...ys); return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
            default: return { x: 0, y: 0, w: 0, h: 0 };
        }
    }

    public deleteSelectedElements() {
        this.elements = this.elements.filter(el => !this.selectedElementIds.has(el.id));
        this.selectedElementIds.clear();
        this.redrawElements();
    }

    private render() {
        this.renderId = null;
        if (!this.dirty) return;
        const w = this.draftCanvas.width, h = this.draftCanvas.height;
        this.draftCtx.save(); this.draftCtx.setTransform(1, 0, 0, 1, 0, 0); this.draftCtx.clearRect(0, 0, w, h); this.draftCtx.restore();
        for (const [id, stroke] of this.activeStrokes) {
            if (stroke.points.length === 0) continue;
            const targetCtx = stroke.isEraser ? this.ctx : this.draftCtx;
            this.drawFountainPenStroke(targetCtx, stroke);
        }
        this.dirty = false;
    }

    public handlePointerDown(e: PointerEvent) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (this.activeTool === 'selector') { this.handleSelectorDown(e); return; }

        if (this.pendingShapeChoice) {
            const topShape = this.pendingShapeChoiceTopShape;
            if (topShape) this.applyShapeChoice(topShape);
            else this.pendingShapeChoice = null;
            if (this.onShapeAmbiguous) this.onShapeAmbiguous({ candidates: [], bbox: { x: 0, y: 0, w: 0, h: 0 } });
            this.pendingShapeChoiceTopShape = null;
        }

        // Starting a new stroke closes the post-commit resize window.
        this.finalizeLastCommit();

        if (this.activeTool === 'textpen' && !this.preTextSnapshot) {
            this.preTextSnapshot = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        }

        this.activeStrokes.set(e.pointerId, {
            id: e.pointerId,
            points: [{ x: e.clientX, y: e.clientY, pressure: e.pressure, timestamp: Date.now() }],
            color: this.color, brushSize: this.brushSize, isHighlighter: this.isHighlighter, isEraser: this.isEraser,
        });
        this.markDirty();
    }

    private handleSelectorDown(e: PointerEvent) {
        for (const id of this.selectedElementIds) {
            const el = this.elements.find(e => e.id === id);
            if (el) {
                let x = 0, y = 0, w = 0, h = 0;
                if (el.type === 'text') { x = el.x; y = el.y; w = el.w; h = el.h; }
                else if (el.type === 'shape') { const bbox = this.getShapeBoundingBox(el.shape); x = bbox.x; y = bbox.y; w = bbox.w; h = bbox.h; }
                const pad = 6;
                if (Math.hypot(e.clientX - (x + w + pad), e.clientY - (y - pad)) <= 12) {
                    this.deleteSelectedElements(); return;
                }
            }
        }
        this.selectedElementIds.clear();
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const el = this.elements[i];
            let x = 0, y = 0, w = 0, h = 0;
            if (el.type === 'text') { x = el.x; y = el.y; w = el.w; h = el.h; }
            else if (el.type === 'shape') { const bbox = this.getShapeBoundingBox(el.shape); x = bbox.x; y = bbox.y; w = bbox.w; h = bbox.h; }
            const pad = 6;
            if (e.clientX >= x - pad && e.clientX <= x + w + pad && e.clientY >= y - pad && e.clientY <= y + h + pad) {
                this.selectedElementIds.add(el.id); break;
            }
        }
        this.redrawElements();
    }

    public handlePointerMove(e: PointerEvent) {
        if (!this.activeStrokes.has(e.pointerId)) return;
        const stroke = this.activeStrokes.get(e.pointerId)!;
        if (e.getCoalescedEvents) {
            for (const ce of e.getCoalescedEvents()) stroke.points.push({ x: ce.clientX, y: ce.clientY, pressure: ce.pressure, timestamp: Date.now() });
        } else {
            stroke.points.push({ x: e.clientX, y: e.clientY, pressure: e.pressure, timestamp: Date.now() });
        }
        this.markDirty();
    }

    public handlePointerUp(e: PointerEvent) {
        if (this.activeTool === 'selector') return;
        if (!this.activeStrokes.has(e.pointerId)) return;
        const stroke = this.activeStrokes.get(e.pointerId)!;
        
        if (!stroke.isEraser && stroke.points.length > 0) this.drawFountainPenStroke(this.ctx, stroke);
        this.activeStrokes.delete(e.pointerId);
        this.markDirty();

        if (stroke.isEraser) return;

        if (this.activeTool === 'textpen') {
            this.pendingTextStrokes.push(stroke.points); return;
        }

        if (this.recognizeShapes || this.smartMode) {
            if (!this.pendingShapeGroup) this.pendingShapeGroup = { snapshot: this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height), strokes: [] };
            this.pendingShapeGroup.strokes.push(stroke);
            if (this.shapeGroupTimer !== null) window.clearTimeout(this.shapeGroupTimer);
            this.shapeGroupTimer = window.setTimeout(() => this.flushShapeGroup(), this.pendingShapeGroup.strokes.length === 1 ? SHAPE_GROUP_IDLE_FIRST_MS : SHAPE_GROUP_IDLE_MULTI_MS);
        }
    }

    private async flushShapeGroup() {
        if (!this.pendingShapeGroup) return;
        const { snapshot, strokes } = this.pendingShapeGroup;
        this.pendingShapeGroup = null; this.shapeGroupTimer = null;
        const allPoints = strokes.flatMap(s => s.points);
        if (allPoints.length < 2) return;
        const bbox = bboxOf(allPoints);
        
        let candidates = recognizeShapeCandidatesMulti(strokes.map(s => s.points));
        if (candidates.length === 0) candidates = manufactureFallbackCandidates(bbox);
        const top = candidates[0]; const repStroke = strokes[0];

        if (top.score >= SHAPE_AUTO_APPLY_THRESHOLD) {
            this.ctx.save(); this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.putImageData(snapshot, 0, 0); this.ctx.restore();
            this.elements.push({ type: 'shape', id: crypto.randomUUID(), shape: top.shape, strokeConfig: { color: repStroke.color, brushSize: repStroke.brushSize } });
            this.redrawElements(); this.rememberShapeGuide(top.shape, repStroke);
        } else if (top.score >= SHAPE_MIN_OFFER_THRESHOLD) {
            this.pendingShapeChoice = { snapshot, stroke: repStroke, bbox };
            this.pendingShapeChoiceTopShape = top.shape;
            if (this.onShapeAmbiguous) this.onShapeAmbiguous({ candidates, bbox });
        }
    }

    public applyShapeChoice(shape: ShapeResult) {
        if (!this.pendingShapeChoice) return;
        const { snapshot, stroke } = this.pendingShapeChoice;
        this.pendingShapeChoice = null; this.pendingShapeChoiceTopShape = null;
        this.ctx.save(); this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.putImageData(snapshot, 0, 0); this.ctx.restore();
        const id = crypto.randomUUID();
        this.elements.push({ type: 'shape', id, shape, strokeConfig: { color: stroke.color, brushSize: stroke.brushSize } });
        this.redrawElements(); this.rememberShapeGuide(shape, stroke); this.markDirty();
        this.lastCommittedElementId = id;
        this.notifyLastCommit();
    }

    public applyTextChoice(text: string) {
        if (!this.pendingShapeChoice) return;
        const { snapshot, bbox } = this.pendingShapeChoice;
        this.pendingShapeChoice = null; this.pendingShapeChoiceTopShape = null;
        this.ctx.save(); this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.putImageData(snapshot, 0, 0); this.ctx.restore();
        if (text) {
            const bboxH = Math.max(16, bbox.h); let fontPx = Math.round(bboxH * 0.85);
            this.ctx.save();
            for (let i = 0; i < 6; i++) {
                this.ctx.font = `${fontPx}px ${this.textFont}`;
                const tw = this.ctx.measureText(text).width;
                if (bbox.w <= 0 || tw <= bbox.w * 1.05) break;
                fontPx = Math.max(12, Math.round(fontPx * (bbox.w / tw)));
            }
            const id = crypto.randomUUID();
            this.elements.push({ type: 'text', id, text, x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h, font: `${fontPx}px ${this.textFont}`, color: this.color });
            this.ctx.restore(); this.redrawElements();
            this.lastCommittedElementId = id;
            this.notifyLastCommit();
        }
        this.markDirty();
    }

    public keepStrokeChoice() { this.pendingShapeChoice = null; this.pendingShapeChoiceTopShape = null; }
    public cancelPendingShapeChoice() { this.pendingShapeChoice = null; this.pendingShapeChoiceTopShape = null; }
    public cancelPendingShapeGroup() {
        if (this.shapeGroupTimer !== null) { window.clearTimeout(this.shapeGroupTimer); this.shapeGroupTimer = null; }
        this.pendingShapeGroup = null;
    }
    private restoreMainSnapshot() {
        if (!this.preTextSnapshot) return;
        this.ctx.save(); this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.putImageData(this.preTextSnapshot, 0, 0); this.ctx.restore();
    }
    public hasPendingText(): boolean { return this.pendingTextStrokes.length > 0; }
    public getPendingTextStrokesJSON(): string {
        return JSON.stringify(this.pendingTextStrokes.map(pts => ({ points: pts.map(p => ({ x: p.x, y: p.y, timestamp: p.timestamp })) })));
    }
    public commitRecognizedText(text: string, x: number, y: number, w: number, h: number, alternatives?: string[]) {
        this.restoreMainSnapshot();
        this.pendingTextStrokes = [];
        if (!text) { this.markDirty(); return; }
        const bboxH = Math.max(16, h); let fontPx = Math.round(bboxH * 0.85);
        this.ctx.save();
        for (let i = 0; i < 6; i++) {
            this.ctx.font = `${fontPx}px ${this.textFont}`;
            const tw = this.ctx.measureText(text).width;
            if (w <= 0 || tw <= w * 1.05) break;
            fontPx = Math.max(12, Math.round(fontPx * (w / tw)));
        }
        const id = crypto.randomUUID();
        this.elements.push({ type: 'text', id, text, x, y, w, h, font: `${fontPx}px ${this.textFont}`, color: this.color });
        this.ctx.restore(); this.redrawElements(); this.markDirty();
        this.lastCommittedElementId = id;
        this.notifyLastCommit();
    }

    public discardPendingText() { this.pendingTextStrokes = []; this.preTextSnapshot = null; }
    public finalizeTextCommit() { this.preTextSnapshot = null; }
    private rememberShapeGuide(shape: ShapeResult, stroke: StrokeState) { this.shapeGuides.push({ shape, stroke }); }

    private formatGradeNumber(n: number) { return n % 1 === 0 ? n.toString() : n.toFixed(1); }

    public drawMathGradeResult(grade: { kind: 'waiting' | 'graded'; expected: number; correct?: boolean }, x: number, y: number, w: number, h: number) {
        const label = grade.kind === 'waiting' ? `= ${this.formatGradeNumber(grade.expected)}` : grade.correct ? 'OK' : `X ${this.formatGradeNumber(grade.expected)}`;
        const fontPx = Math.max(12, Math.round(h * 0.8));
        this.ctx.save();
        this.ctx.font = `bold ${fontPx}px ${this.textFont}`;
        this.ctx.fillStyle = grade.kind === 'waiting' ? '#FFA500' : grade.correct ? '#00AA00' : '#FF0000';
        this.ctx.textBaseline = 'top';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(label, x + w + 10, y);
        this.ctx.restore();
        const id = crypto.randomUUID();
        this.elements.push({ type: 'text', id, text: label, x: x + w + 10, y, w: w, h: h, font: `bold ${fontPx}px ${this.textFont}`, color: this.ctx.fillStyle });
        this.redrawElements();
        this.markDirty();
        this.lastCommittedElementId = id;
        this.notifyLastCommit();
    }

    private drawRecognizedShape(targetCtx: CanvasRenderingContext2D, shape: ShapeResult, stroke: StrokeState) {
        targetCtx.save();
        targetCtx.strokeStyle = stroke.color; targetCtx.fillStyle = stroke.color; targetCtx.lineWidth = stroke.brushSize;
        targetCtx.lineCap = 'round'; targetCtx.lineJoin = 'round';
        switch (shape.type) {
            case 'line': targetCtx.beginPath(); targetCtx.moveTo(shape.from.x, shape.from.y); targetCtx.lineTo(shape.to.x, shape.to.y); targetCtx.stroke(); break;
            case 'arrow':
                targetCtx.beginPath(); targetCtx.moveTo(shape.from.x, shape.from.y); targetCtx.lineTo(shape.to.x, shape.to.y); targetCtx.stroke();
                const angle = Math.atan2(shape.to.y - shape.from.y, shape.to.x - shape.from.x); const headLen = Math.max(12, stroke.brushSize * 4); const headAng = Math.PI / 6;
                targetCtx.beginPath(); targetCtx.moveTo(shape.to.x, shape.to.y); targetCtx.lineTo(shape.to.x - headLen * Math.cos(angle - headAng), shape.to.y - headLen * Math.sin(angle - headAng));
                targetCtx.moveTo(shape.to.x, shape.to.y); targetCtx.lineTo(shape.to.x - headLen * Math.cos(angle + headAng), shape.to.y - headLen * Math.sin(angle + headAng)); targetCtx.stroke(); break;
            case 'circle': targetCtx.beginPath(); targetCtx.arc(shape.center.x, shape.center.y, shape.radius, 0, Math.PI * 2); targetCtx.stroke(); break;
            case 'ellipse': targetCtx.beginPath(); targetCtx.ellipse(shape.center.x, shape.center.y, shape.rx, shape.ry, 0, 0, Math.PI * 2); targetCtx.stroke(); break;
            case 'rectangle': targetCtx.strokeRect(shape.x, shape.y, shape.w, shape.h); break;
            case 'triangle': targetCtx.beginPath(); targetCtx.moveTo(shape.vertices[0].x, shape.vertices[0].y); targetCtx.lineTo(shape.vertices[1].x, shape.vertices[1].y); targetCtx.lineTo(shape.vertices[2].x, shape.vertices[2].y); targetCtx.closePath(); targetCtx.stroke(); break;
            case 'rotatedRectangle': case 'parallelogram': targetCtx.beginPath(); targetCtx.moveTo(shape.vertices[0].x, shape.vertices[0].y); for (let i = 1; i < shape.vertices.length; i++) targetCtx.lineTo(shape.vertices[i].x, shape.vertices[i].y); targetCtx.closePath(); targetCtx.stroke(); break;
            case 'heart':
                const cx = shape.x + shape.w / 2, topY = shape.y + shape.h * 0.25, bottomY = shape.y + shape.h;
                targetCtx.beginPath(); targetCtx.moveTo(cx, topY); targetCtx.bezierCurveTo(cx - shape.w * 0.55, shape.y - shape.h * 0.05, shape.x - shape.w * 0.05, shape.y + shape.h * 0.55, cx, bottomY);
                targetCtx.bezierCurveTo(shape.x + shape.w + shape.w * 0.05, shape.y + shape.h * 0.55, cx + shape.w * 0.55, shape.y - shape.h * 0.05, cx, topY); targetCtx.closePath(); targetCtx.stroke(); break;
        }
        targetCtx.restore();
    }

    // Stub overlays — for now they just commit the recognized text as a regular
    // text element. The label content already contains the degree symbol /
    // unit suffix from the recognizer, so the visual result is correct without
    // extra decorations. (A future iteration can add arc / tick adornments.)
    public drawAngleGuide(text: string, x: number, y: number, w: number, h: number) {
        this.commitRecognizedText(text, x, y, w, h);
    }
    public drawDimensionGuide(text: string, x: number, y: number, w: number, h: number) {
        this.commitRecognizedText(text, x, y, w, h);
    }

    // ===== Post-commit resize =====

    private elementBbox(el: DrawElement): { x: number; y: number; w: number; h: number } | null {
        if (el.type === 'text') return { x: el.x, y: el.y, w: el.w, h: el.h };
        if (el.type === 'shape') return this.getShapeBoundingBox(el.shape);
        return null;
    }

    private notifyLastCommit() {
        if (!this.onLastCommitChange) return;
        if (!this.lastCommittedElementId) { this.onLastCommitChange(null); return; }
        const el = this.elements.find(e => e.id === this.lastCommittedElementId);
        const bbox = el ? this.elementBbox(el) : null;
        this.onLastCommitChange(bbox ? { bbox, scale: 1 } : null);
    }

    /** Multiply the most recently committed element's size by `factor`. The
     *  element's geometry is mutated in place around its current centroid, then
     *  redrawElements() repaints everything cleanly. */
    public resizeLastElement(factor: number): boolean {
        if (!this.lastCommittedElementId) return false;
        const el = this.elements.find(e => e.id === this.lastCommittedElementId);
        if (!el) return false;
        if (factor <= 0 || !Number.isFinite(factor)) return false;

        if (el.type === 'shape') {
            const bbox = this.getShapeBoundingBox(el.shape);
            const anchor = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
            el.shape = scaleShape(el.shape, anchor, factor);
        } else if (el.type === 'text') {
            // Scale font size. font is "<weight?> <px>px <family>"
            const m = el.font.match(/^(.*?)(\d+(?:\.\d+)?)px\s+(.*)$/);
            if (!m) return false;
            const prefix = m[1]; // may be empty or "bold "
            const oldPx = parseFloat(m[2]);
            const family = m[3];
            const newPx = Math.max(8, Math.min(400, oldPx * factor));
            // Re-measure text width and update bbox so the resize widget stays
            // anchored to the visible text.
            this.ctx.save();
            this.ctx.font = `${prefix}${newPx}px ${family}`;
            const newW = this.ctx.measureText(el.text).width;
            this.ctx.restore();
            // Anchor: keep the text's center stable.
            const cx = el.x + el.w / 2;
            const cy = el.y + el.h / 2;
            const newH = el.h * (newPx / oldPx);
            el.x = cx - newW / 2;
            el.y = cy - newH / 2;
            el.w = newW;
            el.h = newH;
            el.font = `${prefix}${newPx}px ${family}`;
        } else {
            return false;
        }
        this.redrawElements();
        this.notifyLastCommit();
        return true;
    }

    public finalizeLastCommit() {
        if (this.lastCommittedElementId !== null) {
            this.lastCommittedElementId = null;
            this.notifyLastCommit();
        }
    }

    public handlePointerCancel(e: PointerEvent) { this.handlePointerUp(e); }
    public clear() {
        this.ctx.save(); this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.ctx.restore();
        if (this.objectCtx) { this.objectCtx.save(); this.objectCtx.setTransform(1, 0, 0, 1, 0, 0); this.objectCtx.clearRect(0, 0, this.objectCanvas.width, this.objectCanvas.height); this.objectCtx.restore(); }
        this.draftCtx.save(); this.draftCtx.setTransform(1, 0, 0, 1, 0, 0); this.draftCtx.clearRect(0, 0, this.draftCanvas.width, this.draftCanvas.height); this.draftCtx.restore();
        this.elements = []; this.selectedElementIds.clear(); this.redrawElements();
        this.activeStrokes.clear(); this.shapeGuides = []; this.discardPendingText(); this.cancelPendingShapeGroup(); this.cancelPendingShapeChoice();
        this.finalizeLastCommit();
    }
}
