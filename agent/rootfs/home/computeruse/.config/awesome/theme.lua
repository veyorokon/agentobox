-- agentobox AwesomeWM theme — Rose Pine Moon (adriankarlen rice)
local theme = {}

theme.font = "JetBrains Mono 10"

-- Rose Pine Moon palette
theme.bg_normal     = "#232136"   -- base
theme.bg_focus      = "#2a273f"   -- surface
theme.bg_urgent     = "#eb6f92"   -- love
theme.bg_minimize   = "#232136"

theme.fg_normal     = "#6e6a86"   -- muted
theme.fg_focus      = "#e0def4"   -- text
theme.fg_urgent     = "#e0def4"
theme.fg_minimize   = "#6e6a86"

-- Borders — neo-brutalism thick border
theme.border_width  = 4
theme.border_normal = "#232136"   -- invisible when unfocused (matches bg)
theme.border_focus  = "#c4a7e7"   -- iris (purple accent)
theme.border_marked = "#eb6f92"   -- love

-- No gaps — maximized fills the screen
theme.useless_gap = 0

-- Wallpaper — solid, matches base
theme.wallpaper = "#232136"

return theme
