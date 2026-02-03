/**
 * Human-like segmented mouse movement generator.
 *
 * Models real mouse movement as a series of ballistic sub-movements (bursts),
 * each progressively smaller, with asymmetric velocity profiles that evolve
 * from aggressive (fast ramp, sharp stop) to gentle (smooth bell curve).
 */

import {
	type Vector,
	dist,
	sub,
	add,
	mult,
	normalize,
	clamp,
	cubicBezier,
	bezierControlPoints,
} from './math.js';

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

const DEFAULTS = {
	targetWidth: 10,
	minSegmentPx: 3,
	segmentDecay: 0.6,
} as const;

// --- Fitts's Law ---

/**
 * Estimate total movement time (ms) using Fitts's law.
 * T = a + b * log2(D/W + 1)
 */
function fittsTime(distance: number, targetWidth: number): number {
	const a = 50;
	const b = 150;
	return a + b * Math.log2(distance / targetWidth + 1);
}

// --- Velocity Envelope ---

/**
 * Asymmetric velocity envelope for a single segment.
 *
 * `aggression` (0-1) controls the shape:
 * - High (0.9): fast ramp-up (~20%), long plateau (~50%), sharp cliff (~30%)
 * - Low (0.2): slow ramp-up (~40%), short plateau (~20%), gentle ramp-down (~40%)
 *
 * Returns a speed multiplier in [0, 1] for parameter t in [0, 1].
 */
function velocityEnvelope(t: number, aggression: number): number {
	// Phase boundaries shift with aggression
	const rampEnd = 0.15 + (1 - aggression) * 0.25; // 0.15-0.40
	const plateauEnd = rampEnd + 0.2 + aggression * 0.3; // plateau width 0.2-0.5

	if (t < rampEnd) {
		// Ramp up: steeper with higher aggression
		const rampT = t / rampEnd;
		const power = 1 / (0.3 + aggression * 0.7); // 1.0 (aggressive) to 3.3 (gentle)
		return Math.pow(rampT, power);
	}

	if (t < plateauEnd) {
		// Plateau
		return 1.0;
	}

	// Ramp down: sharper with higher aggression
	const downT = (t - plateauEnd) / (1 - plateauEnd);
	const power = 0.3 + aggression * 1.7; // 0.3 (gentle) to 2.0 (aggressive)
	return Math.pow(1 - downT, power);
}

// --- Segment Decomposition ---

interface Segment {
	from: Vector;
	to: Vector;
	/** Fraction of total distance this segment covers */
	fraction: number;
}

/**
 * Decompose the path from→to into progressively smaller segments.
 * Each segment covers `decay` of the remaining distance.
 *
 * Optionally applies overshoot: the second-to-last segment target
 * extends past the true target, and the final segment corrects back.
 */
function computeSegments(
	from: Vector,
	to: Vector,
	decay: number,
	minPx: number,
	overshoot: boolean,
): Segment[] {
	const totalDist = dist(from, to);
	if (totalDist < 1) {
		return [];
	}

	const dir = normalize(sub(to, from));
	const segments: Segment[] = [];
	let current = from;
	let remaining = totalDist;

	// Cap segments: 3-6 depending on distance
	const maxSegments = clamp(Math.round(Math.log2(totalDist / 50) + 2), 3, 6);

	while (remaining > minPx && segments.length < maxSegments - 1) {
		// Each segment covers a decaying fraction, with slight randomness
		const fraction = decay * (0.85 + Math.random() * 0.3);
		const segDist = remaining * fraction;
		const segEnd = add(current, mult(dir, segDist));

		segments.push({
			from: current,
			to: segEnd,
			fraction: segDist / totalDist,
		});

		current = segEnd;
		remaining -= segDist;
	}

	// Final segment to exact target (always present)
	if (dist(current, to) > 0.5) {
		segments.push({
			from: current,
			to,
			fraction: dist(current, to) / totalDist,
		});
	}

	// Apply overshoot to second-to-last segment
	if (overshoot && segments.length >= 2) {
		const penult = segments[segments.length - 2]!;
		const overshootAmount = 0.05 + Math.random() * 0.1; // 5-15% of remaining
		const overshootDist = dist(penult.to, to) * overshootAmount;
		const overshootTarget = add(penult.to, mult(dir, overshootDist));

		penult.to = overshootTarget;

		// Last segment now corrects back from overshoot point to true target
		const last = segments[segments.length - 1]!;
		last.from = overshootTarget;
		last.to = to;
		last.fraction = dist(overshootTarget, to) / totalDist;
	}

	return segments;
}

// --- Single Segment Waypoint Generation ---

/**
 * Generate waypoints along a single segment using a cubic Bezier
 * with perpendicular wobble and an asymmetric velocity envelope.
 *
 * Models real mouse hardware: fixed polling interval (~2ms ticks),
 * variable step size per tick driven by the velocity envelope.
 * Fast movement = larger spatial steps, slow = smaller.
 */
