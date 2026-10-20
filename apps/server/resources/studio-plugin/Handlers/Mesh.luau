--!nocheck
-- Builds MeshParts from triangle lists (a Blender export, one group per material) with
-- EditableMesh, so a model reaches the place without an upload first.

local AssetService = game:GetService("AssetService")
local Selection = game:GetService("Selection")

local Util = require(script.Parent.Parent.Util)

local Mesh = {}

local MAX_VERTICES = 60000

local function buildPart(group, index: number)
	local vertices, triangles = group.vertices, group.triangles
	if type(vertices) ~= "table" or type(triangles) ~= "table" or #vertices < 9 or #triangles < 3 then
		return nil, "group " .. tostring(group.name or index) .. " has no triangles"
	end
	if #vertices / 3 > MAX_VERTICES then
		return nil, "group " .. tostring(group.name or index) .. " has more than " .. MAX_VERTICES .. " vertices; decimate it in Blender first"
	end
	local editable = AssetService:CreateEditableMesh()
	local ids = table.create(#vertices / 3)
	for i = 1, #vertices, 3 do
		ids[(i + 2) // 3] = editable:AddVertex(Vector3.new(vertices[i], vertices[i + 1], vertices[i + 2]))
	end
	for i = 1, #triangles, 3 do
		local a, b, c = ids[triangles[i] + 1], ids[triangles[i + 1] + 1], ids[triangles[i + 2] + 1]
		if a and b and c then
			editable:AddTriangle(a, b, c)
		end
	end
	local part = AssetService:CreateMeshPartAsync(Content.fromObject(editable))
	part.Name = tostring(group.name or ("Mesh" .. index))
	if type(group.color) == "table" and #group.color >= 3 then
		part.Color = Color3.new(math.clamp(group.color[1], 0, 1), math.clamp(group.color[2], 0, 1), math.clamp(group.color[3], 0, 1))
	end
	part.Anchored = true
	return part, nil
end

function Mesh.import(args)
	if type(args.groups) ~= "table" or #args.groups == 0 then
		return { error = "groups is required: one entry per material with vertices and triangles." }
	end
	local parent = workspace
	if type(args.parentPath) == "string" and args.parentPath ~= "" then
		parent = Util.resolvePath(args.parentPath)
		if parent == nil then
			return { error = "parentPath not found: " .. args.parentPath }
		end
	end
	local recording = Util.beginRecording("SealCode: import mesh")
	local model = Instance.new("Model")
	model.Name = tostring(args.name or "ImportedMesh")
	local problems = {}
	local made = 0
	for index, group in args.groups do
		local ok, part, problem = pcall(buildPart, group, index)
		if not ok then
			table.insert(problems, tostring(part))
		elseif part == nil then
			table.insert(problems, problem)
		else
			part.Parent = model
			made += 1
		end
	end
	if made == 0 then
		model:Destroy()
		Util.finishRecording(recording, false)
		return { error = "No mesh part could be built: " .. table.concat(problems, "; ") }
	end
	model.Parent = parent
	local position = args.position
	if type(position) == "table" then
		local _, size = model:GetBoundingBox()
		-- Sit the model on the given point rather than sinking half of it below.
		model:PivotTo(CFrame.new(tonumber(position.x) or 0, (tonumber(position.y) or 0) + size.Y / 2, tonumber(position.z) or 0))
	end
	Util.finishRecording(recording, true)
	Selection:Set({ model })
	local _, size = model:GetBoundingBox()
	return {
		success = true,
		path = Util.pathOf(model),
		parts = made,
		boundsSize = { x = math.floor(size.X * 100) / 100, y = math.floor(size.Y * 100) / 100, z = math.floor(size.Z * 100) / 100 },
		problems = if #problems > 0 then problems else nil,
		note = "These MeshParts are built in this Studio session from EditableMesh data. Roblox does not save that geometry with the place: publish the model as an asset (Open Cloud upload) before relying on it in a saved or published place.",
	}
end

return Mesh
