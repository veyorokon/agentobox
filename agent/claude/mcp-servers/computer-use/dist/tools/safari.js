/**
 * Safari DOM bridge — page_map, scroll_to, find_element tools.
 *
 * Gives Claude structural awareness of the browser page by querying Safari's
 * DOM via osascript and translating viewport coordinates to screen coordinates
 * that work with the computer tool's click/scroll actions.
 */
import { z } from 'zod';
import { execFileSync } from 'node:child_process';
import { jsonResult } from '../utils/response.js';
import { getApiToLogicalScale, humanScroll } from './computer.js';
import { mouse, screen, Point } from '@nut-tree-fork/nut-js';
import { setTimeout } from 'node:timers/promises';
// --- Shared helpers ---
/**
 * Execute JavaScript in Safari's front document via osascript.
 * Returns the string result of the JS expression.
 */
function safariJS(code) {
    // Escape backslashes and double quotes for AppleScript string literal
    const escaped = code.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    // Use execFileSync to avoid shell interpretation (single quotes in JS would break shell)
    const result = execFileSync('osascript', [
        '-e',
        `tell application "Safari" to do JavaScript "${escaped}" in front document`,
    ], { encoding: 'utf-8', timeout: 10_000 });
    return result.trim();
}
/**
 * Get the screen position of Safari's content area (top-left corner).
 * Combines AppleScript window bounds with JS toolbar height measurement.
 */
function getSafariContentOffset() {
    // Dynamically compute where viewport (0,0) sits on screen.
    // Read fresh values on every call — adapts to window moves, resizes,
    // DevTools open/close, toolbar changes.
    //
    // Horizontal: screenX = window left edge. Content starts here regardless of
    // right-docked DevTools width. Works for any DevTools width or no DevTools.
    // Vertical: screenY = window top edge. Add chrome height (toolbar/tab bar)
    // to get content top. Works regardless of DevTools docked at bottom.
    //
    // Known limitation: if Safari's left bookmarks sidebar is open, content shifts
    // right but screenX doesn't account for it. Close the sidebar for accurate coords.
    const info = JSON.parse(safariJS('JSON.stringify({sx: window.screenX, sy: window.screenY, ch: window.outerHeight - window.innerHeight})'));
    return { x: info.sx, y: info.sy + info.ch };
}
/**
 * Convert DOM viewport coordinates to API image coordinates.
 * API image coords match what Claude sees in screenshots and can pass to left_click.
 */
function domToApiCoords(vx, vy, offset, apiToLogicalScale) {
    const screenX = vx + offset.x;
    const screenY = vy + offset.y;
    return [
        Math.round(screenX / apiToLogicalScale),
        Math.round(screenY / apiToLogicalScale),
    ];
}
// --- Element info extraction JS (shared across tools) ---
/**
 * JS snippet that extracts element info from a DOM element reference `el`.
 * Assumes `el` and `vh`/`vw` (viewport dimensions) are in scope.
 */
