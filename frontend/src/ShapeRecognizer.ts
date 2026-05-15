// Heuristic shape recognizer for pen strokes.
// Recognizes: line, arrow, circle (or ellipse), rectangle, triangle.
// Returns a clean vectorized result so the caller can redraw it.

export type Point = { x: number; y: number };

export type ShapeResult =
    | { type: 'line'; from: Point; to: Point }
    | { type: 'arrow'; from: Point; to: Point }
    | { type: 'circle'; center: Point; radius: number }
    | { type: 'ellipse'; center: Point; rx: number; ry: number }
    | { type: 'rectangle'; x: number; y: number; w: number; h: number }
    | { type: 'rotatedRectangle'; vertices: [Point, Point, Point, Point] }
    | { type: 'parallelogram'; vertices: [Point, Point, Point, Point] }
    | { type: 'triangle'; vertices: [Point, Point, Point] }
    | { type: 'heart'; x: number; y: number; w: number; h: number }
    | { type: 'unknown' };

const RESAMPLE_N = 64;

function pathLength(pts: Point[]): number {
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
        len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return len;
}

function resample(pts: Point[], n: number): Point[] {
    if (pts.length < 2) return pts.slice();
    const interval = pathLength(pts) / (n - 1);
    const out: Point[] = [{ x: pts[0].x, y: pts[0].y }];
    let prev: Point = { x: pts[0].x, y: pts[0].y };
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
        let curr: Point = pts[i];
        let d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
        if (d === 0) continue;
        while (acc + d >= interval && out.length < n - 1) {
            const remain = interval - acc;
            const t = remain / d;
            const np: Point = {
                x: prev.x + (curr.x - prev.x) * t,
                y: prev.y + (curr.y - prev.y) * t,
            };
            out.push(np);
            prev = np;
            d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
            acc = 0;
        }
        acc += d;
        prev = curr;
    }
    while (out.length < n) out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
    return out;
}

function boundingBox(pts: Point[]) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function centroid(pts: Point[]): Point {
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    return { x: sx / pts.length, y: sy / pts.length };
}

// Perpendicular distance from point p to segment a-b.
function perpDist(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.hypot(p.x - projX, p.y - projY);
}

// Douglas-Peucker simplification.
function simplify(pts: Point[], tolerance: number): Point[] {
    if (pts.length < 3) return pts.slice();
    const keep = new Array(pts.length).fill(false);
    keep[0] = true;
    keep[pts.length - 1] = true;
    const stack: [number, number][] = [[0, pts.length - 1]];
    while (stack.length) {
        const [s, e] = stack.pop()!;
        let maxD = 0;
        let idx = -1;
        for (let i = s + 1; i < e; i++) {
            const d = perpDist(pts[i], pts[s], pts[e]);
            if (d > maxD) { maxD = d; idx = i; }
        }
        if (maxD > tolerance && idx !== -1) {
            keep[idx] = true;
            stack.push([s, idx], [idx, e]);
        }
    }
    const out: Point[] = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
}

// Check if shape is closed: endpoints near each other relative to total path length.
function isClosed(pts: Point[], totalLen: number, diagonal: number): boolean {
    const startEnd = Math.hypot(
        pts[0].x - pts[pts.length - 1].x,
        pts[0].y - pts[pts.length - 1].y,
    );
    // Closed if gap is small both relative to perimeter and bbox diagonal.
    return startEnd < 0.25 * totalLen && startEnd < 0.3 * diagonal;
}

// Coefficient of variation of distances from centroid -> low = circular.
function radialVariance(pts: Point[], c: Point): { mean: number; cv: number } {
    const ds = pts.map(p => Math.hypot(p.x - c.x, p.y - c.y));
    const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
    if (mean === 0) return { mean: 0, cv: 1 };
    const variance = ds.reduce((a, d) => a + (d - mean) ** 2, 0) / ds.length;
    return { mean, cv: Math.sqrt(variance) / mean };
}

// Interior angle (degrees) at vertex `curr` formed by segments prev->curr->next.
// 180° = straight (no corner), 90° = right angle, < 90° = sharp.
function cornerAngleDeg(prev: Point, curr: Point, next: Point): number {
    const v1x = prev.x - curr.x, v1y = prev.y - curr.y;
    const v2x = next.x - curr.x, v2y = next.y - curr.y;
    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);
    if (len1 === 0 || len2 === 0) return 180;
    let cosA = (v1x * v2x + v1y * v2y) / (len1 * len2);
    if (cosA > 1) cosA = 1;
    if (cosA < -1) cosA = -1;
    return Math.acos(cosA) * 180 / Math.PI;
}

