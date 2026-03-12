/**
 * Human-like segmented mouse movement generator.
 *
 * Models real mouse movement as a series of ballistic sub-movements (bursts),
 * each progressively smaller, with asymmetric velocity profiles that evolve
 * from aggressive (fast ramp, sharp stop) to gentle (smooth bell curve).
 */
import { type Vector } from './math.js';
export interface Waypoint {
    x: number;
    y: number;
    delayMs: number;
}
export interface MoveOptions {
    /** Target element width in px, used for Fitts's law timing. Default: 10 */
    targetWidth?: number;
    /** Override overshoot probability (0-1). Default: auto from distance. */
    overshootChance?: number;
    /** Stop segmenting below this distance in px. Default: 3 */
    minSegmentPx?: number;
    /** Fraction of remaining distance per segment (0-1). Default: 0.6 */
    segmentDecay?: number;
}
/**
 * Generate a human-like segmented mouse path from `from` to `to`.
 *
 * The path consists of progressively smaller ballistic bursts, each with:
 * - A mini Bezier curve (slight wobble)
 * - An asymmetric velocity profile that evolves from aggressive to gentle
 * - Small pauses between segments
 * - Optional overshoot + correction on long movements
 */
export declare function generateHumanPath(from: Vector, to: Vector, options?: MoveOptions): Waypoint[];
