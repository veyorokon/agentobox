# Design Token Architecture

## Token Hierarchy

Three tiers, each referencing the one below. Only semantic tokens appear in component code.

```
Primitive (raw values)
  -> Semantic (purpose-based aliases)
    -> Component code (Tailwind utilities consuming semantic tokens)
```

**Primitive tokens** are raw design values — color stops, pixel values, font stacks. They live in `:root` as plain CSS variables. They are never used directly in components. They exist so that a theme can be defined by remapping semantic tokens to different primitives.

**Semantic tokens** are purpose-based aliases registered in `@theme` or `@theme inline`. They describe WHAT something is for, not what it looks like. These are what components consume via Tailwind utilities (`bg-surface`, `text-muted`, `rounded-lg`, etc.).

**Component tokens** are NOT a separate layer of CSS variables. In our system, components compose semantic tokens via Tailwind classes. If a component needs a one-off combination (e.g., sidebar background), it uses a semantic token directly. We do not create `--sidebar-background` variables unless the same value is reused across 3+ components — and even then, only if the components share a semantic role, not just a color coincidence.

Why no component token layer: shadcn/ui proved that `--sidebar-*` variables proliferate quickly and create maintenance burden without proportional value. GitHub Primer's 500+ tokens show where component tokens lead. Our app has ~20 components; the semantic layer provides enough abstraction.

---

## Theme Switching Mechanism

Themes are swapped by changing a `data-theme` attribute on `<html>`. Each theme is a CSS rule that overrides the primitive variables. Semantic tokens reference primitives, so the entire UI updates.

```html
<html lang="en" data-theme="claude" data-mode="dark">
```

- `data-theme` selects the color palette (e.g., `claude`, `cyberpunk`, `minimal`)
- `data-mode` selects light vs dark within that palette

The CSS structure:

```css
/* Primitives — per theme, per mode */
[data-theme="claude"][data-mode="dark"] {
  --p-bg-1: hsl(60 2.7% 14.5%);
  --p-bg-2: hsl(30 3.3% 11.8%);
  /* ... all primitives ... */
}

[data-theme="claude"][data-mode="light"] {
  --p-bg-1: hsl(0 0% 100%);
  --p-bg-2: hsl(220 14% 96%);
  /* ... all primitives ... */
}

[data-theme="cyberpunk"][data-mode="dark"] {
  --p-bg-1: hsl(270 20% 8%);
  --p-bg-2: hsl(270 25% 5%);
  /* ... */
}

/* Semantic tokens — theme-agnostic, defined once */
@theme inline {
  --color-surface: var(--p-bg-1);
  --color-surface-sunken: var(--p-bg-2);
  /* ... */
}
```

Theme switching in JS is one line:

```ts
document.documentElement.dataset.theme = "cyberpunk";
document.documentElement.dataset.mode = "light";
```

### Why `@theme inline` for semantics

Tailwind v4's `@theme` registers CSS variables as theme variables, generating utility classes. But `@theme` values are static — they compile at build time. `@theme inline` tells Tailwind "this variable's value is dynamic; resolve it at runtime via `var()`." This is mandatory for theming because our semantic tokens reference primitives that change at runtime.

The pattern: `@theme inline` for semantic tokens that alias primitives; `@theme` for values that are truly static across all themes (like font stacks or the spacing scale).

---

## Complete Token List

### Colors

#### Surfaces (backgrounds)

| Token | CSS Variable | Semantic Meaning | Dark (claude) | Light (claude) |
|-------|-------------|------------------|---------------|----------------|
| `bg-surface` | `--color-surface` | Primary app background (body, main areas) | `hsl(60 2.7% 14.5%)` | `hsl(0 0% 100%)` |
| `bg-surface-raised` | `--color-surface-raised` | Elevated surface (cards, sidebar, header) | `hsl(60 2.1% 18.4%)` | `hsl(0 0% 98%)` |
| `bg-surface-sunken` | `--color-surface-sunken` | Recessed surface (code blocks, inset areas) | `hsl(30 3.3% 11.8%)` | `hsl(220 14% 96%)` |
| `bg-surface-overlay` | `--color-surface-overlay` | Overlays (modals, popovers, dropdowns) | `hsl(60 2.1% 18.4%)` | `hsl(0 0% 100%)` |
| `bg-surface-backdrop` | `--color-surface-backdrop` | Scrim behind overlays | `hsl(0 0% 0%)` | `hsl(0 0% 0%)` |
| `bg-surface-invert` | `--color-surface-invert` | Inverted surface (badges, pills on contrast bg) | `hsl(0 0% 100%)` | `hsl(0 0% 0%)` |

