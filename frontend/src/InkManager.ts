export type StrokePoint = {
    x: number;
    y: number;
    pressure: number;
};

export type StrokeState = {
    id: number;
    points: StrokePoint[];
    color: string;
    brushSize: number;
    isHighlighter: boolean;
    isEraser: boolean;
};

export class InkManager {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private draftCanvas: HTMLCanvasElement;
    private draftCtx: CanvasRenderingContext2D;

    private activeStrokes: Map<number, StrokeState> = new Map();
    private dirty: boolean = false;
    private renderId: number | null = null;

    public color: string = '#000000';
    public brushSize: number = 4;
    public isHighlighter: boolean = false;
    public isEraser: boolean = false;

    constructor(canvas: HTMLCanvasElement, draftCanvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.draftCanvas = draftCanvas;

        const ctx = this.canvas.getContext('2d');
        const draftCtx = this.draftCanvas.getContext('2d');

        if (!ctx || !draftCtx) throw new Error("Could not get 2d context for canvases");
        this.ctx = ctx;
        this.draftCtx = draftCtx;

        this.resize();
        window.addEventListener('resize', this.resize.bind(this));
    }

    private resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth;
        const h = window.innerHeight;

        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        this.draftCanvas.width = w * dpr;
        this.draftCanvas.height = h * dpr;
        this.draftCanvas.style.width = w + 'px';
        this.draftCanvas.style.height = h + 'px';
        this.draftCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    private markDirty() {
        this.dirty = true;
        if (this.renderId === null) {
            this.renderId = requestAnimationFrame(this.render.bind(this));
        }
    }

    // Calculate width at a point based on pressure and speed
    private getWidth(stroke: StrokeState, index: number): number {
        const pts = stroke.points;
        const base = stroke.brushSize;

        // For eraser and highlighter, use constant width
        if (stroke.isEraser || stroke.isHighlighter) {
            return base;
        }

        const p = pts[index];

        // Pressure component (0.3 to 1.0 range mapped to 0.4 to 1.3)
        let pressure = p.pressure;
        if (pressure <= 0 || pressure >= 1) pressure = 0.5; // default for mouse
        const pressureFactor = 0.4 + pressure * 0.9;

        // Speed component: faster = thinner (fountain pen effect)
        let speedFactor = 1.0;
        if (index > 0) {
            const prev = pts[index - 1];
            const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
            // Clamp speed influence: fast strokes get thinner
            speedFactor = Math.max(0.5, Math.min(1.2, 1.3 - dist * 0.03));
        }

        // Taper at start and end
        const total = pts.length;
        const taperLen = Math.min(6, total / 3);
        let taperFactor = 1.0;
        if (index < taperLen) {
            taperFactor = 0.3 + 0.7 * (index / taperLen);
        } else if (index > total - taperLen - 1) {
            taperFactor = 0.3 + 0.7 * ((total - 1 - index) / taperLen);
        }

        return base * pressureFactor * speedFactor * taperFactor;
    }

