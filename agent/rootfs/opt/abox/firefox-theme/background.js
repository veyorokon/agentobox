// Agentobox theme bridge — polls native host for dashboard theme tokens,
// maps them to Firefox's browser.theme API. Textfox reads --lwt-* vars
// set by browser.theme.update(), so colors propagate automatically.

const POLL_INTERVAL = 2000;
let lastJson = null;
let port = null;

// Neutral dark grey defaults — visible but unobtrusive until WS theme arrives.
// surface-raised intentionally equals surface for seamless VNC embedding.
const DEFAULT_TOKENS = {
  surface: "#1e1e1e",
  "surface-raised": "#1e1e1e",
  "surface-sunken": "#171717",
  "surface-overlay": "#333333",
  "text-default": "#d4d4d4",
  "text-secondary": "#aaaaaa",
  "text-muted": "#888888",
  "text-disabled": "#555555",
  "border-default": "#3a3a3a",
  "border-subtle": "#2d2d2d",
  accent: "#5a5a5a",
  "accent-hover": "#6a6a6a",
  "accent-subtle": "#333333",
  danger: "#cc3333",
};

function mapTokens(t) {
  // Resolve semantic tokens with cascading fallbacks
  var surface       = t["surface"] || "#1e1e1e";
  var surfaceRaised = t["surface-raised"] || "#2d2d2d";
  var surfaceSunken = t["surface-sunken"] || surface;
  var surfaceOverlay = t["surface-overlay"] || surfaceRaised;
  var textDefault   = t["text-default"] || "#d4d4d4";
  var textSecondary = t["text-secondary"] || textDefault;
  var textMuted     = t["text-muted"] || "#888888";
  var borderDefault = t["border-default"] || surfaceRaised;
  var borderSubtle  = t["border-subtle"] || surfaceRaised;
  var accent        = t["accent"] || "#5a5a5a";
  var accentSubtle  = t["accent-subtle"] || surfaceRaised;

  // All backgrounds use `surface` for seamless VNC embedding — the agent
  // desktop should look like a native dashboard component, not a remote
  // desktop in a box.  No surface-raised differentiation.
  return {
    colors: {
      frame: surface,
      tab_background_text: textDefault,
      toolbar: surface,
      toolbar_text: textMuted,
      toolbar_field: surface,
      toolbar_field_text: textDefault,
      toolbar_field_border: borderSubtle,
      toolbar_field_focus: surface,
      toolbar_field_text_focus: textDefault,
      popup: surface,
      popup_text: textDefault,
      popup_border: borderDefault,
      popup_highlight: accent,
      popup_highlight_text: textDefault,
      tab_line: accent,
      tab_loading: accent,
      sidebar: surface,
      sidebar_text: textMuted,
      sidebar_border: borderSubtle,
      sidebar_highlight: accentSubtle,
      sidebar_highlight_text: textDefault,
      ntp_background: surface,
      ntp_text: textDefault,
    },
  };
}

function connect() {
  try {
    port = browser.runtime.connectNative("abox_theme");
    port.onMessage.addListener((msg) => {
      const tokens = msg.tokens || DEFAULT_TOKENS;
      const json = JSON.stringify(tokens);
      if (json === lastJson) return;
      lastJson = json;
      browser.theme.update(mapTokens(tokens));
    });
    port.onDisconnect.addListener(() => {
      port = null;
      // Reconnect after a delay
      setTimeout(connect, POLL_INTERVAL);
    });
    poll();
  } catch (e) {
    setTimeout(connect, POLL_INTERVAL);
  }
}

function poll() {
  if (!port) return;
  try {
    port.postMessage({ cmd: "read" });
  } catch (e) {
    // Port died, reconnect will handle it
    return;
  }
  setTimeout(poll, POLL_INTERVAL);
}

// Apply default theme immediately, native host will override when ready
browser.theme.update(mapTokens(DEFAULT_TOKENS));
connect();