Current mapping: `bg-000` -> `surface-raised`, `bg-100` -> `surface`, `bg-200` -> `surface-raised` (sidebar), `bg-300` -> `surface-sunken`, `bg-400/500` -> `surface-backdrop`.

#### Text

| Token | CSS Variable | Semantic Meaning | Dark (claude) | Light (claude) |
|-------|-------------|------------------|---------------|----------------|
| `text-default` | `--color-text-default` | Primary body text, headings | `hsl(48 33.3% 97.1%)` | `hsl(0 0% 9%)` |
| `text-secondary` | `--color-text-secondary` | Secondary text, descriptions | `hsl(50 9% 73.7%)` | `hsl(0 0% 32%)` |
| `text-muted` | `--color-text-muted` | Tertiary text, captions, timestamps | `hsl(48 4.8% 59.2%)` | `hsl(0 0% 45%)` |
| `text-disabled` | `--color-text-disabled` | Disabled text, placeholders | `hsl(48 4.8% 59.2% / 0.5)` | `hsl(0 0% 45% / 0.5)` |
| `text-on-emphasis` | `--color-text-on-emphasis` | Text on colored/accent backgrounds | `hsl(0 0% 100%)` | `hsl(0 0% 100%)` |
| `text-on-invert` | `--color-text-on-invert` | Text on inverted surface | `hsl(0 0% 0%)` | `hsl(0 0% 100%)` |

Current mapping: `text-000` -> `text-default` (headings), `text-100` -> `text-default` (body), `text-200/300` -> `text-secondary`, `text-400/500` -> `text-muted`, `oncolor-100/200` -> `text-on-emphasis`.

#### Borders

| Token | CSS Variable | Semantic Meaning | Dark (claude) | Light (claude) |
|-------|-------------|------------------|---------------|----------------|
| `border-default` | `--color-border-default` | Standard borders (cards, inputs, dividers) | `hsl(51 16.5% 84.5% / 0.15)` | `hsl(220 13% 91%)` |
| `border-subtle` | `--color-border-subtle` | Low-contrast borders (section dividers) | `hsl(51 16.5% 84.5% / 0.08)` | `hsl(220 13% 95%)` |
| `border-strong` | `--color-border-strong` | High-contrast borders (focus rings, emphasis) | `hsl(51 16.5% 84.5% / 0.30)` | `hsl(220 13% 80%)` |

Current mapping: `border-300` with various `color-mix` opacities -> `border-default`/`border-subtle`/`border-strong`. The current system uses 4 identical border values — this is a simplification.

#### Brand / Accent

| Token | CSS Variable | Semantic Meaning | Dark (claude) | Light (claude) |
|-------|-------------|------------------|---------------|----------------|
| `bg-accent` | `--color-accent` | Primary brand accent (buttons, links, active states) | `hsl(15 54.2% 51.2%)` | `hsl(15 63% 48%)` |
| `bg-accent-hover` | `--color-accent-hover` | Accent hover state | `hsl(15 63.1% 59.6%)` | `hsl(15 63% 42%)` |
| `bg-accent-subtle` | `--color-accent-subtle` | Subtle accent background (user message bg) | `hsl(15 54.2% 51.2% / 0.15)` | `hsl(15 63% 48% / 0.1)` |
| `text-accent` | `--color-text-accent` | Accent-colored text | `hsl(15 63.1% 59.6%)` | `hsl(15 63% 42%)` |

Current mapping: `accent-main-000` -> `accent`, `accent-main-100` -> `accent-hover`, `accent-main-200` -> `accent-hover` (duplicate).

#### Semantic Accents (secondary roles)

