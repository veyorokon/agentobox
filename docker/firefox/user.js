// userchrome.css usercontent.css activate
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);

// Fill SVG Color
user_pref("svg.context-properties.content.enabled", true);

// CSS's `:has()` selector
user_pref("layout.css.has-selector.enabled", true);

// Suppress security/first-run warnings
user_pref("browser.security.outdated.warning", false);
user_pref("security.warn_submit_secure_to_insecure", false);
user_pref("security.sandbox.warn_unprivileged_namespaces", false);
user_pref("security.sandbox.content.level", 0);
user_pref("browser.urlbar.showSearchSuggestionsFirst", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.messaging-system.whatsNewPanel.enabled", false);
user_pref("browser.uitour.enabled", false);
user_pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons", false);
user_pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features", false);
user_pref("browser.startup.homepage", "about:blank");
user_pref("browser.newtabpage.enabled", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("privacy.firstparty.isolate", false);
