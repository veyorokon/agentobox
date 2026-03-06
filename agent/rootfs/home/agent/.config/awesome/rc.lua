-- agentobox AwesomeWM config
local awful     = require("awful")
local gears     = require("gears")
local wibox     = require("wibox")
local beautiful = require("beautiful")

-- Theme
beautiful.init(gears.filesystem.get_configuration_dir() .. "theme.lua")

-- Solid wallpaper
screen.connect_signal("request::wallpaper", function(s)
    gears.wallpaper.set(beautiful.wallpaper or beautiful.bg_normal)
end)

-- Set wallpaper on existing screens too
for s in screen do
    gears.wallpaper.set(beautiful.wallpaper or beautiful.bg_normal)
end

-- App launchers
local launcher_firefox = awful.widget.launcher({
    image   = "/usr/share/icons/hicolor/48x48/apps/firefox-esr.png",
    command = "firefox-esr",
})
-- xterm icon is a black line drawing — recolor to fg so it's visible on any bg
local XTERM_SVG = "/usr/share/icons/hicolor/scalable/apps/xterm.svg"
local launcher_terminal = awful.widget.launcher({
    image   = gears.color.recolor_image(XTERM_SVG, beautiful.fg_normal),
    command = "xterm",
})

-- Single tag, max layout + dock
awful.screen.connect_for_each_screen(function(s)
    awful.tag({ "1" }, s, awful.layout.suit.max)

    -- Bottom dock bar (bg matches dashboard card color)
    s.dock = awful.wibar({
        position = "bottom",
        screen   = s,
        height   = 48,
        bg       = beautiful.bg_normal,
    })
    s.dock:setup({
        layout = wibox.layout.align.horizontal,
        expand = "none",
        nil,
        { -- centered launchers
            layout  = wibox.layout.fixed.horizontal,
            spacing = 10,
            wibox.container.margin(launcher_firefox,  4, 4, 8, 8),
            wibox.container.margin(launcher_terminal, 4, 4, 8, 8),
        },
        nil,
    })
end)

-- No titlebar ever
client.connect_signal("request::titlebars", function() end)

-- Client rules: all windows maximized, no border when alone/maximized
awful.rules.rules = {
    {
        rule = {},
        properties = {
            focus     = awful.client.focus.filter,
            raise     = true,
            screen    = awful.screen.preferred,
            placement = awful.placement.no_overlap + awful.placement.no_offscreen,
            maximized = true,
            border_width = beautiful.border_width,
            border_color = beautiful.border_normal,
        },
    },
}

-- Focus follows mouse
client.connect_signal("mouse::enter", function(c)
    c:emit_signal("request::activate", "mouse_enter", { raise = false })
end)

-- Border color on focus/unfocus
client.connect_signal("focus", function(c)
    c.border_color = beautiful.border_focus
end)
client.connect_signal("unfocus", function(c)
    c.border_color = beautiful.border_normal
end)

-- Hide borders when a client is maximized (cleaner VNC stream)
client.connect_signal("property::maximized", function(c)
    if c.maximized then
        c.border_width = 0
    else
        c.border_width = beautiful.border_width
    end
end)

-- Apply on manage too
client.connect_signal("manage", function(c)
    if c.maximized then
        c.border_width = 0
    end
end)

-- Error handling
if awesome.startup_errors then
    -- silently ignore — no notification library loaded
end

-- ---------------------------------------------------------------------------
-- Dynamic theme: poll /tmp/abox-theme.lua for dashboard-pushed colors
-- ---------------------------------------------------------------------------

function read_file(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local content = f:read("*a")
    f:close()
    return content
end

function apply_theme(tokens)
    if not tokens then return end

    -- Surface tokens → backgrounds and wallpaper
    local surface         = tokens["surface"]
    local surface_raised  = tokens["surface-raised"]
    local surface_sunken  = tokens["surface-sunken"]
    local surface_invert  = tokens["surface-invert"]

    -- Text tokens → foregrounds
    local text_default    = tokens["text-default"]
    local text_secondary  = tokens["text-secondary"]
    local text_muted      = tokens["text-muted"]
    local text_disabled   = tokens["text-disabled"]
    local text_on_emph    = tokens["text-on-emphasis"]

    -- Border tokens
    local border_default  = tokens["border-default"]
    local border_subtle   = tokens["border-subtle"]
    local border_strong   = tokens["border-strong"]

    -- Accent tokens
    local accent          = tokens["accent"]
    local accent_subtle   = tokens["accent-subtle"]

    -- Status tokens
    local danger          = tokens["danger"]
    local warning         = tokens["warning"]

    -- Interactive tokens
    local interactive     = tokens["interactive"]

    -- Map to AwesomeWM beautiful.* properties
    if surface then
        beautiful.bg_normal   = surface
        beautiful.bg_minimize = surface
        beautiful.wallpaper   = surface
        for s in screen do
            gears.wallpaper.set(surface)
        end
    end

    if surface_raised then
        beautiful.bg_focus = surface_raised
    end

    if text_default then
        beautiful.fg_focus  = text_default
        beautiful.fg_urgent = text_default
    end

    if text_muted then
        beautiful.fg_normal   = text_muted
        beautiful.fg_minimize = text_muted
        -- Recolor monochrome launcher icons to match
        if launcher_terminal then
            launcher_terminal:set_image(gears.color.recolor_image(XTERM_SVG, text_muted))
        end
    end

    if border_default then
        beautiful.border_normal = border_default
    end

    if accent then
        beautiful.border_focus  = accent
        beautiful.border_marked = accent
    end

    if danger then
        beautiful.bg_urgent = danger
    end

    -- Update dock background on all screens
    for s in screen do
        if s.dock then
            s.dock.bg = surface or beautiful.bg_normal
        end
    end

    -- Refresh border colors on all clients
    for _, c in ipairs(client.get()) do
        if client.focus == c then
            c.border_color = beautiful.border_focus
        else
            c.border_color = beautiful.border_normal
        end
    end
end

_abox_last_theme = nil

function _abox_check_theme()
    local content = read_file("/tmp/abox-theme.lua")
    if not content or content == _abox_last_theme then return end
    _abox_last_theme = content
    local ok, tokens = pcall(dofile, "/tmp/abox-theme.lua")
    if ok and type(tokens) == "table" then
        apply_theme(tokens)
    end
end

-- Apply immediately on startup if file exists
gears.timer.delayed_call(_abox_check_theme)

-- Poll for changes every 2 seconds (global to prevent GC)
_abox_theme_timer = gears.timer({ timeout = 2 })
_abox_theme_timer:connect_signal("timeout", _abox_check_theme)
_abox_theme_timer:start()
