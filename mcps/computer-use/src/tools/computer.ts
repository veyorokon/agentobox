import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {
	mouse,
	keyboard,
	Point,
	screen,
	Button,
	imageToJimp,
} from '@nut-tree-fork/nut-js';
import {execFileSync, execSync} from 'node:child_process';
import {setTimeout} from 'node:timers/promises';
import sharp from 'sharp';
import {toKeys} from '../xdotoolStringToKeys.js';
import {jsonResult} from '../utils/response.js';
import {generateHumanPath} from '../human-mouse.js';

// Configure nut-js — disable built-in delays, we handle timing ourselves
mouse.config.autoDelayMs = 0;
mouse.config.mouseSpeed = 0; // instant setPosition, our path generator handles speed
keyboard.config.autoDelayMs = 0; // we handle per-character delays

/**
 * Check if xdotool is available on this system.
 * Cached after first check.
 */
let xdotoolAvailable: boolean | undefined;
function hasXdotool(): boolean {
	if (xdotoolAvailable === undefined) {
		try {
			execFileSync('which', ['xdotool'], {stdio: 'ignore'});
			xdotoolAvailable = true;
		} catch {
			xdotoolAvailable = false;
		}
	}

	return xdotoolAvailable;
}

/**
 * Type text using xdotool, which correctly respects the X11 keyboard layout.
 *
 * nut-js's keyboard.type() uses libnut's typeString which maps characters to
 * X keycodes using a hardcoded US QWERTY lookup. This breaks when the X server's
 * keyboard layout differs, causing characters like : and ; to be swapped.
 * xdotool type uses XSendEvent with proper keymap lookups, so it works regardless
 * of the active keyboard layout.
 */
function xdotoolType(text: string): void {
	execFileSync('xdotool', [
		'type',
		'--clearmodifiers',
		'--delay',
		String(keyboard.config.autoDelayMs),
		'--',
		text,
	], {
		env: {...process.env, DISPLAY: process.env.DISPLAY || ':1'},
	});
}

/**
 * Move cursor from current position to target using human-like segmented motion.
 */
async function humanMove(to: [number, number]): Promise<void> {
	const from = await mouse.getPosition();
	const path = generateHumanPath(
		{x: from.x, y: from.y},
		{x: to[0], y: to[1]},
	);

	for (const wp of path) {
		await mouse.setPosition(new Point(wp.x, wp.y));
		if (wp.delayMs > 0) {
			await setTimeout(wp.delayMs);
		}
	}
}

/**
 * Human-like scrolling: break into small steps with variable delays,
 * simulating real scroll wheel notches (40-120px each).
 * Exported for reuse in safari.ts scroll_to.
 */
export async function humanScroll(direction: 'up' | 'down', amount: number): Promise<void> {
	const scrollFn = direction === 'up'
		? (px: number) => mouse.scrollUp(px)
		: (px: number) => mouse.scrollDown(px);

	let remaining = amount;
	while (remaining > 0) {
		const step = Math.min(remaining, 40 + Math.floor(Math.random() * 80));
		await scrollFn(step);
		remaining -= step;
		if (remaining > 0) {
			await setTimeout(15 + Math.random() * 35);
		}
	}
}

/**
 * Small random drift after clicking — humans don't hold the cursor
 * perfectly still on the exact pixel. Also prevents the screenshot
 * crosshair from occluding the element that was just clicked.
 */
async function postClickDrift(): Promise<void> {
	const pos = await mouse.getPosition();
	const angle = Math.random() * 2 * Math.PI;
	const distance = 20 + Math.random() * 30; // 20-50px away
	const nx = Math.round(pos.x + Math.cos(angle) * distance);
	const ny = Math.round(pos.y + Math.sin(angle) * distance);
	const sw = await screen.width();
	const sh = await screen.height();
	const tx = Math.max(0, Math.min(sw - 1, nx));
	const ty = Math.max(0, Math.min(sh - 1, ny));
	const path = generateHumanPath({x: pos.x, y: pos.y}, {x: tx, y: ty});
	for (const wp of path) {
		await mouse.setPosition(new Point(wp.x, wp.y));
		if (wp.delayMs > 0) {
			await setTimeout(wp.delayMs);
		}
	}
}

/**
 * Type text with human-like variable delays between characters.
 * Base 30-70ms per char, with 10% chance of a longer "thinking" pause.
 */
async function humanType(text: string): Promise<void> {
	if (process.platform === 'linux' && hasXdotool()) {
		// For xdotool, we type in small chunks with variable delays
		for (const char of text) {
			const delay = 30 + Math.random() * 40 + (Math.random() > 0.9 ? 80 : 0);
			xdotoolType(char);
			await setTimeout(delay);
		}
	} else {
		for (const char of text) {
			const delay = 30 + Math.random() * 40 + (Math.random() > 0.9 ? 80 : 0);
			await keyboard.type(char);
			await setTimeout(delay);
		}
	}
}

