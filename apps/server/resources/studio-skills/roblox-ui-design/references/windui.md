# WindUI

WindUI is a third-party Luau UI library (MIT licence, by Footagesus) that builds a ready-made, modern, draggable window: title bar, sidebar tabs, search, grouped rows of buttons, toggles, sliders, inputs, dropdowns, colour pickers, keybinds, dialogs, popups and notifications, with built-in themes and icon packs. It was written for script hubs, so using it in a real game takes a few adjustments, listed below.

- Repository: https://github.com/Footagesus/WindUI (README is short; the API lives in the docs)
- Docs: https://footagesus.github.io/treehub-web/docs/windui (pages for Window, Tab, Button, Toggle, Slider, Input, Dropdown, Dialog, Notification, Themes, Icons, and more)
- Full example in the repo: `main.client.lua` (the best reference for every element's options)

When in doubt about a field or method, read the docs page for that element, then `main.client.lua` and `src/elements/<Name>.lua` in the repo. The repo moves on (v1.6.66 at the time of writing, labelled beta); do not guess names from memory.

## When it fits

Use it when the archetype is **5 Flat windowed UI** in `gallery.md`, or when the user asks for a sleek modern window and the screen is mostly controls:

- admin and moderation panels, developer and debug tools, map or build editors;
- settings windows with many toggles, sliders, dropdowns and keybinds;
- tool UIs that belong to a creator or tester, not a mass audience;
- anything where the user said "WindUI" or showed a screenshot like it.

It saves a lot of work there: a hand-built version needs the window, drag, tabs, scrolling, rows, tooltips, theming and animation.

## When it does not fit

- Cartoon, simulator, brainrot, fantasy, sci-fi and studded looks (archetypes 7 to 16): WindUI is flat and neutral, it has no lips, thick outlines, art banners, rarity cards or 3D icons. Build these by hand.
- Always-on HUDs (health, currencies, ammo), shops with item art, daily rewards, menus with a hero image.
- Anything needing gamepad focus navigation or console support: the library handles mouse and touch; gamepad navigation is not documented, so do not promise it.
- Games that must stay tiny: it is one very large ModuleScript (about 1.3 MB with icon packs).
- Anything player-facing that must match a custom palette beyond what the theme keys allow. Try the theme first (below); if it still looks off, build by hand.

## Loading it in a real game (the supported way)

`loadstring(game:HttpGet("https://raw.githubusercontent.com/..."))()` is what the README and docs show. It does not work in a published game: `HttpGet` and `loadstring` are not available to normal scripts, and fetching code at runtime is not allowed. The library must live in the place as a ModuleScript.

1. **Get the bundle.** Download the single-file build once (shell, `curl -L -o <scratch>/WindUI.lua <url>`), into a scratch folder, never into the SealCode repository:
   - `https://raw.githubusercontent.com/Footagesus/WindUI/main/dist/main.lua` (main branch, about 1.35 MB, icon packs embedded: it works without any HTTP). Pin a commit instead of `main` for reproducibility, for example `https://raw.githubusercontent.com/Footagesus/WindUI/9e589eab5756f5f61a4b4531fa9e77672847a917/dist/main.lua` (commit of 2026-10-06; v1.6.66 in `package.json`).
   - Not the release asset (`releases/download/<tag>/main.lua`, about 270 KB): that build asks the server for icons through a `GetIcons` RemoteFunction fed by `HttpService` and `loadstring`, which a published game cannot do.
   - Do not use the Rojo source tree (`src/` mapped to `ReplicatedStorage.WindUI`) for the same reason: its icon loader and its server scripts need `loadstring` on the server.
     Read the first lines (version, licence). Keep that header comment: MIT requires the notice to stay with the code.
2. **Patch the parent (required).** The bundle parents its ScreenGuis to `gethui()` or `CoreGui`, and a game script cannot use `CoreGui`. Search for `gethui and gethui()`: there is exactly one match, a line of the form `local <x>=gethui and gethui()or(<y> or <player>:WaitForChild"PlayerGui")` (`<y>` is `CoreGui`, `<player>` is `Players.LocalPlayer`). Replace the whole expression after `=` with `<player>:WaitForChild"PlayerGui"`, using the names found in that line. In the pinned commit above the line is `local aw=gethui and gethui()or(al or ap:WaitForChild"PlayerGui")` and becomes `local aw=ap:WaitForChild"PlayerGui"`; the minified names change between releases, so search, do not paste. Nothing else in the bundle needs changing: the other `loadstring` and `HttpGet` references are on paths a game does not reach (key systems, video and image URLs).
3. **Create the module.** A `ModuleScript` named `WindUI` in `ReplicatedStorage` holding the patched file. The bridge accepts a source this size (`set_script_source` took the 1.35 MB file in one call and verified the read-back), but the whole text has to travel as the tool argument, which a model cannot produce. Load it from disk instead:
   - Wrap the patched file in a model file with a shell one-liner and import it: write `<roblox version="4"><Item class="ModuleScript" referent="RBX0"><Properties><string name="Name">WindUI</string><ProtectedString name="Source"><![CDATA[` + the file + `]]></ProtectedString></Properties></Item></roblox>` to `<scratch>/WindUI.rbxmx` (the file contains no `]]>`; check with `grep -c`, and split any occurrence as `]]]]><![CDATA[>`), then call `import_rbxm` with that absolute path and `parentPath` `game.ReplicatedStorage`. This was tested: it imports one ModuleScript with the identical source.
   - Do not trim the library to make it fit. If neither route is possible, tell the user and ask them to paste the file into the ModuleScript.
     In a Play test, `require` it from a LocalScript and confirm the output has no errors and `WindUI.ScreenGui.Parent` is the `PlayerGui`. The saved place file grows by about the same 1.4 MB.
4. **Use it from one `LocalScript`** in `StarterPlayerScripts` (or `StarterGui`), created when the screen should exist. Two things in v1.6.66 need handling in that script, both seen in a Play test:
   - **Wait for the camera viewport before `CreateWindow`.** With the default `AutoScale`, the window scale is computed once, at creation, from `workspace.CurrentCamera.ViewportSize`. At script start the viewport can still be `1, 1`, which clamps the scale to 0.3 and leaves a tiny window for the rest of the session. A first test run was fine and the next ones were tiny, so it is a race, not a constant.
   - **Select the first tab yourself.** No tab is selected on creation: the window opens with an empty content pane. Call `Window:SelectTab(1)` after the tabs and elements exist, after a `task.wait()` (`Tab:Select()` also exists in the source; only `Window:SelectTab(1)` after the build was tested).

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local WindUI = require(ReplicatedStorage:WaitForChild("WindUI"))

local camera = workspace.CurrentCamera
while camera.ViewportSize.X < 100 do
    camera:GetPropertyChangedSignal("ViewportSize"):Wait()
end

local Window = WindUI:CreateWindow({ Title = "Control Panel", Icon = "layout-dashboard", Theme = "Dark" })
Window:DisableTopbarButtons({ "Close" })
local MainTab = Window:Tab({ Title = "Main", Icon = "house" })
MainTab:Toggle({ Title = "Invincible", Value = false, Callback = function(state) end })

task.wait()
Window:SelectTab(1)
```

Things that do not work in a published game, because they need an exploit environment (`writefile`, `isfile`, `getcustomasset`, `request`, `setclipboard`): saving and loading configs (`Window.ConfigManager`, `Flag` persistence), `KeySystem`, image or video URLs (use `rbxassetid://` ids), the `Folder` option's file storage, and clipboard buttons. Save player or admin settings with a RemoteEvent to the server and a DataStore instead. Do not use `KeySystem`: gate admin tools on the server by user id.

Only one window can exist at a time (`CreateWindow` warns and returns nil on a second call). `Window:Destroy()`, and the topbar X (which asks "you will not be able to open it again" and then destroys), tear down all four of the library's ScreenGuis, so neither the window nor `Notify` works again until the player rejoins. In a game, hide and show instead: call `Window:DisableTopbarButtons({ "Close" })` right after creating the window (the Minimize button, `ToggleKey`, the `OpenButton` and `Window:Close()` / `Window:Open()` stay available), and never call `Destroy` except when the screen is gone for good.

## Core API

All names below are from the docs and the repo's `main.client.lua`. Colours are `Color3`; icons are strings such as `"settings"` (Lucide, the default pack), `"solar:home-2-bold"`, `"sfsymbols:sunMinFill"` or `"rbxassetid://<id>"`.

### Window

```lua
local Window = WindUI:CreateWindow({
    Title = "Control Panel",
    Author = "by StudioName",          -- subtitle
    Icon = "layout-dashboard",         -- Lucide name, "pack:name", or rbxassetid://
    Theme = "Dark",                    -- a built-in theme or one you added
    Size = UDim2.fromOffset(580, 460),
    MinSize = Vector2.new(480, 360),
    Resizable = true,
    ToggleKey = Enum.KeyCode.RightShift,
    Transparent = false,
    HideSearchBar = true,
    OpenButton = { Title = "Panel", Enabled = true, Draggable = true, OnlyMobile = false },
    Topbar = { Height = 44, ButtonsType = "Default" },   -- or "Mac"
})
```

Other fields: `Folder`, `Position`, `MaxSize`, `SideBarWidth`, `ScrollBarEnabled`, `Radius`, `ElementsRadius`, `ShadowTransparency`, `Background` (an `rbxassetid://` image), `BackgroundImageTransparency`, `Acrylic`, `NewElements`, `HidePanelBackground`, `AutoScale`, `IgnoreAlerts`, `Footer`, `User`.

Methods: `Window:Tab(cfg)`, `Window:Section(cfg)`, `Window:Divider()`, `Window:Tag(cfg)`, `Window:Dialog(cfg)`, `SetTitle`, `SetAuthor`, `SetIcon`, `SetSize`, `SetTheme`, `SetToggleKey`, `SetUIScale`, `Open`, `Close`, `Toggle`, `Destroy`, `SelectTab`, `LockAll`, `UnlockAll`, `OnOpen`, `OnClose`, `OnDestroy`, `CreateTopbarButton`, `EditOpenButton`.

### Tabs and sections

```lua
local MainTab = Window:Tab({ Title = "Main", Icon = "house" })          -- sidebar entry
local Group = Window:Section({ Title = "Tools" })                       -- sidebar heading that holds tabs
local ToolsTab = Group:Tab({ Title = "Server", Icon = "server" })
local Box = MainTab:Section({ Title = "Movement", Desc = "Local player", Box = true, BoxBorder = true, Opened = true })
```

`Tab:Select()`, `Tab:SetTitle()`, `Tab:Lock()` and `Tab:Unlock()` exist. A `Section` is a collapsible group of elements; elements can be added to a Tab or to a Section with the same calls.

### Elements

```lua
MainTab:Button({
    Title = "Respawn", Desc = "Reload your character", Icon = "refresh-ccw",
    IconAlign = "Left", Justify = "Center", Color = Color3.fromHex("#EF4F1D"),
    Callback = function() print("clicked") end,
})

local God = MainTab:Toggle({
    Title = "Invincible", Desc = "Server checks this", Value = false,   -- Type = "Checkbox" for a checkbox
    Callback = function(state) print(state) end,
})                                                                      -- God:Set(true)

MainTab:Slider({
    Title = "Walk speed", Step = 1, IsTooltip = true, IsTextbox = true, Width = 200,
    Value = { Min = 8, Max = 64, Default = 16 },
    Callback = function(value) print(value) end,
})

MainTab:Input({
    Title = "Player name", Placeholder = "Type a name", Value = "",
    Type = "Input",                                                     -- or "Textarea"
    Callback = function(text) print(text) end,
})

local Pick = MainTab:Dropdown({
    Title = "Team", Values = { "Red", "Blue", "Green" }, Value = "Red",
    Multi = false, AllowNone = false, SearchBarEnabled = false,
    Callback = function(option) print(option) end,
})                                                                      -- Pick:Select("Blue"); Pick:Refresh({ ... })
```

More elements in the docs: `Paragraph` (title, text, optional buttons and image), `Keybind` (`Value = "G"`), `Colorpicker` (`Default`, `Transparency`, `Callback(color)`), `Code`, `Divider`, `Space`, `Image`, `ProgressBar`, `HStack` and `VStack` for side-by-side layout, `Viewport`. Every element takes `Title`, `Desc`, `Locked` and supports `:SetTitle`, `:SetDesc`, `:Lock`, `:Unlock`, `:Highlight`, `:Destroy`. Dropdown values must be unique. Check each element's docs page before using an option you have not seen above.

### Notifications, dialogs and popups

```lua
WindUI:Notify({ Title = "Saved", Content = "Settings applied", Icon = "check", Duration = 3 })   -- also CanClose

local Confirm = Window:Dialog({                -- opens as soon as it is created in v1.6.66
    Title = "Kick player?", Content = "This cannot be undone.",
    Buttons = {
        { Title = "Cancel", Callback = function() end },
        { Title = "Kick", Variant = "Primary", Callback = function() end },
    },
})                                              -- Confirm:Close(); older docs mention Dialog:Show(), check the source if it errors

WindUI:Popup({ Title = "Welcome", Icon = "bird", Content = "Hello!", Buttons = { { Title = "OK", Variant = "Tertiary" } } })
```

`WindUI:SetNotificationLower(true)` moves notifications down so they clear the mobile jump button.

### What runs where

Callbacks run on the client. A toggle that changes game state must call a `RemoteEvent`; the server validates the player (user id allow-list for admin tools, `roblox-networking` rules) and acts. Never trust a callback's value on the server.

## Theming it to the game

Built-in themes: `Dark`, `Light`, `Rose`, `Plant`, `Red`, `Indigo`, `Sky`, `Violet`, `Amber`, `Emerald`, `Midnight`, `Crimson`, `Monokai Pro`, `Cotton Candy`, `Mellowsi`, `Rainbow` (list them with `WindUI:GetThemes()`). Start from the closest built-in, then add a theme with the game's palette. A theme can be partial: a missing key is derived from the ones you give (the library's own fallback table), and anything still missing comes from `Dark`.