// For a closed simplified polyline (last point ≈ first), count vertices whose
// interior angle is below `sharpThreshold` (default 110°). 110° is below the
// interior angle of a regular hexagon (120°), so a Douglas-Peucker simplification
// of a circle (~6-vertex polygon) is NOT counted as having sharp corners. Squares
// (90°) and triangles (60° or less) are still well below threshold.
function countSharpCorners(simplified: Point[], closed: boolean, sharpThreshold = 110): number {
    if (simplified.length < 3) return 0;
    let n = 0;
    for (let i = 1; i < simplified.length - 1; i++) {
        if (cornerAngleDeg(simplified[i - 1], simplified[i], simplified[i + 1]) < sharpThreshold) {
            n++;
        }
    }
    if (closed && simplified.length >= 4) {
        const last = simplified.length - 1;
        // The "wrap-around" vertex shared between simplified[0] and simplified[last].
        // If they're effectively the same point, the corner angle there is at simplified[0]
        // formed by simplified[last-1] -> simplified[0] -> simplified[1].
        const a = cornerAngleDeg(simplified[last - 1], simplified[0], simplified[1]);
        if (a < sharpThreshold) n++;
    }
    return n;
}

// Classify a triangle by its angles/sides into a canonical school-friendly form,
// then snap to a perfect version of that form with the base horizontal at the
// bottom of the bbox. Preserves bbox position and approximate size.
type TriangleKind = 'equilateral' | 'right' | 'isosceles';

function triangleAngles(v: [Point, Point, Point]): { angles: [number, number, number]; sides: [number, number, number] } {
    const [a, b, c] = v;
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ca = Math.hypot(a.x - c.x, a.y - c.y);
    const angAt = (opp: number, adj1: number, adj2: number) => {
        if (adj1 === 0 || adj2 === 0) return 60;
        const cosA = (adj1 * adj1 + adj2 * adj2 - opp * opp) / (2 * adj1 * adj2);
        return Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI;
    };
    return {
        angles: [angAt(bc, ab, ca), angAt(ca, ab, bc), angAt(ab, bc, ca)],
        sides: [ab, bc, ca],
    };
}

function classifyTriangle(v: [Point, Point, Point]): TriangleKind {
    const { angles, sides } = triangleAngles(v);
    const sortedSides = sides.slice().sort((x, y) => x - y);
    const sideSpread = (sortedSides[2] - sortedSides[0]) / sortedSides[2];
    // Equilateral: all sides within ~18% of each other.
    if (sideSpread < 0.18) return 'equilateral';
    // Right: any angle within 12° of 90°.
    if (angles.some(a => Math.abs(a - 90) < 12)) return 'right';
    return 'isosceles';
}

// Snap the 3 vertices to a canonical triangle inscribed in their bounding box
// (always with the base horizontal at the bottom).
export function normalizeTriangle(v: [Point, Point, Point]): [Point, Point, Point] {
    const bbox = boundingBox(v);
    if (bbox.w === 0 || bbox.h === 0) return v;
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const baseY = bbox.y + bbox.h;
    const topY = bbox.y;
    const kind = classifyTriangle(v);

    if (kind === 'equilateral') {
        // Largest equilateral triangle that fits in the bbox with horizontal base.
        const sideFromW = bbox.w;
        const sideFromH = bbox.h * 2 / Math.sqrt(3);
        const side = Math.min(sideFromW, sideFromH);
        const height = side * Math.sqrt(3) / 2;
        // Center inside the bbox.
        const baseOffsetY = (bbox.h - height) / 2;
        return [
            { x: cx - side / 2, y: baseY - baseOffsetY },
            { x: cx + side / 2, y: baseY - baseOffsetY },
            { x: cx, y: baseY - baseOffsetY - height },
        ];
    }

    if (kind === 'right') {
        // Place the right angle at one of the bottom corners. Choose left/right
        // based on which side of the user's triangle the apex leans toward.
        const { angles } = triangleAngles(v);
        // The vertex whose angle is closest to 90° becomes the right-angle corner.
        let rightIdx = 0;
        let bestDelta = Math.abs(angles[0] - 90);
        for (let i = 1; i < 3; i++) {
            const d = Math.abs(angles[i] - 90);
            if (d < bestDelta) { bestDelta = d; rightIdx = i; }
        }
        const rightV = v[rightIdx];
        const placeLeft = rightV.x < cx;
        if (placeLeft) {
            return [
                { x: bbox.x, y: baseY },           // right angle, bottom-left
                { x: bbox.x + bbox.w, y: baseY },  // bottom-right
                { x: bbox.x, y: topY },            // top-left
            ];
        }
        return [
            { x: bbox.x + bbox.w, y: baseY },  // right angle, bottom-right
            { x: bbox.x, y: baseY },           // bottom-left
            { x: bbox.x + bbox.w, y: topY },   // top-right
        ];
    }

    // Isosceles (default): base fills bbox width, apex centered on top.
    return [
        { x: bbox.x, y: baseY },
        { x: bbox.x + bbox.w, y: baseY },
        { x: cx, y: topY },
    ];
}

// Pick the three vertices with the smallest interior angles from a closed simplified polyline.
function pickSharpestTriangle(simplified: Point[]): [Point, Point, Point] | null {
    if (simplified.length < 4) return null;
    const candidates: { p: Point; ang: number }[] = [];
    // Interior vertices.
    for (let i = 1; i < simplified.length - 1; i++) {
        candidates.push({
            p: simplified[i],
            ang: cornerAngleDeg(simplified[i - 1], simplified[i], simplified[i + 1]),
        });
    }
    // Wrap-around at simplified[0].
    if (simplified.length >= 4) {
        const last = simplified.length - 1;
        candidates.push({
            p: simplified[0],
            ang: cornerAngleDeg(simplified[last - 1], simplified[0], simplified[1]),
        });
    }
    candidates.sort((a, b) => a.ang - b.ang);
    if (candidates.length < 3) return null;
    return [candidates[0].p, candidates[1].p, candidates[2].p];
}