| Token | CSS Variable | Semantic Meaning | Dark (claude) | Light (claude) |
|-------|-------------|------------------|---------------|----------------|
| `bg-info` | `--color-info` | Informational accent (tool names, secondary highlights) | `hsl(210 65.5% 67.1%)` | `hsl(210 70% 50%)` |
| `text-info` | `--color-text-info` | Informational text | `hsl(210 65.5% 67.1%)` | `hsl(210 70% 40%)` |
| `text-info-hover` | `--color-text-info-hover` | Info text hover | `hsl(210 70.9% 51.6%)` | `hsl(210 70% 35%)` |
| `bg-pro` | `--color-pro` | Pro/premium accent | `hsl(251 84.6% 74.5%)` | `hsl(251 60% 55%)` |
| `text-pro` | `--color-text-pro` | Pro text color | `hsl(251 84.6% 74.5%)` | `hsl(251 60% 45%)` |

Current mapping: `accent-secondary-*` -> `info`, `accent-pro-*` -> `pro`.

#### Status

| Token | CSS Variable | Semantic Meaning | Dark (claude) | Light (claude) |
|-------|-------------|------------------|---------------|----------------|
| `bg-success` | `--color-success` | Success indicator (dots, badges) | `hsl(97 59.1% 46.1%)` | `hsl(142 72% 42%)` |
| `text-success` | `--color-text-success` | Success text | `hsl(97 59.1% 46.1%)` | `hsl(142 72% 32%)` |
| `bg-success-subtle` | `--color-success-subtle` | Success background (result cards) | `hsl(127 100% 13.9% / 0.2)` | `hsl(142 72% 95%)` |
| `bg-danger` | `--color-danger` | Error/danger indicator | `hsl(0 98.4% 75.1%)` | `hsl(0 72% 51%)` |
| `text-danger` | `--color-text-danger` | Error text | `hsl(0 98.4% 75.1%)` | `hsl(0 72% 41%)` |
| `bg-danger-subtle` | `--color-danger-subtle` | Error background | `hsl(0 46.5% 27.8% / 0.2)` | `hsl(0 72% 97%)` |
| `bg-warning` | `--color-warning` | Warning indicator | `hsl(40 71% 50%)` | `hsl(38 92% 50%)` |
| `text-warning` | `--color-text-warning` | Warning text | `hsl(40 71% 50%)` | `hsl(38 92% 40%)` |

Current mapping: `danger-000` -> `text-danger`, `danger-100/200` -> `bg-danger`, `danger-900` -> `bg-danger-subtle`, and similarly for success/warning.

#### Interactive

| Token | CSS Variable | Semantic Meaning | Dark (claude) | Light (claude) |
|-------|-------------|------------------|---------------|----------------|
| `bg-interactive` | `--color-interactive` | Hover background for interactive elements | `hsl(60 2.1% 18.4% / 0.4)` | `hsl(220 14% 96%)` |
| `bg-interactive-active` | `--color-interactive-active` | Active/pressed state | `hsl(60 2.1% 18.4% / 0.8)` | `hsl(220 14% 93%)` |
| `ring-focus` | `--color-ring-focus` | Focus ring color | `hsl(15 63.1% 59.6% / 0.5)` | `hsl(15 63% 48% / 0.5)` |

Current mapping: various `hover:bg-bg-200/40` and `hover:bg-bg-000/50` patterns -> `bg-interactive`.

#### Constant

| Token | CSS Variable | Semantic Meaning | Dark (claude) | Light (claude) |
|-------|-------------|------------------|---------------|----------------|
| — | `--color-static-white` | Always white regardless of theme | `hsl(0 0% 100%)` | `hsl(0 0% 100%)` |
| — | `--color-static-black` | Always black regardless of theme | `hsl(0 0% 0%)` | `hsl(0 0% 0%)` |

Current mapping: `always-white`, `always-black`.

### Typography

| Token | CSS Variable | What It Controls | Value |
|-------|-------------|------------------|-------|
| `font-ui` | `--font-ui` | UI text (buttons, labels, body) | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` |
| `font-mono` | `--font-mono` | Code, tool names, timestamps | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace` |
| `font-display` | `--font-display` | Large headings, marketing (optional, defaults to `--font-ui`) | `var(--font-ui)` |
| `text-xs` | `--text-xs` | Smallest text (10px equiv) | `0.625rem` |
| `text-sm` | `--text-sm` | Small text (badges, captions) | `0.75rem` |
| `text-base` | `--text-base` | Body text | `0.875rem` |
| `text-lg` | `--text-lg` | Subheadings | `1rem` |
| `text-xl` | `--text-xl` | Section headings | `1.125rem` |
| `text-2xl` | `--text-2xl` | Page headings | `1.25rem` |
| `leading-tight` | `--leading-tight` | Compact line height | `1.25` |
| `leading-normal` | `--leading-normal` | Default line height | `1.5` |
| `leading-relaxed` | `--leading-relaxed` | Readable line height (prose) | `1.625` |

