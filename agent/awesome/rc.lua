-- agentobox AwesomeWM config — neo-brutalism, zero chrome
local awful     = require("awful")
local gears     = require("gears")
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

-- Single tag, max layout
awful.screen.connect_for_each_screen(function(s)
    awful.tag({ "1" }, s, awful.layout.suit.max)
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