```lua
WindUI:AddTheme({
    Name = "Brand",
    Accent = Color3.fromHex("#1E2230"),          -- sidebar and header surfaces
    Background = Color3.fromHex("#12151D"),      -- window body
    Dialog = Color3.fromHex("#171B26"),
    Outline = Color3.fromHex("#FFFFFF"),
    Text = Color3.fromHex("#F2F4F8"),
    Placeholder = Color3.fromHex("#8892A6"),
    Button = Color3.fromHex("#2A3144"),
    Icon = Color3.fromHex("#9AA3B2"),
    Toggle = Color3.fromHex("#34D399"),          -- on-state
    Slider = Color3.fromHex("#4C8DFF"),          -- fill
    Checkbox = Color3.fromHex("#4C8DFF"),
    Primary = Color3.fromHex("#4C8DFF"),         -- main accent
    ElementBackground = Color3.fromHex("#222838"),
    ElementBackgroundTransparency = 0,
})
WindUI:SetTheme("Brand")                         -- or pass Theme = "Brand" to CreateWindow
```

Steps:

1. Take the palette from the game's existing UI (`SealCodeUiStyle`, StarterGui) or from the chosen archetype: surfaces dark to light go to `Background`, `Accent`, `ElementBackground`; text colours to `Text`, `Placeholder`, `Icon`; the brand colour to `Primary`, `Slider`, `Checkbox`, and the on colour to `Toggle`.
2. Match shape: `Radius` (window corners) and `ElementsRadius` (rows) in `CreateWindow`, for example 16 and 12 for a soft look, 6 and 4 for a hard one.
3. Match type with `WindUI:SetFont("rbxassetid://<font asset id>")` only if the game has a custom font family asset; otherwise keep the default.
4. Match icons: keep the Lucide outline style, or add the game's own with `WindUI.Creator.AddIcons("game", { Coin = "rbxassetid://<id>" })` and use `"game:Coin"`.
5. `Transparent = true` lets the world show through (and `WindUI.TransparencyValue` sets how much); keep it off if text is hard to read.
6. Take a Play test screenshot and check contrast, sidebar legibility and toggle states in both on and off. Adjust the theme, not the library.

## After building

- The window's `ScreenGui` has a very low `DisplayOrder`; if other game UI covers it, raise `WindUI.ScreenGui.DisplayOrder` and `WindUI.NotificationGui.DisplayOrder`.
- Check it on a phone and a PC (`validation.md`): the window must fit the smallest phone (use `Size`, `MinSize`, and `Window:SetUIScale()`), and rows must be 44 px or more to tap.
- Centre button labels with `Justify = "Center"` (the default spreads title and icon apart); descriptions and paragraphs stay left aligned.
