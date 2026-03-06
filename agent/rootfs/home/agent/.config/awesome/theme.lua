-- agentobox AwesomeWM theme — neutral defaults, overridden by WS-pushed tokens
local theme = {}

theme.font = "JetBrains Mono 10"

-- Neutral dark grey defaults — visible but unobtrusive until WS theme arrives
theme.bg_normal     = "#1e1e1e"
theme.bg_focus      = "#2d2d2d"
theme.bg_urgent     = "#cc3333"
theme.bg_minimize   = "#1e1e1e"

theme.fg_normal     = "#888888"
theme.fg_focus      = "#d4d4d4"
theme.fg_urgent     = "#d4d4d4"
theme.fg_minimize   = "#888888"

-- Borders — neo-brutalism thick border
theme.border_width  = 4
theme.border_normal = "#1e1e1e"
theme.border_focus  = "#5a5a5a"
theme.border_marked = "#cc3333"

-- No gaps — maximized fills the screen
theme.useless_gap = 0

-- Wallpaper — solid, matches base
theme.wallpaper = "#1e1e1e"

return theme