Note: Tailwind v4 already provides a font size scale and line height utilities out of the box. We are NOT redefining these as custom tokens. The table above documents what the app uses. Only `--font-ui`, `--font-mono`, and `--font-display` are custom tokens. Font sizes use Tailwind's built-in `text-xs` through `text-2xl`.

### Spacing

Tailwind v4 provides a spacing scale out of the box (0.25rem increments). We do NOT create custom spacing tokens. The built-in scale covers our needs.

If a project-specific spacing value recurs (e.g., sidebar width), it belongs in a component-level CSS variable or a Tailwind arbitrary value, not in the design token system.

### Border Radius

| Token | CSS Variable | What It Controls | Value |
|-------|-------------|------------------|-------|
| `rounded-sm` | `--radius-sm` | Small radius (tags, badges) | `0.25rem` |
| `rounded-md` | `--radius-md` | Medium radius (inputs, buttons) | `0.5rem` |
| `rounded-lg` | `--radius-lg` | Large radius (cards, modals) | `0.75rem` |
| `rounded-xl` | `--radius-xl` | Extra large radius (composer, overlay) | `1rem` |
| `rounded-full` | `--radius-full` | Pill shape (avatars, dots) | `9999px` |

Tailwind v4 has built-in radius utilities. We override the base value so all radii can be shifted by changing one variable:

```css
@theme {
  --radius-sm: calc(var(--radius) - 0.25rem);
  --radius-md: calc(var(--radius) - 0.125rem);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 0.25rem);
}
```

Where `--radius` is a single primitive that themes can adjust:

```css
[data-theme="claude"] { --radius: 0.75rem; }       /* current: rounded corners */
[data-theme="cyberpunk"] { --radius: 0.125rem; }    /* sharp, angular */
[data-theme="minimal"] { --radius: 1rem; }          /* very rounded */
```

### Shadows / Elevation

| Token | CSS Variable | What It Controls | Dark (claude) | Light (claude) |
|-------|-------------|------------------|---------------|----------------|
| `shadow-sm` | `--shadow-sm` | Subtle lift (hover cards) | `0 1px 2px hsl(0 0% 0% / 0.3)` | `0 1px 2px hsl(0 0% 0% / 0.05)` |
| `shadow-md` | `--shadow-md` | Moderate lift (dropdowns) | `0 4px 6px hsl(0 0% 0% / 0.4)` | `0 4px 6px hsl(0 0% 0% / 0.07)` |
| `shadow-lg` | `--shadow-lg` | High lift (modals, popovers) | `0 10px 15px hsl(0 0% 0% / 0.5)` | `0 10px 15px hsl(0 0% 0% / 0.1)` |

Dark themes need heavier shadows to create visual separation since the background is already dark. Light themes use lighter shadows. Theming shadows is critical — it is one of the main reasons dark modes "feel wrong" when only colors are swapped.

### Transitions / Motion

| Token | CSS Variable | What It Controls | Value |
|-------|-------------|------------------|-------|
| `duration-fast` | `--duration-fast` | Micro-interactions (hover, toggle) | `100ms` |
| `duration-normal` | `--duration-normal` | Standard transitions (expand, fade) | `150ms` |
| `duration-slow` | `--duration-slow` | Larger transitions (overlay, page) | `200ms` |
| `ease-default` | `--ease-default` | Standard easing | `cubic-bezier(0.4, 0, 0.2, 1)` |
| `ease-in` | `--ease-in` | Enter transitions | `cubic-bezier(0.4, 0, 1, 1)` |
| `ease-out` | `--ease-out` | Exit transitions | `cubic-bezier(0, 0, 0.2, 1)` |

Motion tokens are theme-agnostic in most cases. A "playful" theme might use longer durations and bouncier easing, but this is an edge case. Define them once and override per-theme only if needed.

