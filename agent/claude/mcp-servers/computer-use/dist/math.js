/**
 * Vector math and Bezier curve primitives.
 * Adapted from ghost-cursor (MIT license).
 */
export const add = (a, b) => ({
    x: a.x + b.x,
    y: a.y + b.y,
});
export const sub = (a, b) => ({
    x: a.x - b.x,
    y: a.y - b.y,
});
export const mult = (v, s) => ({
    x: v.x * s,
    y: v.y * s,
});
export const magnitude = (v) => Math.sqrt(v.x * v.x + v.y * v.y);
export const dist = (a, b) => magnitude(sub(b, a));
export const normalize = (v) => {
    const m = magnitude(v);
    return m === 0 ? { x: 0, y: 0 } : mult(v, 1 / m);
};
export const perpendicular = (v) => ({
    x: -v.y,
    y: v.x,
});
export const lerp = (a, b, t) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
});
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
/**
 * Evaluate a cubic Bezier curve at parameter t (0-1).
 */
export const cubicBezier = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;
    return {
        x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
        y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
    };
};
/**
 * Generate two cubic Bezier control points between start and end,
 * offset perpendicular to the line by `spread` pixels.
 * `side` forces control points to one side of the line (1 or -1).
 */
export const bezierControlPoints = (start, end, spread, side) => {
    const chosenSide = side ?? (Math.random() > 0.5 ? 1 : -1);
    const dir = sub(end, start);
    const perp = normalize(perpendicular(dir));
    // Place control points at roughly 1/3 and 2/3 along the line
    // with perpendicular offset
    const t1 = 0.2 + Math.random() * 0.2; // 0.2-0.4
    const t2 = 0.6 + Math.random() * 0.2; // 0.6-0.8
    const mid1 = lerp(start, end, t1);
    const mid2 = lerp(start, end, t2);
    const offset1 = spread * (0.5 + Math.random() * 0.5) * chosenSide;
    const offset2 = spread * (0.5 + Math.random() * 0.5) * chosenSide;
    return [
        add(mid1, mult(perp, offset1)),
        add(mid2, mult(perp, offset2)),
    ];
};
