--!nocheck
-- Playtests and viewport capture.

local AssetService = game:GetService("AssetService")
local RunService = game:GetService("RunService")

local Base64 = require(script.Parent.Parent.Base64)

local Runtime = {}

local test = { running = false, mode = nil, startedAt = nil, lastError = nil, endedAt = nil }

local function studioTest()
	local ok, service = pcall(function()
		return game:GetService("StudioTestService")
	end)
	return if ok then service else nil
end

-- Studio's play calls yield for the whole test, so they run in their own thread; the bridge
-- treats the play server's registration as the sign the test is up.
function Runtime.start(args)
	local mode = args.mode
	if mode ~= "play" and mode ~= "run" then
		return { error = 'mode must be "play" or "run"' }
	end
	if test.running and not RunService:IsRunning() and test.startedAt and os.clock() - test.startedAt > 5 then
		test.running = false
	end
	if test.running then
		return { error = "A playtest is already running." }
	end
	local service = studioTest()
	if service == nil then
		return { error = "This Studio has no StudioTestService, so SealCode cannot start a playtest. Press Play in Studio." }
	end
	test.running = true
	test.mode = mode
	test.startedAt = os.clock()
	test.lastError = nil
	local failed = nil
	task.spawn(function()
		local ok, err = pcall(function()
			if mode == "run" then
				service:ExecuteRunModeAsync({})
			else
				service:ExecutePlayModeAsync({})
			end
		end)
		test.running = false
		test.endedAt = os.clock()
		if not ok then
			test.lastError = tostring(err)
			failed = tostring(err)
		end
	end)
	-- A refusal surfaces almost at once; report it instead of waiting for a server that never comes.
	task.wait(0.3)
	if failed then
		return { error = "Studio did not start the playtest: " .. failed }
	end
	return { success = true, started = true, mode = mode }
end

function Runtime.state()
	return {
		running = test.running,
		mode = test.mode,
		studioRunning = RunService:IsRunning(),
		lastError = test.lastError,
		secondsSinceStart = if test.startedAt then math.floor(os.clock() - test.startedAt) else nil,
	}
end

-- Runs in the play server: only it may end the test.
function Runtime.endTest()
	local service = studioTest()
	if service == nil then
		return { error = "StudioTestService is unavailable in this playtest." }
	end
	local ok, err = pcall(function()
		service:EndTest("stopped_by_sealcode")
	end)
	if not ok then
		return { error = "Studio refused to end the test: " .. tostring(err) }
	end
	return { success = true }
end

local function readPixels(image, size: Vector2)
	local width, height = size.X, size.Y
	local ok, whole = pcall(function()
		return image:ReadPixelsBuffer(Vector2.zero, size)
	end)
	if ok then
		return whole
	end
	-- Some Studio builds cap one read at 1024 px a side: read tiles and stitch them.
	local out = buffer.create(width * height * 4)
	local tile = 1024
	for ty = 0, height - 1, tile do
		for tx = 0, width - 1, tile do
			local w = math.min(tile, width - tx)
			local h = math.min(tile, height - ty)
			local part = image:ReadPixelsBuffer(Vector2.new(tx, ty), Vector2.new(w, h))
			for row = 0, h - 1 do
				buffer.copy(out, ((ty + row) * width + tx) * 4, part, row * w * 4, w * 4)
			end
		end
	end
	return out
end

local function shrink(pixels, width: number, height: number, factor: number)
	local outWidth = math.max(1, width // factor)
	local outHeight = math.max(1, height // factor)
	local out = buffer.create(outWidth * outHeight * 4)
	for y = 0, outHeight - 1 do
		local sourceRow = y * factor * width
		local targetRow = y * outWidth
		for x = 0, outWidth - 1 do
			buffer.writeu32(out, (targetRow + x) * 4, buffer.readu32(pixels, (sourceRow + x * factor) * 4))
		end
		if y % 64 == 0 then
			task.wait()
		end
	end
	return out, outWidth, outHeight
end

function Runtime.capture(args)
	local ok, captureService = pcall(function()
		return game:GetService("CaptureService")
	end)
	if not ok or captureService == nil then
		return { error = "CaptureService is unavailable in this Studio." }
	end
	local contentId = nil
	local started = pcall(function()
		captureService:CaptureScreenshot(function(id)
			contentId = id
		end)
	end)
	if not started then
		return { error = "Studio refused the screenshot request." }
	end
	local deadline = os.clock() + 10
	while contentId == nil and os.clock() < deadline do
		task.wait(0.1)
	end
	if contentId == nil then
		return {
			error = "The screenshot never arrived. Make sure the Studio window is visible (not minimized) so the viewport renders, then retry.",
		}
	end
	local image
	local created, problem = pcall(function()
		image = AssetService:CreateEditableImageAsync(Content.fromUri(contentId))
	end)
	if not created then
		created, problem = pcall(function()
			image = AssetService:CreateEditableImageAsync(contentId)
		end)
	end
	if not created or image == nil then
		return {
			error = "Studio could not read the screenshot. Enable Game Settings > Security > Allow Mesh / Image APIs, then retry. (" .. tostring(problem) .. ")",
		}
	end
	local size = image.Size
	local nativeWidth, nativeHeight = size.X, size.Y
	local pixelsOk, pixels = pcall(readPixels, image, size)
	image:Destroy()
	if not pixelsOk then
		return { error = "Failed to read screenshot pixels: " .. tostring(pixels) }
	end
	local width, height = nativeWidth, nativeHeight
	local maxSize = math.clamp(tonumber(args.maxSize) or 1600, 256, 4096)
	local longest = math.max(width, height)
	if longest > maxSize then
		pixels, width, height = shrink(pixels, width, height, math.ceil(longest / maxSize))
	end
	return {
		success = true,
		width = width,
		height = height,
		nativeWidth = nativeWidth,
		nativeHeight = nativeHeight,
		data = Base64.encode(pixels),
	}
end

return Runtime