### Z-Index

| Token | CSS Variable | What It Controls | Value |
|-------|-------------|------------------|-------|
| `z-base` | `--z-base` | Default stacking | `0` |
| `z-raised` | `--z-raised` | Raised elements (sticky headers) | `10` |
| `z-dropdown` | `--z-dropdown` | Dropdowns, popovers | `20` |
| `z-overlay` | `--z-overlay` | Overlays, modals, backdrops | `30` |
| `z-toast` | `--z-toast` | Toast notifications | `40` |
| `z-tooltip` | `--z-tooltip` | Tooltips (always on top) | `50` |

Z-index tokens are theme-agnostic. They exist to prevent the "z-index: 9999" arms race, not for theming.

---

## Implementation: Tailwind v4 Wiring

### File structure

```
dashboard/app/
  globals.css          <- imports, @theme, semantic tokens, base styles
  themes/
    claude-dark.css    <- [data-theme="claude"][data-mode="dark"] primitives
    claude-light.css   <- [data-theme="claude"][data-mode="light"] primitives
```

### globals.css structure

```css
@import "tailwindcss";
@import "./themes/claude-dark.css";
@import "./themes/claude-light.css";

/* ============================================
   Semantic tokens — purpose-based aliases
   These reference primitives set by theme files.
   @theme inline tells Tailwind these are dynamic.
   ============================================ */

@theme inline {
  /* Surfaces */
  --color-surface: var(--p-surface);
  --color-surface-raised: var(--p-surface-raised);
  --color-surface-sunken: var(--p-surface-sunken);
  --color-surface-overlay: var(--p-surface-overlay);
  --color-surface-backdrop: var(--p-surface-backdrop);
  --color-surface-invert: var(--p-surface-invert);

  /* Text */
  --color-text-default: var(--p-text-default);
  --color-text-secondary: var(--p-text-secondary);
  --color-text-muted: var(--p-text-muted);
  --color-text-disabled: var(--p-text-disabled);
  --color-text-on-emphasis: var(--p-text-on-emphasis);

  /* Borders */
  --color-border-default: var(--p-border-default);
  --color-border-subtle: var(--p-border-subtle);
  --color-border-strong: var(--p-border-strong);

  /* Accent */
  --color-accent: var(--p-accent);
  --color-accent-hover: var(--p-accent-hover);
  --color-accent-subtle: var(--p-accent-subtle);
  --color-text-accent: var(--p-text-accent);

  /* Info */
  --color-info: var(--p-info);
  --color-text-info: var(--p-text-info);
  --color-text-info-hover: var(--p-text-info-hover);

  /* Pro */
  --color-pro: var(--p-pro);
  --color-text-pro: var(--p-text-pro);

  /* Status */
  --color-success: var(--p-success);
  --color-text-success: var(--p-text-success);
  --color-success-subtle: var(--p-success-subtle);
  --color-danger: var(--p-danger);
  --color-text-danger: var(--p-text-danger);
  --color-danger-subtle: var(--p-danger-subtle);
  --color-warning: var(--p-warning);
  --color-text-warning: var(--p-text-warning);

  /* Interactive */
  --color-interactive: var(--p-interactive);
  --color-interactive-active: var(--p-interactive-active);
  --color-ring-focus: var(--p-ring-focus);
}

/* Static theme tokens (same across all themes) */
@theme {
  /* Fonts */
  --font-ui: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace;
  --font-display: var(--font-ui);

  /* Z-index */
  --z-base: 0;
  --z-raised: 10;
  --z-dropdown: 20;
  --z-overlay: 30;
  --z-toast: 40;
  --z-tooltip: 50;
}

/* Radius uses @theme inline because --p-radius is a theme primitive */
@theme inline {
  --radius-sm: calc(var(--p-radius) - 0.25rem);
  --radius-md: calc(var(--p-radius) - 0.125rem);
  --radius-lg: var(--p-radius);
  --radius-xl: calc(var(--p-radius) + 0.25rem);
}

/* ============================================
   Base styles
   ============================================ */

* {
  border-color: var(--color-border-default);
}

body {
  background-color: var(--color-surface);
  color: var(--color-text-default);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Scrollbar styling */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-subtle) transparent;
}
```

### Theme file example: `themes/claude-dark.css`

