--!nocheck
-- The agent's tools as the panel lists them, so the user can switch any of them off.
-- StudioTools.test.ts checks that every tool the bridge offers appears here exactly once.

return {
	{
		id = "connection",
		title = "Connection and Studio",
		tools = {
			{ "get_bridge_status", "Connection status" },
			{ "get_connected_instances", "List connected places" },
			{ "get_place_info", "Place info" },
			{ "manage_studio", "Open, close or restart Studio" },
		},
	},
	{
		id = "explore",
		title = "Explore",
		tools = {
			{ "get_project_structure", "Browse the game tree" },
			{ "search_objects", "Search instances" },
			{ "get_instance_properties", "Read properties" },
			{ "selection", "Read or change the selection" },
		},
	},
	{
		id = "edit",
		title = "Build and edit",
		tools = {
			{ "set_properties", "Set properties" },
			{ "create_instances", "Create instances" },
			{ "delete_instances", "Delete instances" },
			{ "build_instances", "Atomic builds" },
		},
	},
	{
		id = "scripts",
		title = "Scripts",
		tools = {
			{ "get_script_source", "Read scripts" },
			{ "set_script_source", "Write scripts" },
			{ "edit_script", "Edit scripts" },
			{ "grep_scripts", "Search scripts" },
		},
	},
	{
		id = "luau",
		title = "Run Luau",
		tools = {
			{ "execute_luau", "Run Luau in edit" },
			{ "eval_server_runtime", "Run Luau in the play server" },
			{ "eval_client_runtime", "Run Luau in a play client" },
		},
	},
	{
		id = "playtest",
		title = "Playtest and logs",
		tools = {
			{ "playtest", "Start and stop playtests" },
			{ "multiplayer_playtest", "Multiplayer playtests" },
			{ "get_output_logs", "Read Output" },
		},
	},
	{
		id = "ui",
		title = "UI and input",
		tools = {
			{ "inspect_ui", "Inspect and audit UI" },
			{ "interact_ui", "Click or type in UI" },
			{ "simulate_mouse_input", "Mouse input" },
			{ "simulate_keyboard_input", "Keyboard input" },
		},
	},
	{
		id = "camera",
		title = "Camera, screenshots and devices",
		tools = {
			{ "camera", "Move and frame the camera" },
			{ "capture_screenshot", "Screenshots" },
			{ "capture_device_matrix", "Device matrix captures" },
			{ "get_device_simulator_state", "Read the device simulator" },
			{ "set_device_simulator", "Change the device simulator" },
		},
	},
	{
		id = "assets",
		title = "Creator Store assets",
		tools = {
			{ "search_assets", "Search the Creator Store" },
			{ "get_asset_details", "Asset details and thumbnail" },
			{ "insert_asset", "Insert assets" },
		},
	},
	{
		id = "blender",
		title = "Blender",
		tools = {
			{ "blender", "Run Blender jobs" },
			{ "import_mesh", "Import meshes into Studio" },
		},
	},
	{
		id = "animation",
		title = "Animation",
		tools = {
			{ "animation", "Inspect, play and create animations" },
		},
	},
	{
		id = "performance",
		title = "Performance and debugging",
		tools = {
			{ "capture_script_profiler", "Profile scripts in a playtest" },
			{ "get_memory_breakdown", "Memory by category" },
			{ "get_scene_analysis", "What makes the place heavy" },
			{ "set_network_profile", "Simulate lag and packet loss" },
			{ "breakpoints", "Logpoints in scripts" },
		},
	},
	{
		id = "files",
		title = "Files",
		tools = {
			{ "export_rbxm", "Save instances to a file" },
			{ "import_rbxm", "Load a file into the place" },
		},
	},
	{
		id = "docs",
		title = "Docs",
		tools = {
			{ "get_roblox_docs", "Roblox engine API reference" },
		},
	},
	{
		id = "skills",
		title = "Skills",
		tools = {
			{ "load_skill", "Load Roblox skills" },
		},
	},
}
