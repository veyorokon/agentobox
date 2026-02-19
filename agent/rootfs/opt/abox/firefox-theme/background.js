// Agentobox theme bridge — polls native host for dashboard theme tokens,
// maps them to Firefox's browser.theme API. Textfox reads --lwt-* vars
// set by browser.theme.update(), so colors propagate automatically.

const POLL_INTERVAL = 2000;
let lastJson = null;
let port = null;

// Default theme (Rose Pine Moon) applied on startup before backend pushes tokens
const DEFAULT_TOKENS = {
  background: "#232136",
  foreground: "#e0def4",
  surface: "#2a273f",
  accent: "#c4a7e7",
  "muted-foreground": "#908caa",
  destructive: "#eb6f92",
};

function mapTokens(t) {
  return {
    colors: {
      frame: t.background,
      tab_background_text: t.foreground,
      toolbar: t.surface,
      toolbar_text: t["muted-foreground"],
      toolbar_field: t.background,
      toolbar_field_text: t.foreground,
      toolbar_field_border: t.surface,
      toolbar_field_focus: t.surface,
      toolbar_field_text_focus: t.foreground,
      popup: t.background,
      popup_text: t.foreground,
      popup_border: t.surface,
      popup_highlight: t.accent,
      popup_highlight_text: t.foreground,
      tab_line: t.accent,
      tab_loading: t.accent,
      sidebar: t.background,
      sidebar_text: t["muted-foreground"],
      sidebar_border: t.surface,
      sidebar_highlight: t.accent,
      sidebar_highlight_text: t.foreground,
      ntp_background: t.background,
      ntp_text: t.foreground,
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