```css
[data-theme="claude"][data-mode="dark"] {
  /* Primitives — raw values for the Claude dark palette */
  --p-surface: hsl(60 2.7% 14.5%);
  --p-surface-raised: hsl(60 2.1% 18.4%);
  --p-surface-sunken: hsl(30 3.3% 11.8%);
  --p-surface-overlay: hsl(60 2.1% 18.4%);
  --p-surface-backdrop: hsl(0 0% 0% / 0.6);
  --p-surface-invert: hsl(0 0% 100%);

  --p-text-default: hsl(48 33.3% 97.1%);
  --p-text-secondary: hsl(50 9% 73.7%);
  --p-text-muted: hsl(48 4.8% 59.2%);
  --p-text-disabled: hsl(48 4.8% 59.2% / 0.5);
  --p-text-on-emphasis: hsl(0 0% 100%);

  --p-border-default: hsl(51 16.5% 84.5% / 0.15);
  --p-border-subtle: hsl(51 16.5% 84.5% / 0.08);
  --p-border-strong: hsl(51 16.5% 84.5% / 0.30);

  --p-accent: hsl(15 54.2% 51.2%);
  --p-accent-hover: hsl(15 63.1% 59.6%);
  --p-accent-subtle: hsl(15 54.2% 51.2% / 0.15);
  --p-text-accent: hsl(15 63.1% 59.6%);

  --p-info: hsl(210 65.5% 67.1%);
  --p-text-info: hsl(210 65.5% 67.1%);
  --p-text-info-hover: hsl(210 70.9% 51.6%);

  --p-pro: hsl(251 84.6% 74.5%);
  --p-text-pro: hsl(251 84.6% 74.5%);

  --p-success: hsl(97 59.1% 46.1%);
  --p-text-success: hsl(97 59.1% 46.1%);
  --p-success-subtle: hsl(127 100% 13.9% / 0.2);

  --p-danger: hsl(0 98.4% 75.1%);
  --p-text-danger: hsl(0 98.4% 75.1%);
  --p-danger-subtle: hsl(0 46.5% 27.8% / 0.2);

  --p-warning: hsl(40 71% 50%);
  --p-text-warning: hsl(40 71% 50%);

  --p-interactive: hsl(60 2.1% 18.4% / 0.4);
  --p-interactive-active: hsl(60 2.1% 18.4% / 0.8);
  --p-ring-focus: hsl(15 63.1% 59.6% / 0.5);

  --p-radius: 0.75rem;

  --shadow-sm: 0 1px 2px hsl(0 0% 0% / 0.3);
  --shadow-md: 0 4px 6px hsl(0 0% 0% / 0.4);
  --shadow-lg: 0 10px 15px hsl(0 0% 0% / 0.5);
}
```

### Tailwind utility class mapping

Tailwind v4's `--color-*` namespace generates `bg-*`, `text-*`, `border-*`, `fill-*`, etc. utility classes automatically. When you define `--color-surface` in `@theme inline`, you get `bg-surface`, `text-surface`, `border-surface`, etc.

**The text naming problem:** if we define `--color-text-default`, the Tailwind utility becomes `text-text-default` — redundant and ugly. Two approaches:

**Option A: Drop the `text-` prefix from CSS variables (recommended)**

```css
@theme inline {
  /* Surfaces -> bg-surface, bg-surface-raised, etc. */
  --color-surface: var(--p-surface);
  --color-surface-raised: var(--p-surface-raised);

  /* Text colors -> text-default, text-secondary, text-muted */
  --color-default: var(--p-text-default);
  --color-secondary: var(--p-text-secondary);
  --color-muted: var(--p-text-muted);
  --color-disabled: var(--p-text-disabled);
  --color-on-emphasis: var(--p-text-on-emphasis);

  /* Borders -> border-default, border-subtle, border-strong */
  --color-border-default: var(--p-border-default);
  --color-border-subtle: var(--p-border-subtle);
  --color-border-strong: var(--p-border-strong);

  /* Status -> text-danger, bg-danger, text-success, etc. */
  --color-danger: var(--p-danger);
  --color-danger-subtle: var(--p-danger-subtle);
  --color-success: var(--p-success);
  --color-success-subtle: var(--p-success-subtle);
  --color-warning: var(--p-warning);
  --color-accent: var(--p-accent);
  --color-accent-hover: var(--p-accent-hover);
  --color-accent-subtle: var(--p-accent-subtle);
  --color-info: var(--p-info);
  --color-info-hover: var(--p-text-info-hover);
  --color-pro: var(--p-pro);

  /* Interactive */
  --color-interactive: var(--p-interactive);
  --color-interactive-active: var(--p-interactive-active);
  --color-ring-focus: var(--p-ring-focus);
}
```

