'use client';

import { useState, useEffect } from 'react';

export const THEMES = ['cyberpunk', 'retro', 'rose-pine', 'hyper'] as const;
export type Theme = (typeof THEMES)[number];

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('cyberpunk');

  useEffect(() => {
    const saved = localStorage.getItem('agentbox-theme') as Theme | null;
    if (saved && THEMES.includes(saved)) {
      setThemeState(saved);
      document.documentElement.setAttribute('data-theme', saved);
    }
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('agentbox-theme', t);
  };

  return { theme, setTheme, themes: THEMES };
}

// ---------------------------------------------------------------------------
// Theme token resolution: CSS vars -> hex map for agent desktops
// ---------------------------------------------------------------------------

const THEME_TOKEN_VARS = [
  'background',
  'foreground',
  'surface',
  'accent',
  'muted-foreground',
  'destructive',
] as const;

type RGBA = { r: number; g: number; b: number; a: number };

function parseColor(raw: string): RGBA {
  const s = raw.trim();

  if (s.startsWith('#')) {
    // #RGB
    if (s.length === 4) {
      return {
        r: parseInt(s[1] + s[1], 16),
        g: parseInt(s[2] + s[2], 16),
        b: parseInt(s[3] + s[3], 16),
        a: 1,
      };
    }
    // #RRGGBB
    if (s.length === 7) {
      return {
        r: parseInt(s.slice(1, 3), 16),
        g: parseInt(s.slice(3, 5), 16),
        b: parseInt(s.slice(5, 7), 16),
        a: 1,
      };
    }
    // #RRGGBBAA
    if (s.length === 9) {
      return {
        r: parseInt(s.slice(1, 3), 16),
        g: parseInt(s.slice(3, 5), 16),
        b: parseInt(s.slice(5, 7), 16),
        a: parseInt(s.slice(7, 9), 16) / 255,
      };
    }
  }

  // rgba(r, g, b, a) or rgb(r, g, b)
  const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (m) {
    return {
      r: Math.round(Number(m[1])),
      g: Math.round(Number(m[2])),
      b: Math.round(Number(m[3])),
      a: m[4] !== undefined ? Number(m[4]) : 1,
    };
  }

  return { r: 0, g: 0, b: 0, a: 1 };
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

function compositeToHex(fg: RGBA, bg: RGBA): string {
  const a = fg.a;
  const r = fg.r * a + bg.r * (1 - a);
  const g = fg.g * a + bg.g * (1 - a);
  const b = fg.b * a + bg.b * (1 - a);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Resolve current CSS theme variables to a flat hex map.
 * RGBA values are alpha-composited against --background.
 * Keys match CSS var names (minus --): "muted-foreground", not "muted_foreground".
 */
export function resolveThemeTokens(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const bg = parseColor(style.getPropertyValue('--background'));
  const tokens: Record<string, string> = {};

  for (const name of THEME_TOKEN_VARS) {
    const raw = style.getPropertyValue(`--${name}`).trim();
    if (!raw) continue;
    const color = parseColor(raw);
    tokens[name] = color.a < 1 ? compositeToHex(color, bg) : `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
  }

  return tokens;
}
