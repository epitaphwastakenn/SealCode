--!nocheck
-- The installed loader. It owns what must outlive an update (the dock widget and the toolbar
-- button) and runs App from the modules beside it. When Harp has newer plugin code, App
-- hands the new sources to `reload`, which stops this copy and starts the new one in place, so
-- the user never reopens the place and Studio windows do not pile up.

local RunService = game:GetService("RunService")

local WIDGET_ID = "SealCodeStudioPanel"

local current = nil
local widget = nil
local failedHash = nil
local host = {}

function host.widget()
	if widget == nil then
		local info = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, false, 340, 560, 280, 320)
		local ok = pcall(function()
			widget = plugin:CreateDockWidgetPluginGuiAsync(WIDGET_ID, info)
		end)
		if not ok or widget == nil then
			widget = plugin:CreateDockWidgetPluginGui(WIDGET_ID, info)
		end
		widget.Name = WIDGET_ID
		widget.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	end
	return widget
end

local function boot(root: Instance): boolean
	local ok, result = pcall(function()
		return require(root.App).start(plugin, host)
	end)
	if not ok then
		warn("[Harp] The Studio plugin failed to start: " .. tostring(result))
		return false
	end
	current = result
	return true
end

-- Builds the new modules as a detached tree and swaps them in; falls back to the installed copy.
function host.reload(files, pluginHash: string)
	if failedHash == pluginHash then
		return
	end
	local root = Instance.new("Folder")
	root.Name = "HarpStudio_" .. tostring(pluginHash)
	local built, err = pcall(function()
		for _, file in files do
			local parent = root
			local segments = string.split(file.path, "/")
			for i = 1, #segments - 1 do
				local folder = parent:FindFirstChild(segments[i])
				if folder == nil then
					folder = Instance.new("Folder")
					folder.Name = segments[i]
					folder.Parent = parent
				end
				parent = folder
			end
			local name = string.gsub(segments[#segments], "%.luau$", "")
			if name ~= "Main.server" then
				local module = Instance.new("ModuleScript")
				module.Name = name
				module.Source = file.source
				module.Parent = parent
			end
		end
	end)
	if not built then
		failedHash = pluginHash
		warn("[Harp] Could not build the updated plugin: " .. tostring(err))
		return
	end
	if current then
		pcall(current.stop)
		current = nil
	end
	host.reloaded = true
	if boot(root) then
		print("[Harp] Studio plugin updated in place.")
	else
		failedHash = pluginHash
		boot(script)
	end
end

boot(script)

plugin.Unloading:Connect(function()
	if current then
		pcall(current.stop)
	end
end)

-- The toolbar button lives here so it survives updates; only the edit window shows one.
if RunService:IsEdit() then
	task.delay(1, function()
		local ok, toolbar = pcall(function()
			return plugin:CreateToolbar("Harp")
		end)
		if not ok then
			return
		end
		local button = toolbar:CreateButton(
			"SealCodeStudioToggle",
			"Show the Harp panel: connection, agent activity, safety and tool switches",
			"",
			"Harp"
		)
		button.ClickableWhenViewportHidden = true
		button.Click:Connect(function()
			local panel = host.widget()
			panel.Enabled = not panel.Enabled
		end)
		host.widget():GetPropertyChangedSignal("Enabled"):Connect(function()
			button:SetActive(widget.Enabled)
		end)
		-- Show the panel once, so a new user finds the switches without hunting for them.
		if plugin:GetSetting("SealCodeStudio.v1.panelShown") ~= true then
			plugin:SetSetting("SealCodeStudio.v1.panelShown", true)
			host.widget().Enabled = true
		end
		button:SetActive(host.widget().Enabled)
	end)
end