This produces clean class names: `text-default`, `text-muted`, `bg-surface`, `bg-danger-subtle`, `border-default`, `text-danger`, etc.

The tradeoff: `bg-default` and `bg-secondary` also exist as classes, but they map to text colors (not backgrounds). In practice this is safe — developers will use `bg-surface` for backgrounds, never `bg-default`. The naming convention makes misuse obvious. shadcn/ui uses the exact same pattern (`--color-foreground` generates both `text-foreground` and `bg-foreground`; nobody uses `bg-foreground`).

**Option B: Use `--color-text-*` prefix and accept `text-text-*` classes**

Keep the full semantic name in the CSS variable. Class names like `text-text-default` are verbose but unambiguous. GitHub Primer uses this pattern (`fgColor-default`, `bgColor-muted`). We rejected this because our team is small and the verbosity isn't worth the disambiguation it provides.

**Decision: Option A.** Matches shadcn/ui convention, produces the cleanest Tailwind classes, and the naming overlap between text-role and background-role tokens is a non-issue in practice.

---

## Migration Path

### Strategy: parallel token system, gradual adoption

The migration does NOT require a big-bang rewrite. Both old and new tokens can coexist.

### Phase 1: Add new tokens alongside old ones

1. Create `themes/claude-dark.css` with all primitive values
2. Add `@theme inline` semantic tokens to `globals.css`
3. Keep ALL existing `@theme` color definitions untouched
4. Both `bg-bg-100` (old) and `bg-surface` (new) work simultaneously

### Phase 2: Migrate components file by file

For each component file, replace old utility classes with new ones:

```
Old                          New                           CSS Variable
──────────────────────────────────────────────────────────────────────────
SURFACES
bg-bg-100                 -> bg-surface                    --color-surface
bg-bg-000                 -> bg-surface-raised             --color-surface-raised
bg-bg-200                 -> bg-surface-raised             --color-surface-raised
bg-bg-300                 -> bg-surface-sunken             --color-surface-sunken
bg-bg-400                 -> bg-surface-backdrop           --color-surface-backdrop

TEXT
text-text-000             -> text-default                  --color-default
text-text-100             -> text-default                  --color-default
text-text-200             -> text-secondary                --color-secondary
text-text-300             -> text-secondary                --color-secondary
text-text-400             -> text-muted                    --color-muted
text-text-500             -> text-muted                    --color-muted

BORDERS
border-border-300         -> border-default                --color-border-default
border-border-200         -> border-default                --color-border-default

ACCENT (brand)
bg-accent-main-000        -> bg-accent                     --color-accent
bg-accent-main-100        -> bg-accent-hover               --color-accent-hover
bg-accent-main-200        -> bg-accent-hover               --color-accent-hover
text-accent-main-000      -> text-accent                   --color-accent
text-oncolor-100          -> text-on-emphasis               --color-on-emphasis

ACCENT (secondary roles)
text-accent-secondary-000 -> text-info                     --color-info
text-accent-secondary-100 -> text-info-hover               --color-info-hover
text-accent-pro-000       -> text-pro                      --color-pro

STATUS
text-danger-000           -> text-danger                   --color-danger
bg-danger-000             -> bg-danger                     --color-danger
bg-danger-900/20          -> bg-danger-subtle              --color-danger-subtle
bg-danger-100/200         -> bg-danger                     --color-danger
text-success-000          -> text-success                  --color-success
bg-success-000            -> bg-success                    --color-success
bg-success-900/20         -> bg-success-subtle             --color-success-subtle
text-warning-000          -> text-warning                  --color-warning
bg-warning-000            -> bg-warning                    --color-warning

INTERACTIVE
hover:bg-bg-200/40        -> hover:bg-interactive          --color-interactive
hover:bg-bg-000/50        -> hover:bg-interactive          --color-interactive

FOCUS
focus:ring-accent-main-*  -> focus:ring-ring-focus         --color-ring-focus
```