// The Claude API automatically downsamples images larger than ~1.15MP or 1568px on the long edge.
// We already downsampled screenshots to fit these limits and reported the original screen
// dimensions via display_width_px/display_height_px, but Claude wasn't correctly using those
// reported dimensions - it was using coordinates from the downsampled image space directly.
// As a workaround, we now report the actual image dimensions and scale Claude's coordinates
// back up to logical screen coordinates.
// See: https://docs.anthropic.com/en/docs/build-with-claude/vision#evaluate-image-size
const maxLongEdge = 1568;
const maxPixels = 1.15 * 1024 * 1024; // 1.15 megapixels

/**
 * Calculate the scale factor to downsample an image to fit API limits.
 * Returns a value <= 1 representing how much to shrink the image.
 */
function getSizeToApiScale(width: number, height: number): number {
	const longEdge = Math.max(width, height);
	const totalPixels = width * height;

	const longEdgeScale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
	const pixelScale = totalPixels > maxPixels ? Math.sqrt(maxPixels / totalPixels) : 1;

	return Math.min(longEdgeScale, pixelScale);
}

/**
 * Get the scale factor from API image coordinates to logical screen coordinates.
 * This is the inverse of the downsampling we apply to fit API limits.
 */
export async function getApiToLogicalScale(): Promise<number> {
	const logicalWidth = await screen.width();
	const logicalHeight = await screen.height();
	const apiScaleFactor = getSizeToApiScale(logicalWidth, logicalHeight);
	return 1 / apiScaleFactor;
}

// Define the action enum values
const ActionEnum = z.enum([
	'key',
	'type',
	'mouse_move',
	'left_click',
	'left_click_drag',
	'right_click',
	'middle_click',
	'double_click',
	'mouse_down',
	'mouse_up',
	'scroll',
	'get_screenshot',
	'get_cursor_position',
	'multi_click',
]);

const actionDescription = `The action to perform. The available actions are:
* key: Press a key or key-combination on the keyboard.
* type: Type a string of text on the keyboard.
* get_cursor_position: Get the current (x, y) pixel coordinate of the cursor on the screen.
* mouse_move: Move the cursor to a specified (x, y) pixel coordinate on the screen.
* left_click: Click the left mouse button. If coordinate is provided, moves to that position first.
* left_click_drag: Click and drag the cursor to a specified (x, y) pixel coordinate on the screen.
* right_click: Click the right mouse button. If coordinate is provided, moves to that position first.
* middle_click: Click the middle mouse button. If coordinate is provided, moves to that position first.
* double_click: Double-click the left mouse button. If coordinate is provided, moves to that position first.
* mouse_down: Press and hold the left mouse button. If coordinate is provided, moves to that position first. Use with mouse_move + mouse_up for drag operations like captcha sliders.
* mouse_up: Release the left mouse button. If coordinate is provided, moves to that position first.
* scroll: Scroll the screen in a specified direction. Requires coordinate (moves there first) and text parameter with direction: "up", "down", "left", or "right". Optionally append ":N" to scroll N pixels (default 300), e.g. "down:500".
* get_screenshot: Take a screenshot of the screen.
* multi_click: Click a list of coordinates sequentially with human-like movement between each. Requires the "coordinates" parameter (array of [x, y] pairs). Useful for selecting multiple items like CAPTCHA grid squares.`;

const toolDescription = `Use a mouse and keyboard to interact with a computer, and take screenshots.
* This is an interface to a desktop GUI. You do not have access to a terminal or applications menu. You must click on desktop icons to start applications.
* Always prefer using keyboard shortcuts rather than clicking, where possible.
* If you see boxes with two letters in them, typing these letters will click that element. Use this instead of other shortcuts or clicking, where possible.
* Some applications may take time to start or process actions, so you may need to wait and take successive screenshots to see the results of your actions. E.g. if you click on Firefox and a window doesn't open, try taking another screenshot.
* Whenever you intend to move the cursor to click on an element like an icon, you should consult a screenshot to determine the coordinates of the element before moving the cursor.
* If you tried clicking on a program or link but it failed to load, even after waiting, try adjusting your cursor position so that the tip of the cursor visually falls on the element that you want to click.
* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element. Don't click boxes on their edges unless asked.

Using the crosshair:
* Screenshots show a red crosshair at the current cursor position.
* After clicking, check where the crosshair appears vs your target. If it missed, adjust coordinates proportionally to the distance - start with large adjustments and refine. Avoid small incremental changes when the crosshair is far from the target (distances are often further than you expect).
* Consider display dimensions when estimating positions. E.g. if it's 90% to the bottom of the screen, the coordinates should reflect this.`;