const EXTRACT_ELEMENT_JS = `
function extractElement(el, vw, vh) {
	var rect = el.getBoundingClientRect();
	var style = window.getComputedStyle(el);
	var isVisible = style.display !== 'none' && style.visibility !== 'hidden' &&
		rect.width > 0 && rect.height > 0 && style.opacity !== '0';
	var inViewport = rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
	var text = (el.innerText || el.textContent || '').trim().substring(0, 80);
	var tag = el.tagName.toLowerCase();

	return {
		tag: tag,
		type: el.type || null,
		text: text,
		href: el.href || null,
		id: el.id || null,
		name: el.name || null,
		ariaLabel: el.getAttribute('aria-label') || null,
		placeholder: el.placeholder || null,
		role: el.getAttribute('role') || null,
		cx: Math.round(rect.left + rect.width / 2),
		cy: Math.round(rect.top + rect.height / 2),
		width: Math.round(rect.width),
		height: Math.round(rect.height),
		isVisible: isVisible,
		inViewport: inViewport && isVisible
	};
}
`;
// --- Tool registration ---
export function registerSafari(server) {
    // --- find_element ---
    server.registerTool('find_element', {
        title: 'Find Element in Safari',
        description: `Find element(s) in the current Safari page by CSS selector or text content. Returns position, metadata, and whether each element is in the viewport. Coordinates are in screenshot space — pass them directly to left_click.

Use this to locate elements without taking a screenshot. Provide either a CSS selector (e.g. "button", "a[href*='/jobs/']") or text to search for (case-insensitive partial match). Returns up to max_results elements with their tag, text, href, aria-label, coordinates, and viewport visibility.`,
        inputSchema: z.object({
            selector: z.string().optional().describe('CSS selector to match elements'),
            text: z.string().optional().describe('Find elements containing this text (case-insensitive partial match)'),
            max_results: z.number().optional().describe('Maximum results to return (default 5)'),
        }).strict(),
        annotations: { readOnlyHint: true },
    }, async (args) => {
        const { selector, text, max_results: maxResults = 5 } = args;
        if (!selector && !text) {
            throw new Error('Either selector or text is required');
        }
        const offset = getSafariContentOffset();
        const scale = await getApiToLogicalScale();
        let js;
        if (text) {
            // Text-based search: walk the DOM tree
            js = `(function() {
					${EXTRACT_ELEMENT_JS}
					var vw = window.innerWidth, vh = window.innerHeight;
					var target = ${JSON.stringify(text.toLowerCase())};
					var max = ${maxResults};
					var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
					var results = [];
					var node;
					while ((node = walker.nextNode()) && results.length < max) {
						var t = (node.innerText || node.textContent || '').trim().toLowerCase();
						if (t.includes(target) && t.length < 200) {
							results.push(extractElement(node, vw, vh));
						}
					}
					return JSON.stringify(results);
				})()`;
        }
        else {
            js = `(function() {
					${EXTRACT_ELEMENT_JS}
					var vw = window.innerWidth, vh = window.innerHeight;
					var els = document.querySelectorAll(${JSON.stringify(selector)});
					var results = [];
					for (var i = 0; i < Math.min(els.length, ${maxResults}); i++) {
						results.push(extractElement(els[i], vw, vh));
					}
					return JSON.stringify(results);
				})()`;
        }
        const raw = safariJS(js);
        const elements = JSON.parse(raw || '[]');
        // Translate viewport coords to API image coords
        const mapped = elements.map((el) => {
            const [apiX, apiY] = domToApiCoords(el.cx, el.cy, offset, scale);
            return { ...el, api_x: apiX, api_y: apiY };
        });
        return jsonResult({
            count: mapped.length,
            elements: mapped,
        });
    });
    // --- scroll_to ---
    server.registerTool('scroll_to', {
        title: 'Scroll to Element in Safari',
        description: `Scroll a specific element into view in Safari and return its screen coordinates. The element is centered in the viewport. Coordinates are in screenshot space — pass them directly to left_click.

Uses human-like mouse wheel scrolling (stepped 40-120px increments with variable delays) — not programmatic scrollIntoView. Computes the scroll delta needed, moves the mouse to viewport center, then scrolls with the mouse wheel. After scrolling, re-reads the element position and returns updated coordinates.`,
        inputSchema: z.object({
            selector: z.string().describe('CSS selector for the element to scroll to'),
        }).strict(),
        annotations: { readOnlyHint: false },
    }, async (args) => {
        const { selector } = args;
        // Step 1: Find element and compute scroll delta to center it in viewport
        const infoJs = `(function() {
				${EXTRACT_ELEMENT_JS}
				var vw = window.innerWidth, vh = window.innerHeight;
				var el = document.querySelector(${JSON.stringify(selector)});
				if (!el) return JSON.stringify({error: 'Element not found'});
				var rect = el.getBoundingClientRect();
				var elCenterY = rect.top + rect.height / 2;
				var vpCenterY = vh / 2;
				var scrollDelta = Math.round(elCenterY - vpCenterY);
				var info = extractElement(el, vw, vh);
				info.scrollDelta = scrollDelta;
				info.scrollY = window.scrollY;
				info.pageHeight = document.documentElement.scrollHeight;
				info.viewportHeight = vh;
				return JSON.stringify(info);
			})()`;
        const raw = safariJS(infoJs);
        const info = JSON.parse(raw || '{}');
        if (info.error) {
            throw new Error(info.error);
        }
        const scrollDelta = info.scrollDelta ?? 0;
        // Step 2: If element needs scrolling, use human-like mouse wheel scroll
        if (Math.abs(scrollDelta) > 10) {
            // Move mouse to center of viewport first (natural scroll position)
            const sw = await screen.width();
            const sh = await screen.height();
            const offset = getSafariContentOffset();
            const vpCenterX = offset.x + Number(safariJS('window.innerWidth / 2'));
            const vpCenterY = offset.y + Number(safariJS('window.innerHeight / 2'));
            // Clamp to screen bounds
            const mx = Math.max(0, Math.min(sw - 1, vpCenterX));
            const my = Math.max(0, Math.min(sh - 1, vpCenterY));
            await mouse.setPosition(new Point(mx, my));
            // Scroll using human-like stepped mouse wheel
            const direction = scrollDelta > 0 ? 'down' : 'up';
            await humanScroll(direction, Math.abs(scrollDelta));
            // Wait for scroll to settle
            await setTimeout(200);
        }
        // Step 3: Re-read element position after scroll
        const afterJs = `(function() {
				${EXTRACT_ELEMENT_JS}
				var vw = window.innerWidth, vh = window.innerHeight;
				var el = document.querySelector(${JSON.stringify(selector)});
				if (!el) return JSON.stringify({error: 'Element not found after scroll'});
				var info = extractElement(el, vw, vh);
				info.scrollY = window.scrollY;
				info.pageHeight = document.documentElement.scrollHeight;
				info.viewportHeight = vh;
				return JSON.stringify(info);
			})()`;
        const afterRaw = safariJS(afterJs);
        const result = JSON.parse(afterRaw || '{}');
        if (result.error) {
            throw new Error(result.error);
        }
        const offsetAfter = getSafariContentOffset();
        const scale = await getApiToLogicalScale();
        const [apiX, apiY] = domToApiCoords(result.cx, result.cy, offsetAfter, scale);
        return jsonResult({
            ...result,
            api_x: apiX,
            api_y: apiY,
        });
    });
    // --- page_map ---
    server.registerTool('page_map', {
        title: 'Map Interactive Elements in Safari',
        description: `Returns a structured list of interactive elements on the current Safari page with their text content and screen coordinates. Coordinates are in screenshot space — pass them directly to left_click. Use this to understand page structure without relying solely on screenshots.

By default returns only elements visible in the viewport. Set viewport_only=false to get ALL elements on the page (useful for planning scroll targets or understanding full page structure). Use the selector param to filter to specific element types (e.g. "a[href*='/jobs/']" for job links only). Max 100 elements returned.`,
        inputSchema: z.object({
            selector: z.string().optional().describe('Custom CSS selector. Default: all interactive elements (a, button, input, select, textarea, [role=button], [role=link])'),
            viewport_only: z.boolean().optional().describe('Only return elements currently visible in viewport (default true)'),
        }).strict(),
        annotations: { readOnlyHint: true },
    }, async (args) => {
        const { selector, viewport_only: viewportOnly = true } = args;
        const defaultSelector = 'a, button, input, select, textarea, [role="button"], [role="link"], [onclick]';
        const sel = selector || defaultSelector;
        const js = `(function() {
				${EXTRACT_ELEMENT_JS}
				var vw = window.innerWidth, vh = window.innerHeight;
				var viewportOnly = ${viewportOnly ? 'true' : 'false'};
				var els = document.querySelectorAll(${JSON.stringify(sel)});
				var results = [];
				for (var i = 0; i < els.length && results.length < 100; i++) {
					var info = extractElement(els[i], vw, vh);
					if (!info.isVisible) continue;
					if (viewportOnly && !info.inViewport) continue;
					results.push(info);
				}
				return JSON.stringify({
					elements: results,
					page: {
						scrollX: window.scrollX,
						scrollY: window.scrollY,
						pageWidth: document.documentElement.scrollWidth,
						pageHeight: document.documentElement.scrollHeight,
						viewportWidth: vw,
						viewportHeight: vh,
						url: window.location.href,
						title: document.title
					}
				});
			})()`;
        const raw = safariJS(js);
        const data = JSON.parse(raw || '{"elements":[],"page":{}}');
        const offset = getSafariContentOffset();
        const scale = await getApiToLogicalScale();
        const mapped = data.elements.map((el) => {
            const [apiX, apiY] = domToApiCoords(el.cx, el.cy, offset, scale);
            return { ...el, api_x: apiX, api_y: apiY };
        });
        return jsonResult({
            count: mapped.length,
            elements: mapped,
            page: data.page,
        });
    });
}
