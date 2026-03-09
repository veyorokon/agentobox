pref("general.config.filename", "mozilla.cfg");
pref("general.config.obscure_value", 0);
// Disable autoconfig sandbox so mozilla.cfg can use Components for
// nsIStyleSheetService polling (live theme reload without restart).
pref("general.config.sandbox_enabled", false);