// Heuristic heart detector: closed shape with two top peaks and a pointed bottom
// near the horizontal center, with a noticeable valley between the peaks.
function looksLikeHeart(pts: Point[], bbox: { x: number; y: number; w: number; h: number }): boolean {
    if (pts.length < 12) return false;
    const aspect = bbox.h === 0 ? 99 : bbox.w / bbox.h;
    if (aspect < 0.6 || aspect > 1.6) return false;

    const cx = bbox.x + bbox.w / 2;

    // Highest point in left and right halves (smallest y).
    let leftPeak: Point | null = null;
    let rightPeak: Point | null = null;
    for (const p of pts) {
        if (p.x < cx) {
            if (!leftPeak || p.y < leftPeak.y) leftPeak = p;
        } else {
            if (!rightPeak || p.y < rightPeak.y) rightPeak = p;
        }
    }
    if (!leftPeak || !rightPeak) return false;

    // Both peaks should be in the upper third of the bbox.
    const upperLimit = bbox.y + bbox.h * 0.35;
    if (leftPeak.y > upperLimit || rightPeak.y > upperLimit) return false;
    // Peaks should be at similar height.
    if (Math.abs(leftPeak.y - rightPeak.y) > bbox.h * 0.25) return false;

    // Valley between peaks: highest y (= lowest dip) found in the upper-middle slice.
    const valleyXMin = Math.min(leftPeak.x, rightPeak.x) + bbox.w * 0.05;
    const valleyXMax = Math.max(leftPeak.x, rightPeak.x) - bbox.w * 0.05;
    const upperHalf = bbox.y + bbox.h * 0.55;
    let valleyDipY = -Infinity;
    for (const p of pts) {
        if (p.x > valleyXMin && p.x < valleyXMax && p.y < upperHalf) {
            if (p.y > valleyDipY) valleyDipY = p.y;
        }
    }
    if (valleyDipY === -Infinity) return false;
    const peakAvgY = (leftPeak.y + rightPeak.y) / 2;
    if (valleyDipY - peakAvgY < bbox.h * 0.10) return false;

    // Bottom point should be near the horizontal center and in the lower portion.
    let bottom: Point = pts[0];
    for (const p of pts) if (p.y > bottom.y) bottom = p;
    if (bottom.y - bbox.y < bbox.h * 0.7) return false;
    if (Math.abs(bottom.x - cx) > bbox.w * 0.25) return false;

    return true;
}

export type ShapeCandidate = { shape: ShapeResult; score: number };

// Confidence levels used by the caller to decide whether to auto-apply or prompt.
//   - At or above AUTO threshold: clean-shape replaces the stroke automatically.
//   - At or above MIN_OFFER: stroke is kept, the chooser opens so the user
//     can pick the intended shape. Set very low so we always offer SOMETHING
//     for any deliberate drawing (user wanted "모든 도형을 인식").
export const SHAPE_AUTO_APPLY_THRESHOLD = 0.85;
export const SHAPE_MIN_OFFER_THRESHOLD = 0.01;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function scoreCircle(sharpCount: number, cv: number, aspect: number): number {
    if (sharpCount > 2) return 0;
    const sharpFactor = sharpCount === 0 ? 1 : sharpCount === 1 ? 0.65 : 0.25;
    const cvFactor = clamp01(1 - cv / 0.25);
    const aspectFactor = clamp01(1 - Math.abs(aspect - 1) / 0.45);
    return sharpFactor * cvFactor * aspectFactor;
}

function scoreEllipse(sharpCount: number, cv: number, aspect: number): number {
    if (sharpCount > 2) return 0;
    const sharpFactor = sharpCount === 0 ? 1 : sharpCount === 1 ? 0.7 : 0.3;
    const cvFactor = clamp01(1 - cv / 0.40);
    // Penalize near-square aspect — those look better as a circle.
    const aspectFactor = aspect > 0.92 && aspect < 1.08 ? 0.4 : 1.0;
    return sharpFactor * cvFactor * aspectFactor;
}

function scoreRectangle(sharpCount: number, cornerCount: number): number {
    if (sharpCount < 2) return 0;
    let s = 0;
    if (sharpCount === 4) s = 1.0;
    else if (sharpCount === 3 || sharpCount === 5) s = 0.75;
    else if (sharpCount === 2) s = 0.35;
    else if (sharpCount === 6) s = 0.45;
    else return 0;

    if (cornerCount === 4 || cornerCount === 5) { /* best */ }
    else if (cornerCount === 3 || cornerCount === 6) s *= 0.85;
    else s *= 0.55;
    return s;
}

function scoreTriangle(sharpCount: number, cornerCount: number): number {
    if (sharpCount < 2) return 0;
    let s = 0;
    if (sharpCount === 3) s = 1.0;
    else if (sharpCount === 2) s = 0.55;
    else if (sharpCount === 4) s = 0.4;
    else return 0;

    if (cornerCount === 3) { /* best */ }
    else if (cornerCount === 4) s *= 0.85;
    else s *= 0.5;
    return s;
}