function segmentWaypoints(
	from: Vector,
	to: Vector,
	durationMs: number,
	aggression: number,
	wobbleAmplitude: number,
): Waypoint[] {
	const segDist = dist(from, to);
	if (segDist < 0.5 || durationMs < 1) {
		return [{x: Math.round(to.x), y: Math.round(to.y), delayMs: Math.max(1, durationMs)}];
	}

	// Generate Bezier control points with wobble
	const [cp1, cp2] = bezierControlPoints(from, to, wobbleAmplitude);

	// Fixed tick interval (like mouse polling rate ~500Hz = 2ms)
	const tickMs = 2;
	const numTicks = Math.max(2, Math.ceil(durationMs / tickMs));

	// Build velocity envelope at each tick and integrate to get
	// cumulative "distance traveled" — this maps clock time to Bezier t.
	const speeds: number[] = [];
	for (let i = 0; i < numTicks; i++) {
		const progress = i / (numTicks - 1);
		speeds.push(Math.max(0.05, velocityEnvelope(progress, aggression)));
	}

	// Cumulative sum of speeds → maps tick index to proportional distance
	const cumulative: number[] = [0];
	for (let i = 1; i < numTicks; i++) {
		cumulative.push(cumulative[i - 1]! + speeds[i]!);
	}

	const totalSpeed = cumulative[numTicks - 1]!;

	const waypoints: Waypoint[] = [];
	for (let i = 0; i < numTicks; i++) {
		// Map cumulative speed to Bezier parameter t (0→1)
		const t = cumulative[i]! / totalSpeed;
		const pos = cubicBezier(from, cp1, cp2, to, t);
		waypoints.push({
			x: Math.round(pos.x),
			y: Math.round(pos.y),
			delayMs: tickMs,
		});
	}

	// Ensure last point is exactly at the end
	if (waypoints.length > 0) {
		const last = waypoints[waypoints.length - 1]!;
		last.x = Math.round(to.x);
		last.y = Math.round(to.y);
	}

	return waypoints;
}

// --- Main Entry Point ---

/**
 * Generate a human-like segmented mouse path from `from` to `to`.
 *
 * The path consists of progressively smaller ballistic bursts, each with:
 * - A mini Bezier curve (slight wobble)
 * - An asymmetric velocity profile that evolves from aggressive to gentle
 * - Small pauses between segments
 * - Optional overshoot + correction on long movements
 */
export function generateHumanPath(
	from: Vector,
	to: Vector,
	options?: MoveOptions,
): Waypoint[] {
	const opts = {...DEFAULTS, ...options};
	const totalDist = dist(from, to);

	// Trivial case: already there
	if (totalDist < 1) {
		return [];
	}

	// Very short movement: single direct step
	if (totalDist < opts.minSegmentPx * 2) {
		return [{x: Math.round(to.x), y: Math.round(to.y), delayMs: 8}];
	}

	// Determine overshoot
	const overshootChance = opts.overshootChance ?? clamp(totalDist / 800, 0.1, 0.5);
	const shouldOvershoot = Math.random() < overshootChance;

	// Decompose into segments
	const segments = computeSegments(
		from, to, opts.segmentDecay, opts.minSegmentPx, shouldOvershoot,
	);

	if (segments.length === 0) {
		return [{x: Math.round(to.x), y: Math.round(to.y), delayMs: 8}];
	}

	// Total time budget from Fitts's law
	const totalTimeMs = fittsTime(totalDist, opts.targetWidth);

	// Distribute time proportionally to segment distance
	const segmentDistances = segments.map(s => dist(s.from, s.to));
	const totalSegDist = segmentDistances.reduce((a, b) => a + b, 0);

	const allWaypoints: Waypoint[] = [];

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i]!;
		const segDist = segmentDistances[i]!;

		// Time for this segment, proportional to its distance
		const segTimeMs = (segDist / totalSegDist) * totalTimeMs;

		// Aggression: high for early segments, low for late ones
		const progress = segments.length === 1 ? 0.5 : i / (segments.length - 1);
		const aggression = 0.9 - progress * 0.7; // 0.9 → 0.2

		// Wobble amplitude: decreases with each segment
		const wobble = clamp(segDist * 0.08 * (1 - progress * 0.8), 0.5, 15);

		const waypoints = segmentWaypoints(seg.from, seg.to, segTimeMs, aggression, wobble);
		allWaypoints.push(...waypoints);

		// Inter-segment pause (except after last segment)
		if (i < segments.length - 1) {
			const pauseMs = 10 + Math.random() * 30;
			const lastWp = allWaypoints[allWaypoints.length - 1];
			if (lastWp) {
				lastWp.delayMs += Math.round(pauseMs);
			}
		}
	}

	// Ensure final waypoint lands exactly on target
	if (allWaypoints.length > 0) {
		const last = allWaypoints[allWaypoints.length - 1]!;
		last.x = Math.round(to.x);
		last.y = Math.round(to.y);
	}

	return allWaypoints;
}