export function registerComputer(server: McpServer): void {
	server.registerTool(
		'computer',
		{
			title: 'Computer Control',
			description: toolDescription,
			inputSchema: z.object({
				action: ActionEnum.describe(actionDescription),
				coordinate: z.array(z.number()).max(2).optional().describe('[x, y]: The x (pixels from the left edge) and y (pixels from the top edge) coordinates. Must be exactly 2 numbers.'),
				coordinates: z.array(z.array(z.number()).length(2)).optional().describe('Array of [x, y] coordinate pairs for multi_click action. Each pair is clicked sequentially with human-like movement.'),
				text: z.string().optional().describe('Text to type or key command to execute'),
				intent: z.string().describe('Brief description of what you are trying to achieve with this action (e.g. "Opening Netflix pricing page"). Shown in the dashboard.'),
			}).strict(),
			// Note: No outputSchema because this tool returns varying content types including images
			annotations: {
				readOnlyHint: false,
			},
		},
		async (args) => {
			const {action, coordinate: rawCoordinate, coordinates: rawCoordinates, text} = args as {action: z.infer<typeof ActionEnum>; coordinate?: number[]; coordinates?: number[][]; text?: string};

			// Treat empty array as no coordinate
			const coordinate = (rawCoordinate && rawCoordinate.length === 2) ? rawCoordinate as [number, number] : undefined;

			// Scale coordinates from API image space to logical screen space
			let scaledCoordinate = coordinate;
			if (coordinate) {
				const scale = await getApiToLogicalScale();
				scaledCoordinate = [
					Math.round(coordinate[0] * scale),
					Math.round(coordinate[1] * scale),
				];

				// Validate coordinates are within display bounds
				const [x, y] = scaledCoordinate;
				const [width, height] = [await screen.width(), await screen.height()];
				if (x < 0 || x >= width || y < 0 || y >= height) {
					throw new Error(`Coordinates (${x}, ${y}) are outside display bounds of ${width}x${height}`);
				}
			}

			// Implement system actions using nut-js
			switch (action) {
				case 'key': {
					if (!text) {
						throw new Error('Text required for key');
					}

					const keys = toKeys(text);
					await keyboard.pressKey(...keys);
					await keyboard.releaseKey(...keys);

					return jsonResult({ok: true});
				}

				case 'type': {
					if (!text) {
						throw new Error('Text required for type');
					}

					await humanType(text);
					return jsonResult({ok: true});
				}

				case 'get_cursor_position': {
					const pos = await mouse.getPosition();
					const scale = await getApiToLogicalScale();
					// Return coordinates in API image space (scaled down from logical)
					// so Claude can correlate with what it sees in screenshots
					return jsonResult({
						x: Math.round(pos.x / scale),
						y: Math.round(pos.y / scale),
					});
				}

				case 'mouse_move': {
					if (!scaledCoordinate) {
						throw new Error('Coordinate required for mouse_move');
					}

					await humanMove(scaledCoordinate);
					return jsonResult({ok: true});
				}

				case 'left_click': {
					if (scaledCoordinate) {
						await humanMove(scaledCoordinate);
					}

					await mouse.leftClick();
					return jsonResult({ok: true});
				}

				case 'left_click_drag': {
					if (!scaledCoordinate) {
						throw new Error('Coordinate required for left_click_drag');
					}

					await mouse.pressButton(Button.LEFT);
					await humanMove(scaledCoordinate);
					await mouse.releaseButton(Button.LEFT);
					return jsonResult({ok: true});
				}

				case 'right_click': {
					if (scaledCoordinate) {
						await humanMove(scaledCoordinate);
					}

					await mouse.rightClick();
					return jsonResult({ok: true});
				}

				case 'middle_click': {
					if (scaledCoordinate) {
						await humanMove(scaledCoordinate);
					}

					await mouse.click(Button.MIDDLE);
					return jsonResult({ok: true});
				}

				case 'double_click': {
					if (scaledCoordinate) {
						await humanMove(scaledCoordinate);
					}

					await mouse.doubleClick(Button.LEFT);
					return jsonResult({ok: true});
				}

				case 'mouse_down': {
					if (scaledCoordinate) {
						await humanMove(scaledCoordinate);
					}

					await mouse.pressButton(Button.LEFT);
					return jsonResult({ok: true});
				}

				case 'mouse_up': {
					if (scaledCoordinate) {
						await humanMove(scaledCoordinate);
					}

					await mouse.releaseButton(Button.LEFT);
					return jsonResult({ok: true});
				}

				case 'scroll': {
					if (!scaledCoordinate) {
						throw new Error('Coordinate required for scroll');
					}

					if (!text) {
						throw new Error('Text required for scroll (direction like "up", "down:5")');
					}

					// Parse direction and optional amount from text (e.g. "down" or "down:5")
					const parts = text.split(':');
					const direction = parts[0];
					const amountStr = parts[1];
					const amount = amountStr ? parseInt(amountStr, 10) : 300;

					if (!direction) {
						throw new Error('Scroll direction required');
					}

					if (amountStr !== undefined && (isNaN(amount) || amount <= 0)) {
						throw new Error(`Invalid scroll amount: ${amountStr}`);
					}

					// Move to position first
					await humanMove(scaledCoordinate);

					// Use shared humanScroll for up/down, inline for left/right
					const dir = direction.toLowerCase();
					if (dir === 'up' || dir === 'down') {
						await humanScroll(dir, amount);
					} else {
						const scrollFn = (px: number) => {
							switch (dir) {
								case 'left': return mouse.scrollLeft(px);
								case 'right': return mouse.scrollRight(px);
								default:
									throw new Error(`Invalid scroll direction: ${direction}. Use "up", "down", "left", or "right"`);
							}
						};

						let remaining = amount;
						while (remaining > 0) {
							const step = Math.min(remaining, 40 + Math.floor(Math.random() * 80));
							await scrollFn(step);
							remaining -= step;
							if (remaining > 0) {
								await setTimeout(15 + Math.random() * 35);
							}
						}
					}

					return jsonResult({ok: true});
				}

				case 'multi_click': {
					if (!rawCoordinates || rawCoordinates.length === 0) {
						throw new Error('coordinates array required for multi_click');
					}

					const scale = await getApiToLogicalScale();
					for (const coord of rawCoordinates) {
						const scaled: [number, number] = [
							Math.round(coord[0]! * scale),
							Math.round(coord[1]! * scale),
						];
						await humanMove(scaled);
						await mouse.leftClick();
						// Human-like delay between clicks
						await setTimeout(150 + Math.random() * 300);
					}

					return jsonResult({ok: true, clicked: rawCoordinates.length});
				}

				case 'get_screenshot': {
				// Wait a bit to let things load before showing it to Claude
				await setTimeout(1000);

				// Get cursor position in logical coordinates
				const cursorPos = await mouse.getPosition();

				let optimizedBuffer: Buffer;
				let imageWidth: number;
				let imageHeight: number;

				if (process.platform === 'darwin') {
					// macOS: use screencapture which excludes the cursor by default
					const tmpPath = new URL('../../.screenshots/capture.png', import.meta.url).pathname;
					execSync(`screencapture -x ${tmpPath}`);
					const raw = await sharp(tmpPath).metadata();
					const fullW = raw.width!;
					const fullH = raw.height!;

					// Resize to fit API limits
					const apiScaleFactor = getSizeToApiScale(fullW, fullH);
					if (apiScaleFactor < 1) {
						imageWidth = Math.floor(fullW * apiScaleFactor);
						imageHeight = Math.floor(fullH * apiScaleFactor);
						optimizedBuffer = await sharp(tmpPath)
							.resize(imageWidth, imageHeight)
							.png({compressionLevel: 9})
							.toBuffer();
					} else {
						imageWidth = fullW;
						imageHeight = fullH;
						optimizedBuffer = await sharp(tmpPath)
							.png({compressionLevel: 9})
							.toBuffer();
					}
				} else {
					// Linux/other: fall back to nut-js screen.grab()
					const image = imageToJimp(await screen.grab());
					const apiScaleFactor = getSizeToApiScale(image.getWidth(), image.getHeight());
					if (apiScaleFactor < 1) {
						image.resize(
							Math.floor(image.getWidth() * apiScaleFactor),
							Math.floor(image.getHeight() * apiScaleFactor),
						);
					}
					imageWidth = image.getWidth();
					imageHeight = image.getHeight();
					const pngBuffer = await image.getBufferAsync('image/png');
					optimizedBuffer = await sharp(pngBuffer)
						.png({compressionLevel: 9})
						.toBuffer();
				}

				// Convert optimized buffer to base64
				const base64Data = optimizedBuffer.toString('base64');

					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify({
									image_width: imageWidth,
									image_height: imageHeight,
									cursor_x: Math.round(cursorPos.x / (await getApiToLogicalScale())),
									cursor_y: Math.round(cursorPos.y / (await getApiToLogicalScale())),
								}),
							},
							{
								type: 'image',
								data: base64Data,
								mimeType: 'image/png',
							},
						],
					};
				}
			}
		},
	);
}