    // Draw fountain pen style: variable-width stroke using filled shapes between segments
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
            if (stroke.isHighlighter) {
                targetCtx.globalAlpha = 0.5;
            }
        }

        // For eraser/highlighter, use simple smooth stroke
        if (stroke.isEraser || stroke.isHighlighter) {
            this.drawSimpleStroke(targetCtx, stroke);
            targetCtx.restore();
            return;
        }

        if (pts.length === 1) {
            // Single dot
            const w = this.getWidth(stroke, 0);
            targetCtx.beginPath();
            targetCtx.arc(pts[0].x, pts[0].y, w / 2, 0, Math.PI * 2);
            targetCtx.fill();
        } else {
            // Draw variable-width stroke using circles at each point + connecting quads
            targetCtx.lineCap = 'round';
            targetCtx.lineJoin = 'round';

            for (let i = 0; i < pts.length; i++) {
                const w = this.getWidth(stroke, i);

                // Draw filled circle at each point for smooth fill
                targetCtx.beginPath();
                targetCtx.arc(pts[i].x, pts[i].y, w / 2, 0, Math.PI * 2);
                targetCtx.fill();

                // Connect to next point with a tapered quad
                if (i < pts.length - 1) {
                    const w2 = this.getWidth(stroke, i + 1);
                    const p1 = pts[i];
                    const p2 = pts[i + 1];

                    // Direction perpendicular to segment
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const len = Math.hypot(dx, dy);
                    if (len < 0.5) continue;

                    const nx = -dy / len;
                    const ny = dx / len;

                    // Draw a quad (trapezoid) connecting the two circles
                    targetCtx.beginPath();
                    targetCtx.moveTo(p1.x + nx * w / 2, p1.y + ny * w / 2);
                    targetCtx.lineTo(p2.x + nx * w2 / 2, p2.y + ny * w2 / 2);
                    targetCtx.lineTo(p2.x - nx * w2 / 2, p2.y - ny * w2 / 2);
                    targetCtx.lineTo(p1.x - nx * w / 2, p1.y - ny * w / 2);
                    targetCtx.closePath();
                    targetCtx.fill();
                }
            }
        }

        targetCtx.restore();
    }

    // Simple constant-width stroke for eraser/highlighter
    private drawSimpleStroke(targetCtx: CanvasRenderingContext2D, stroke: StrokeState) {
        const pts = stroke.points;
        targetCtx.lineCap = 'round';
        targetCtx.lineJoin = 'round';
        targetCtx.lineWidth = stroke.brushSize;

        if (pts.length === 1) {
            targetCtx.beginPath();
            targetCtx.arc(pts[0].x, pts[0].y, stroke.brushSize / 2, 0, Math.PI * 2);
            targetCtx.fill();
        } else if (pts.length === 2) {
            targetCtx.beginPath();
            targetCtx.moveTo(pts[0].x, pts[0].y);
            targetCtx.lineTo(pts[1].x, pts[1].y);
            targetCtx.stroke();
        } else {
            targetCtx.beginPath();
            targetCtx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length - 1; i++) {
                const midX = (pts[i].x + pts[i + 1].x) / 2;
                const midY = (pts[i].y + pts[i + 1].y) / 2;
                targetCtx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
            }
            const last = pts[pts.length - 1];
            targetCtx.lineTo(last.x, last.y);
            targetCtx.stroke();
        }
    }

    private render() {
        this.renderId = null;
        if (!this.dirty) return;

        // Clear draft canvas
        const w = this.draftCanvas.width;
        const h = this.draftCanvas.height;
        this.draftCtx.save();
        this.draftCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.draftCtx.clearRect(0, 0, w, h);
        this.draftCtx.restore();

        for (const [id, stroke] of this.activeStrokes) {
            if (stroke.points.length === 0) continue;
            const isEraser = stroke.isEraser;
            const targetCtx = isEraser ? this.ctx : this.draftCtx;
            this.drawFountainPenStroke(targetCtx, stroke);
        }

        this.dirty = false;
    }

    public handlePointerDown(e: PointerEvent) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        this.activeStrokes.set(e.pointerId, {
            id: e.pointerId,
            points: [{ x: e.clientX, y: e.clientY, pressure: e.pressure }],
            color: this.color,
            brushSize: this.brushSize,
            isHighlighter: this.isHighlighter,
            isEraser: this.isEraser,
        });
        this.markDirty();
    }

    public handlePointerMove(e: PointerEvent) {
        if (!this.activeStrokes.has(e.pointerId)) return;

        const stroke = this.activeStrokes.get(e.pointerId)!;

        // Use coalesced events for smoother strokes
        if (e.getCoalescedEvents) {
            const coalesced = e.getCoalescedEvents();
            for (const ce of coalesced) {
                stroke.points.push({ x: ce.clientX, y: ce.clientY, pressure: ce.pressure });
            }
        } else {
            stroke.points.push({ x: e.clientX, y: e.clientY, pressure: e.pressure });
        }

        this.markDirty();
    }

    public handlePointerUp(e: PointerEvent) {
        if (!this.activeStrokes.has(e.pointerId)) return;
        const stroke = this.activeStrokes.get(e.pointerId)!;

        // Commit to main canvas
        if (!stroke.isEraser && stroke.points.length > 0) {
            this.drawFountainPenStroke(this.ctx, stroke);
        }

        this.activeStrokes.delete(e.pointerId);
        this.markDirty();
    }

    public handlePointerCancel(e: PointerEvent) {
        this.handlePointerUp(e);
    }

    public clear() {
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();

        this.draftCtx.save();
        this.draftCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.draftCtx.clearRect(0, 0, this.draftCanvas.width, this.draftCanvas.height);
        this.draftCtx.restore();

        this.activeStrokes.clear();
    }
}