function scoreLine(straight: number, totalLen: number): number {
    if (totalLen === 0) return 0;
    const ratio = straight / totalLen;
    // 0 below 0.7 ratio, 1 at perfectly straight.
    return clamp01((ratio - 0.7) / 0.3);
}

function scoreArrow(simplified: Point[]): number {
    if (simplified.length < 4 || simplified.length > 5) return 0;
    const segs: number[] = [];
    for (let i = 1; i < simplified.length; i++) {
        segs.push(Math.hypot(
            simplified[i].x - simplified[i - 1].x,
            simplified[i].y - simplified[i - 1].y,
        ));
    }
    if (segs.length < 3) return 0;
    const r1 = segs[0] / Math.max(1, segs[1]);
    const r2 = segs[0] / Math.max(1, segs[2]);
    const minR = Math.min(r1, r2);
    if (minR < 1.5) return 0;
    return clamp01((minR - 1.5) / 2.0);
}

function scoreHeart(pts: Point[], bbox: { x: number; y: number; w: number; h: number }): number {
    if (pts.length < 12) return 0;
    const aspect = bbox.h === 0 ? 99 : bbox.w / bbox.h;
    const aspectScore = clamp01(1 - Math.abs(aspect - 1) / 0.5);
    if (aspectScore <= 0) return 0;

    const cx = bbox.x + bbox.w / 2;
    let leftPeak: Point | null = null;
    let rightPeak: Point | null = null;
    for (const p of pts) {
        if (p.x < cx) {
            if (!leftPeak || p.y < leftPeak.y) leftPeak = p;
        } else {
            if (!rightPeak || p.y < rightPeak.y) rightPeak = p;
        }
    }
    if (!leftPeak || !rightPeak) return 0;

    if (leftPeak.y - bbox.y > bbox.h * 0.4) return 0;
    if (rightPeak.y - bbox.y > bbox.h * 0.4) return 0;
    const peakSymmetry = clamp01(1 - Math.abs(leftPeak.y - rightPeak.y) / (bbox.h * 0.3));

    const valleyXMin = Math.min(leftPeak.x, rightPeak.x) + bbox.w * 0.05;
    const valleyXMax = Math.max(leftPeak.x, rightPeak.x) - bbox.w * 0.05;
    const upperHalf = bbox.y + bbox.h * 0.55;
    let valleyDipY = -Infinity;
    for (const p of pts) {
        if (p.x > valleyXMin && p.x < valleyXMax && p.y < upperHalf) {
            if (p.y > valleyDipY) valleyDipY = p.y;
        }
    }
    if (valleyDipY === -Infinity) return 0;
    const peakAvgY = (leftPeak.y + rightPeak.y) / 2;
    const valleyDepth = (valleyDipY - peakAvgY) / bbox.h;
    if (valleyDepth < 0.05) return 0;
    const valleyScore = clamp01((valleyDepth - 0.05) / 0.20);

    let bottom: Point = pts[0];
    for (const p of pts) if (p.y > bottom.y) bottom = p;
    if (bottom.y - bbox.y < bbox.h * 0.65) return 0;
    const bottomCenterScore = clamp01(1 - Math.abs(bottom.x - cx) / (bbox.w * 0.35));

    // Arithmetic mean rather than product so a "decent on all axes" heart still
    // scores high enough to be offered (product collapses fast: 0.7^4 ≈ 0.24).
    return (aspectScore + peakSymmetry + valleyScore + bottomCenterScore) / 4;
}

/**
 * Returns all viable shape candidates for the stroke, sorted by descending score.
 * Empty array means the stroke is too short or doesn't match any known shape.
 * Caller decides whether to auto-apply (top score above AUTO threshold) or
 * present a chooser (top score below AUTO but above MIN_OFFER).
 */
