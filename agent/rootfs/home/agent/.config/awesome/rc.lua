-- agentobox AwesomeWM config
local awful     = require("awful")
local gears     = require("gears")
local wibox     = require("wibox")
local beautiful = require("beautiful")

-- Theme
beautiful.init(gears.filesystem.get_configuration_dir() .. "theme.lua")

-- Solid wallpaper
screen.connect_signal("request::wallpaper", function(s)
    gears.wallpaper.set(beautiful.wallpaper or "#232136")
end)

-- Set wallpaper on existing screens too
for s in screen do
    gears.wallpaper.set(beautiful.wallpaper or "#232136")
end

-- App launchers
local launcher_firefox = awful.widget.launcher({
    image   = "/usr/share/icons/hicolor/48x48/apps/firefox-esr.png",
    command = "firefox-esr",
})
-- xterm icon is a black line drawing — recolor to fg so it's visible on any bg
local XTERM_SVG = "/usr/share/icons/hicolor/scalable/apps/xterm.svg"
local launcher_terminal = awful.widget.launcher({
    image   = gears.color.recolor_image(XTERM_SVG, beautiful.fg_normal or "#908caa"),
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
        bg       = "#232136",
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

    local bg   = tokens["background"]
    local fg   = tokens["foreground"]
    local surf = tokens["surface"]
    local acc  = tokens["accent"]
    local mfg  = tokens["muted-foreground"]
    local dest = tokens["destructive"]

    if bg then
        beautiful.bg_normal   = bg
        beautiful.bg_minimize = bg
        beautiful.border_normal = bg
        beautiful.wallpaper   = bg
        for s in screen do
            gears.wallpaper.set(bg)
        end
    end

    if fg then
        beautiful.fg_focus  = fg
        beautiful.fg_urgent = fg
    end

    if surf then
        beautiful.bg_focus = surf
    end

    if acc then
        beautiful.border_focus  = acc
        beautiful.border_marked = acc
    end

    if mfg then
        beautiful.fg_normal   = mfg
        beautiful.fg_minimize = mfg
        -- Recolor monochrome launcher icons to match
        if launcher_terminal then
            launcher_terminal:set_image(gears.color.recolor_image(XTERM_SVG, mfg))
        end
    end

    if dest then
        beautiful.bg_urgent = dest
    end

    -- Update dock background on all screens
    for s in screen do
        if s.dock then
            s.dock.bg = bg or beautiful.bg_normal
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