### Phase 3: Remove old tokens

Once all components are migrated (grep confirms zero references to old token names), remove the old `@theme` color block.

### Phase 4: Add light theme

Create `themes/claude-light.css`. The `data-mode` attribute is already on `<html>`. Add a theme toggle component. All semantic tokens resolve correctly because they reference primitives, not hardcoded values.

### Verification

After each component migration, verify visually that nothing changed. The new token values are identical to the old ones for the claude-dark theme — only the names changed. If a component looks different after migration, the token mapping is wrong.

---

## Token Count Summary

| Category | Token Count | Notes |
|----------|-------------|-------|
| Colors — surfaces | 6 | backgrounds at different elevations |
| Colors — text | 6 | primary through disabled + on-emphasis |
| Colors — borders | 3 | subtle / default / strong |
| Colors — accent | 4 | brand color + hover + subtle + text |
| Colors — info | 3 | secondary accent (tools, links) |
| Colors — pro | 2 | premium accent |
| Colors — status | 8 | success/danger/warning + subtle variants |
| Colors — interactive | 3 | hover / active / focus ring |
| Colors — constant | 2 | static white/black |
| Typography | 3 | font families (sizes use Tailwind built-ins) |
| Radius | 1 | base value (scale is derived) |
| Shadows | 3 | sm/md/lg |
| Motion | 5 | 3 durations + 2 easings (use Tailwind built-ins where possible) |
| Z-index | 6 | stacking layers |
| **Total** | **~55** | vs. current 46 colors-only |

The total is comparable to the current count but covers typography, radius, shadows, motion, and z-index in addition to colors.

---

## Ancillary Findings

### Issues discovered during research

1. **Duplicate token values.** Several current tokens have identical values with different names:
   - `--color-accent-main-100` and `--color-accent-main-200` are both `hsl(15 63.1% 59.6%)`
   - `--color-border-100` through `--color-border-400` are ALL `hsl(51 16.5% 84.5%)`
   - `--color-text-200` and `--color-text-300` are identical
   - `--color-text-400` and `--color-text-500` are identical
   - `--color-danger-100` and `--color-danger-200` are identical
   - `--color-success-100` and `--color-success-200` are identical
   - `--color-warning-100` and `--color-warning-200` are identical
   - `--color-oncolor-200` and `--color-oncolor-300` are identical

   This suggests the 000/100/200/900 scale was designed for future expansion but currently wastes variable slots. The new system eliminates this by using purpose names instead of numeric scales.

2. **Hardcoded color in `.dotted-grid`.** The `globals.css` file has `hsl(48 4.8% 59.2% / 0.08)` hardcoded in the `radial-gradient` for the dotted grid background. This should reference a token: `var(--color-text-muted) / 0.08` or a dedicated `--p-grid-dot` primitive.

3. **`color-mix` opacity pattern is fragile.** The current `border-color: color-mix(in srgb, var(--color-border-300) 15%, transparent)` pattern is used in the global `*` selector and scrollbar styles. The new system bakes opacity into the primitive values (e.g., `--p-border-default` already includes the alpha), eliminating the `color-mix` indirection. This is simpler and works better with Tailwind's opacity modifier syntax (`/40`).

4. **`pictogram-*` tokens defined but unused in component code.** The four `--color-pictogram-*` variables in globals.css do not appear in any `.tsx` or `.ts` file via Tailwind utilities. They can likely be removed. If they serve a purpose (e.g., SVG icon backgrounds), they should be mapped to a semantic token in the new system.

5. **Font family token inconsistency.** The `@theme` block defines `--font-ui` and `--font-mono`, but Tailwind v4 expects `--font-sans` and `--font-mono` as its default namespace names. The layout uses `className="font-ui"` which works because `@theme` registered it, but this diverges from Tailwind convention. The new system keeps `--font-ui` (it is more semantic than `--font-sans`) but notes the divergence.

6. **No `prefers-color-scheme` media query.** The app has `data-mode="dark"` hardcoded in the layout. When light mode support is added, there is no system-preference detection. The theme toggle should include `prefers-color-scheme` matching as a default behavior.