export function recognizeShapeCandidates(rawPoints: Point[]): ShapeCandidate[] {
    if (rawPoints.length < 4) return [];
    const totalLen = pathLength(rawPoints);
    if (totalLen < 30) return [];
    const bbox = boundingBox(rawPoints);
    const diagonal = Math.hypot(bbox.w, bbox.h);
    if (diagonal < 30) return [];

    const pts = resample(rawPoints, RESAMPLE_N);
    const closed = isClosed(rawPoints, totalLen, diagonal);
    const tol = Math.max(4, diagonal * 0.06);
    const simplified = simplify(rawPoints, tol);
    const cornerCount = closed ? simplified.length - 1 : simplified.length;
    const sharpCount = countSharpCorners(simplified, closed);
    const c = centroid(pts);
    const rv = radialVariance(pts, c);
    const aspect = bbox.h === 0 ? 99 : bbox.w / bbox.h;

    const out: ShapeCandidate[] = [];

    if (closed) {
        const triS = scoreTriangle(sharpCount, cornerCount);
        if (triS > 0) {
            const tri = pickSharpestTriangle(simplified);
            if (tri) out.push({ shape: { type: 'triangle', vertices: normalizeTriangle(tri) }, score: triS });
        }

        const rectS = scoreRectangle(sharpCount, cornerCount);
        if (rectS > 0) {
            out.push({
                shape: { type: 'rectangle', x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
                score: rectS,
            });
        }

        const circS = scoreCircle(sharpCount, rv.cv, aspect);
        if (circS > 0) {
            out.push({
                shape: { type: 'circle', center: c, radius: rv.mean },
                score: circS,
            });
        }

        const ellS = scoreEllipse(sharpCount, rv.cv, aspect);
        if (ellS > 0) {
            out.push({
                shape: {
                    type: 'ellipse',
                    center: { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 },
                    rx: bbox.w / 2, ry: bbox.h / 2,
                },
                score: ellS,
            });
        }

        const heartS = scoreHeart(rawPoints, bbox);
        if (heartS > 0) {
            out.push({
                shape: { type: 'heart', x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
                score: heartS,
            });
        }
    } else {
        const from = simplified[0];
        const to = simplified[simplified.length - 1];
        const straight = Math.hypot(to.x - from.x, to.y - from.y);
        const lineS = scoreLine(straight, totalLen);
        if (lineS > 0) {
            out.push({ shape: { type: 'line', from, to }, score: lineS });
        }
        const arrS = scoreArrow(simplified);
        if (arrS > 0 && simplified.length >= 4) {
            out.push({
                shape: { type: 'arrow', from: simplified[0], to: simplified[1] },
                score: arrS,
            });
        }
    }

    return out.sort((a, b) => b.score - a.score);
}

/** Scale a shape uniformly around an anchor point. Used for post-commit resize. */
export function scaleShape(shape: ShapeResult, anchor: Point, scale: number): ShapeResult {
    const sx = (p: Point): Point => ({
        x: anchor.x + (p.x - anchor.x) * scale,
        y: anchor.y + (p.y - anchor.y) * scale,
    });
    const sBox = (b: { x: number; y: number; w: number; h: number }) => {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const newW = b.w * scale;
        const newH = b.h * scale;
        const newCx = anchor.x + (cx - anchor.x) * scale;
        const newCy = anchor.y + (cy - anchor.y) * scale;
        return { x: newCx - newW / 2, y: newCy - newH / 2, w: newW, h: newH };
    };
    switch (shape.type) {
        case 'line': return { type: 'line', from: sx(shape.from), to: sx(shape.to) };
        case 'arrow': return { type: 'arrow', from: sx(shape.from), to: sx(shape.to) };
        case 'circle': return { type: 'circle', center: sx(shape.center), radius: shape.radius * scale };
        case 'ellipse': return {
            type: 'ellipse',
            center: sx(shape.center),
            rx: shape.rx * scale,
            ry: shape.ry * scale,
        };
        case 'rectangle': return { type: 'rectangle', ...sBox(shape) };
        case 'heart': return { type: 'heart', ...sBox(shape) };
        case 'triangle': return {
            type: 'triangle',
            vertices: [sx(shape.vertices[0]), sx(shape.vertices[1]), sx(shape.vertices[2])],
        };
        case 'rotatedRectangle': return {
            type: 'rotatedRectangle',
            vertices: [sx(shape.vertices[0]), sx(shape.vertices[1]), sx(shape.vertices[2]), sx(shape.vertices[3])],
        };
        case 'parallelogram': return {
            type: 'parallelogram',
            vertices: [sx(shape.vertices[0]), sx(shape.vertices[1]), sx(shape.vertices[2]), sx(shape.vertices[3])],
        };
        case 'unknown': return shape;
    }
}

/** Centroid (for shape anchor when resizing). */
export function shapeCenter(shape: ShapeResult): Point | null {
    switch (shape.type) {
        case 'line':
        case 'arrow':
            return { x: (shape.from.x + shape.to.x) / 2, y: (shape.from.y + shape.to.y) / 2 };
        case 'circle': return shape.center;
        case 'ellipse': return shape.center;
        case 'rectangle':
        case 'heart':
            return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
        case 'triangle':
            return {
                x: (shape.vertices[0].x + shape.vertices[1].x + shape.vertices[2].x) / 3,
                y: (shape.vertices[0].y + shape.vertices[1].y + shape.vertices[2].y) / 3,
            };
        case 'rotatedRectangle':
        case 'parallelogram': {
            const v = shape.vertices;
            return {
                x: (v[0].x + v[1].x + v[2].x + v[3].x) / 4,
                y: (v[0].y + v[1].y + v[2].y + v[3].y) / 4,
            };
        }
        case 'unknown': return null;
    }
}

/** Merge two candidate lists, keeping the highest-scoring entry per shape type. */
export function mergeShapeCandidates(a: ShapeCandidate[], b: ShapeCandidate[]): ShapeCandidate[] {
    const byType = new Map<string, ShapeCandidate>();
    for (const c of a) byType.set(c.shape.type, c);
    for (const c of b) {
        const existing = byType.get(c.shape.type);
        if (!existing || c.score > existing.score) byType.set(c.shape.type, c);
    }
    return Array.from(byType.values()).sort((x, y) => y.score - x.score);
}

// Backwards-compatible single-shape API. Returns only the top shape if it's
// confident enough; otherwise unknown. Prefer `recognizeShapeCandidates` in new code.
export function recognizeShape(rawPoints: Point[]): ShapeResult {
    const cands = recognizeShapeCandidates(rawPoints);
    if (cands.length === 0 || cands[0].score < SHAPE_AUTO_APPLY_THRESHOLD) {
        return { type: 'unknown' };
    }
    return cands[0].shape;
}

// ===== Multi-stroke recognition (point-cloud based) =====
// When the user draws a shape with several separate strokes (e.g., 3 lines for
// a triangle, 4 lines for a rectangle), the path-based features above don't work
// because there's no continuous outline. We instead treat all stroke points as
// a point cloud and score how well it fits each canonical shape.

function distToSegment(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.hypot(p.x - projX, p.y - projY);
}

function fitRatioRectangle(pts: Point[], bbox: { x: number; y: number; w: number; h: number }, tol: number): number {
    if (bbox.w === 0 || bbox.h === 0 || pts.length === 0) return 0;
    let near = 0;
    for (const p of pts) {
        const dLeft = Math.abs(p.x - bbox.x);
        const dRight = Math.abs(bbox.x + bbox.w - p.x);
        const dTop = Math.abs(p.y - bbox.y);
        const dBottom = Math.abs(bbox.y + bbox.h - p.y);
        const minEdge = Math.min(dLeft, dRight, dTop, dBottom);
        if (minEdge < tol) near++;
    }
    return near / pts.length;
}

function fitRatioTriangle(pts: Point[], v: [Point, Point, Point], tol: number): number {
    if (pts.length === 0) return 0;
    let near = 0;
    for (const p of pts) {
        const d = Math.min(
            distToSegment(p, v[0], v[1]),
            distToSegment(p, v[1], v[2]),
            distToSegment(p, v[2], v[0]),
        );
        if (d < tol) near++;
    }
    return near / pts.length;
}

function fitRatioCircle(pts: Point[], c: Point, r: number, tol: number): number {
    if (pts.length === 0 || r <= 0) return 0;
    let near = 0;
    for (const p of pts) {
        const d = Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r);
        if (d < tol) near++;
    }
    return near / pts.length;
}

function fitRatioEllipse(pts: Point[], cx: number, cy: number, rx: number, ry: number, tol: number): number {
    if (pts.length === 0 || rx <= 0 || ry <= 0) return 0;
    let near = 0;
    // Approximation: deviation of (x-cx)²/rx² + (y-cy)²/ry² from 1, scaled to length units.
    for (const p of pts) {
        const nx = (p.x - cx) / rx;
        const ny = (p.y - cy) / ry;
        const norm = Math.hypot(nx, ny);
        if (norm === 0) continue;
        // Scale the normalized deviation back to pixel units approximately.
        const r0 = Math.hypot(nx * rx, ny * ry);
        const r1 = r0 / norm;
        const dev = Math.abs(r0 - r1);
        if (dev < tol) near++;
    }
    return near / pts.length;
}

// Andrew's monotone chain convex hull. Returns hull vertices in CCW order
// (with screen y-axis pointing down, this is actually CW in math terms — but
// orientation doesn't matter for our use cases).
function convexHull(pts: Point[]): Point[] {
    if (pts.length < 3) return pts.slice();
    const sorted = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o: Point, a: Point, b: Point) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    const lower: Point[] = [];
    for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
            lower.pop();
        }
        lower.push(p);
    }
    const upper: Point[] = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
        const p = sorted[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
            upper.pop();
        }
        upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
}

