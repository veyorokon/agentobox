/**
 * Vector math and Bezier curve primitives.
 * Adapted from ghost-cursor (MIT license).
 */
export interface Vector {
    x: number;
    y: number;
}
export declare const add: (a: Vector, b: Vector) => Vector;
export declare const sub: (a: Vector, b: Vector) => Vector;
export declare const mult: (v: Vector, s: number) => Vector;
export declare const magnitude: (v: Vector) => number;
export declare const dist: (a: Vector, b: Vector) => number;
export declare const normalize: (v: Vector) => Vector;
export declare const perpendicular: (v: Vector) => Vector;
export declare const lerp: (a: Vector, b: Vector, t: number) => Vector;
export declare const clamp: (value: number, min: number, max: number) => number;
/**
 * Evaluate a cubic Bezier curve at parameter t (0-1).
 */
export declare const cubicBezier: (p0: Vector, p1: Vector, p2: Vector, p3: Vector, t: number) => Vector;
/**
 * Generate two cubic Bezier control points between start and end,
 * offset perpendicular to the line by `spread` pixels.
 * `side` forces control points to one side of the line (1 or -1).
 */
export declare const bezierControlPoints: (start: Vector, end: Vector, spread: number, side?: 1 | -1) => [Vector, Vector];
