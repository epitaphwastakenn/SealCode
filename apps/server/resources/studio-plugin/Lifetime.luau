--!nocheck
-- Everything this copy of the plugin started, so a hot reload can stop it completely: the
-- loader swaps in SealCode's newer code without the user reopening the place.

local Lifetime = {}

local connections = {}
local cleanups = {}
Lifetime.alive = true

-- Connects and remembers the connection; returns it like :Connect does.
function Lifetime.connect(signal, handler)
	local connection = signal:Connect(handler)
	table.insert(connections, connection)
	return connection
end

function Lifetime.track(connection)
	table.insert(connections, connection)
	return connection
end

function Lifetime.onStop(cleanup: () -> ())
	table.insert(cleanups, cleanup)
end

-- task.spawn for loops that must end with this copy: `step` runs until it returns false.
function Lifetime.loop(interval: number, step: () -> boolean?)
	task.spawn(function()
		while Lifetime.alive do
			task.wait(interval)
			if not Lifetime.alive then
				return
			end
			local ok, keep = pcall(step)
			if ok and keep == false then
				return
			end
		end
	end)
end

function Lifetime.stop()
	if not Lifetime.alive then
		return
	end
	Lifetime.alive = false
	for i = #cleanups, 1, -1 do
		pcall(cleanups[i])
	end
	for _, connection in connections do
		pcall(function()
			connection:Disconnect()
		end)
	end
	table.clear(connections)
	table.clear(cleanups)
end

return Lifetime