// Polygon area (shoelace).
function polyArea(verts: Point[]): number {
    let s = 0;
    for (let i = 0; i < verts.length; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % verts.length];
        s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
}

// Find the 3 hull vertices that form the maximum-area triangle.
function maxAreaTriangle(hull: Point[]): [Point, Point, Point] | null {
    if (hull.length < 3) return null;
    let bestArea = 0;
    let best: [Point, Point, Point] | null = null;
    for (let i = 0; i < hull.length; i++) {
        for (let j = i + 1; j < hull.length; j++) {
            for (let k = j + 1; k < hull.length; k++) {
                const a = polyArea([hull[i], hull[j], hull[k]]);
                if (a > bestArea) {
                    bestArea = a;
                    best = [hull[i], hull[j], hull[k]];
                }
            }
        }
    }
    return best;
}

// Find the 4 hull vertices that form the maximum-area quadrilateral. The
// hull's points are in CCW order, so picking 4 in index order preserves order.
function maxAreaQuad(hull: Point[]): [Point, Point, Point, Point] | null {
    if (hull.length < 4) return null;
    let bestArea = 0;
    let best: [Point, Point, Point, Point] | null = null;
    const n = hull.length;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            for (let k = j + 1; k < n; k++) {
                for (let l = k + 1; l < n; l++) {
                    const a = polyArea([hull[i], hull[j], hull[k], hull[l]]);
                    if (a > bestArea) {
                        bestArea = a;
                        best = [hull[i], hull[j], hull[k], hull[l]];
                    }
                }
            }
        }
    }
    return best;
}

