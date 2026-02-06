// Additional Firefox prefs for agent desktop (applied after textfox user.js)

// Force dark mode everywhere
user_pref("ui.systemUsesDarkTheme", 1);
user_pref("layout.css.prefers-color-scheme.content-override", 0);
user_pref("browser.in-content.dark-mode", true);

// Suppress first-run / default-browser / data-reporting prompts
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.newtabpage.activity-stream.feeds.topsites", false);

// Suppress security warnings for self-signed / localhost
user_pref("security.enterprise_roots.enabled", true);
user_pref("network.stricttransportsecurity.preloadlist", false);
user_pref("security.cert_pinning.enforcement_level", 0);

// Suppress sandbox warning banner (sandbox degrades gracefully in containers)
user_pref("security.sandbox.warn_unprivileged_namespaces", false);

// Hide bookmarks toolbar
user_pref("browser.toolbars.bookmarks.visibility", "never");

// Disable auto-update (container image is the source of truth)
user_pref("app.update.enabled", false);
user_pref("app.update.auto", false);

// Performance: disable animations for VNC streaming
user_pref("toolkit.cosmeticAnimations.enabled", false);
user_pref("ui.prefersReducedMotion", 1);