// Snap a quadrilateral to a true parallelogram by adjusting opposite sides
// to be exactly equal vectors. We average the two opposite-side vectors to
// keep the centroid stable.
function snapToParallelogram(quad: [Point, Point, Point, Point]): [Point, Point, Point, Point] {
    const [a, b, c, d] = quad;
    // Side vectors AB and DC should be equal, AD and BC should be equal.
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const dc = { x: c.x - d.x, y: c.y - d.y };
    const ad = { x: d.x - a.x, y: d.y - a.y };
    const bc = { x: c.x - b.x, y: c.y - b.y };
    const avgH = { x: (ab.x + dc.x) / 2, y: (ab.y + dc.y) / 2 };
    const avgV = { x: (ad.x + bc.x) / 2, y: (ad.y + bc.y) / 2 };
    // Centroid stays at average of the 4 vertices.
    const cx = (a.x + b.x + c.x + d.x) / 4;
    const cy = (a.y + b.y + c.y + d.y) / 4;
    // Reconstruct around centroid: the 4 corners are centroid ± half of (avgH ± avgV).
    const hx = avgH.x / 2, hy = avgH.y / 2;
    const vx = avgV.x / 2, vy = avgV.y / 2;
    return [
        { x: cx - hx - vx + 0, y: cy - hy - vy + 0 }, // a
        { x: cx + hx - vx, y: cy + hy - vy },         // b
        { x: cx + hx + vx, y: cy + hy + vy },         // c
        { x: cx - hx + vx, y: cy - hy + vy },         // d
    ];
}

// 0..1 score for "this quadrilateral is a parallelogram" — based on opposite-
// side parallelism and equal length.
function parallelogramFit(quad: [Point, Point, Point, Point]): number {
    const [a, b, c, d] = quad;
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const dc = { x: c.x - d.x, y: c.y - d.y };
    const ad = { x: d.x - a.x, y: d.y - a.y };
    const bc = { x: c.x - b.x, y: c.y - b.y };

    const sim = (v1: { x: number; y: number }, v2: { x: number; y: number }): number => {
        const l1 = Math.hypot(v1.x, v1.y);
        const l2 = Math.hypot(v2.x, v2.y);
        if (l1 === 0 || l2 === 0) return 0;
        // Same-direction parallelism: dot product / (l1*l2) close to 1.
        const dot = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
        const parallel = clamp01((dot - 0.85) / 0.15);
        const lenRatio = Math.min(l1, l2) / Math.max(l1, l2);
        return parallel * lenRatio;
    };
    return (sim(ab, dc) + sim(ad, bc)) / 2;
}

// 0..1 score for "this quadrilateral is rectangular" — parallelogram + 90° corners.
function rectangleFitAngles(quad: [Point, Point, Point, Point]): number {
    const para = parallelogramFit(quad);
    if (para < 0.6) return 0;
    // Mean cosine deviation from perpendicularity at the 4 corners.
    let perpScore = 0;
    for (let i = 0; i < 4; i++) {
        const prev = quad[(i + 3) % 4];
        const curr = quad[i];
        const next = quad[(i + 1) % 4];
        const v1 = { x: prev.x - curr.x, y: prev.y - curr.y };
        const v2 = { x: next.x - curr.x, y: next.y - curr.y };
        const l1 = Math.hypot(v1.x, v1.y);
        const l2 = Math.hypot(v2.x, v2.y);
        if (l1 === 0 || l2 === 0) continue;
        const cos = Math.abs((v1.x * v2.x + v1.y * v2.y) / (l1 * l2));
        // cos==0 → perfect right angle (full score). cos==0.4 → score 0.
        perpScore += clamp01((0.4 - cos) / 0.4);
    }
    perpScore /= 4;
    return para * perpScore;
}

/**
 * Recognize a shape made of MULTIPLE separate strokes (or a single stroke whose
 * path-based features didn't yield a confident result). Uses pure point-cloud
 * fit metrics: how well the union of all stroke points lies near each candidate
 * shape's outline.
 */
export function recognizeShapeCandidatesMulti(strokes: Point[][]): ShapeCandidate[] {
    const allPoints: Point[] = [];
    for (const s of strokes) {
        for (const p of s) allPoints.push(p);
    }
    if (allPoints.length < 8) return [];
    const bbox = boundingBox(allPoints);
    const diagonal = Math.hypot(bbox.w, bbox.h);
    if (diagonal < 30) return [];

    const tol = Math.max(8, diagonal * 0.07);
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const c = centroid(allPoints);
    const rv = radialVariance(allPoints, c);
    const aspect = bbox.h === 0 ? 99 : bbox.w / bbox.h;

    const out: ShapeCandidate[] = [];

    // We always include the core shapes (rectangle/triangle/circle/ellipse) with
    // at least a small floor score so the chooser ALWAYS has a triangle option
    // for a multi-stroke triangle attempt, a rectangle option, etc. The actual
    // fit score still determines ordering.
    const floor = 0.10;

    // Rectangle: edge-fit ratio (more lenient: starts scoring at 0.35).
    const rectFit = fitRatioRectangle(allPoints, bbox, tol);
    const rectS = Math.max(floor, clamp01((rectFit - 0.35) / 0.45));
    out.push({
        shape: { type: 'rectangle', x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
        score: rectS,
    });

    // Triangle: try the four canonical orientations and keep the best.
    const orientations: [Point, Point, Point][] = [
        // apex-top
        [{ x: cx, y: bbox.y }, { x: bbox.x, y: bbox.y + bbox.h }, { x: bbox.x + bbox.w, y: bbox.y + bbox.h }],
        // apex-bottom
        [{ x: bbox.x, y: bbox.y }, { x: bbox.x + bbox.w, y: bbox.y }, { x: cx, y: bbox.y + bbox.h }],
        // apex-left
        [{ x: bbox.x, y: cy }, { x: bbox.x + bbox.w, y: bbox.y }, { x: bbox.x + bbox.w, y: bbox.y + bbox.h }],
        // apex-right
        [{ x: bbox.x, y: bbox.y }, { x: bbox.x, y: bbox.y + bbox.h }, { x: bbox.x + bbox.w, y: cy }],
    ];
    let bestTri: { v: [Point, Point, Point]; fit: number } | null = null;
    for (const v of orientations) {
        const fit = fitRatioTriangle(allPoints, v, tol);
        if (!bestTri || fit > bestTri.fit) bestTri = { v, fit };
    }
    if (bestTri) {
        // Lenient: starts scoring at 0.30 instead of 0.55.
        const triS = Math.max(floor, clamp01((bestTri.fit - 0.30) / 0.50));
        out.push({
            shape: { type: 'triangle', vertices: normalizeTriangle(bestTri.v) },
            score: triS,
        });
    }

    // Circle: best radius is radial mean from centroid, score by edge-fit + aspect.
    const circFit = fitRatioCircle(allPoints, c, rv.mean, tol);
    const circAspect = clamp01(1 - Math.abs(aspect - 1) / 0.45);
    const circS = Math.max(floor * 0.8,
        clamp01((circFit - 0.40) / 0.45) * circAspect * clamp01(1 - rv.cv / 0.30));
    out.push({
        shape: { type: 'circle', center: c, radius: rv.mean },
        score: circS,
    });

    // Ellipse: bbox-axis-aligned, scored by edge fit.
    const rx = bbox.w / 2;
    const ry = bbox.h / 2;
    const ellFit = fitRatioEllipse(allPoints, cx, cy, rx, ry, tol);
    const ellAspectFactor = aspect > 0.92 && aspect < 1.08 ? 0.4 : 1.0;
    const ellS = Math.max(floor * 0.7,
        clamp01((ellFit - 0.40) / 0.45) * ellAspectFactor);
    out.push({
        shape: { type: 'ellipse', center: { x: cx, y: cy }, rx, ry },
        score: ellS,
    });

    // Heart: same heuristic; works on point set.
    const heartS = scoreHeart(allPoints, bbox);
    if (heartS > 0) {
        out.push({
            shape: { type: 'heart', x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
            score: heartS,
        });
    }

    // Convex-hull based detection: lets us find the ACTUAL vertices of the
    // user's polygon (works for tilted triangles, parallelograms, etc.) rather
    // than only the canonical bbox-aligned orientations above.
    const hull = convexHull(allPoints);
    if (hull.length >= 3) {
        const tri = maxAreaTriangle(hull);
        if (tri) {
            const fit = fitRatioTriangle(allPoints, tri, tol);
            // Lenient floor at 0.30 (previously 0.55).
            const triS = clamp01((fit - 0.30) / 0.50);
            // The triangle inscribed in the hull should also cover most of the
            // hull's area — penalize if it's much smaller (means the points
            // form a quadrilateral or rounder shape, not a triangle).
            const hullArea = polyArea(hull);
            const triArea = polyArea(tri);
            const areaCoverage = hullArea > 0 ? triArea / hullArea : 0;
            const coverageBonus = clamp01((areaCoverage - 0.65) / 0.30);
            const score = Math.max(floor * 1.2, triS * (0.5 + 0.5 * coverageBonus));
            out.push({
                shape: { type: 'triangle', vertices: normalizeTriangle(tri) },
                score,
            });
        }

        const quad = maxAreaQuad(hull);
        if (quad) {
            const fit = fitRatioQuadrilateral(allPoints, quad, tol);
            const fitS = clamp01((fit - 0.35) / 0.45);
            if (fitS > 0) {
                // Try as rotated rectangle first, fall back to parallelogram.
                const rectScore = fitS * rectangleFitAngles(quad);
                if (rectScore > 0) {
                    out.push({
                        shape: { type: 'rotatedRectangle', vertices: snapToParallelogram(quad) },
                        score: rectScore,
                    });
                }
                const paraScore = fitS * parallelogramFit(quad);
                if (paraScore > 0) {
                    out.push({
                        shape: { type: 'parallelogram', vertices: snapToParallelogram(quad) },
                        score: paraScore,
                    });
                }
            }
        }
    }

    return out.sort((a, b) => b.score - a.score);
}

function fitRatioQuadrilateral(pts: Point[], quad: [Point, Point, Point, Point], tol: number): number {
    if (pts.length === 0) return 0;
    let near = 0;
    for (const p of pts) {
        const d = Math.min(
            distToSegment(p, quad[0], quad[1]),
            distToSegment(p, quad[1], quad[2]),
            distToSegment(p, quad[2], quad[3]),
            distToSegment(p, quad[3], quad[0]),
        );
        if (d < tol) near++;
    }
    return near / pts.length;
}
