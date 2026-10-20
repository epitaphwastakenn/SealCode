--!nocheck
-- Script reads and writes. Every write is compare-and-set against the text it was computed
-- from, goes through the script editor when possible, is read back, and is compile-checked.

local ScriptEditorService = game:GetService("ScriptEditorService")

local Util = require(script.Parent.Parent.Util)

local Scripts = {}

local TRUNCATE_CHARS = 25000
local TRUNCATE_LINES = 400
local TRUNCATED_TO = 300
local MAX_EDITS = 20

local function sourceOf(container: LuaSourceContainer): string
	local ok, text = pcall(function()
		return ScriptEditorService:GetEditorSource(container)
	end)
	if ok and type(text) == "string" then
		return text
	end
	return container.Source
end
Scripts.sourceOf = sourceOf

local function resolveScript(args)
	local instance, problem = Util.resolve(args)
	if instance == nil then
		return nil, problem
	end
	if not instance:IsA("LuaSourceContainer") then
		return nil, "Instance is not a script: " .. instance.ClassName
	end
	return instance, nil
end

local function splitLines(text: string)
	local normalized = string.gsub(string.gsub(text, "\r\n", "\n"), "\r", "\n")
	local lines = string.split(normalized, "\n")
	local trailingNewline = #lines > 1 and lines[#lines] == ""
	if trailingNewline then
		table.remove(lines)
	end
	return lines, trailingNewline
end

local function parseRange(range: string?, lineCount: number)
	if range == nil or range == "" then
		return nil
	end
	local a, b = string.match(range, "^(%d+)%-(%d+)$")
	if a then
		return tonumber(a), tonumber(b)
	end
	a = string.match(range, "^(%d+)%-$")
	if a then
		return tonumber(a), lineCount
	end
	b = string.match(range, "^%-(%d+)$")
	if b then
		return 1, tonumber(b)
	end
	a = string.match(range, "^(%d+)$")
	if a then
		return tonumber(a), tonumber(a)
	end
	return nil
end

local function syntaxCheck(text: string, name: string)
	if loadstring == nil then
		return { syntaxCheck = "unavailable" }
	end
	local ok, fn, err = pcall(loadstring, text, "=" .. name)
	if not ok then
		return { syntaxCheck = "unavailable" }
	end
	if fn ~= nil then
		return {}
	end
	if type(err) == "string" and string.find(err, "not available", 1, true) then
		return { syntaxCheck = "unavailable" }
	end
	local line = tonumber(string.match(tostring(err), ":(%d+):"))
	return { syntaxError = { line = line, message = tostring(err) } }
end

function Scripts.get(args)
	local container, problem = resolveScript(args)
	if container == nil then
		return { error = problem }
	end
	local text = sourceOf(container)
	local revision = Util.revision(text)
	local lines = splitLines(text)
	local result = {
		path = Util.pathOf(container),
		instanceRef = Util.refOf(container),
		className = container.ClassName,
		revision = revision,
		lineCount = #lines,
	}
	if container:IsA("BaseScript") and not container.Enabled then
		result.enabled = false
	end
	if args.revisionOnly then
		return result
	end
	local first, last = parseRange(args.lineRange, #lines)
	if args.lineRange and first == nil then
		return { error = 'line_range must look like "42", "10-20", "10-" or "-20"' }
	end
	if first == nil then
		first, last = 1, #lines
		if #text > TRUNCATE_CHARS or #lines > TRUNCATE_LINES then
			last = math.min(TRUNCATED_TO, #lines)
			result.truncated = true
			result.note = string.format(
				"Script truncated to its first %d of %d lines. Use line_range to read the rest; the revision covers the whole script.",
				last,
				#lines
			)
		end
	end
	first = math.max(1, first)
	last = math.min(#lines, last)
	if first > last and #lines > 0 then
		return { error = string.format("line_range is outside the script's %d lines", #lines) }
	end
	if first ~= 1 or last ~= #lines then
		result.startLine = first
		result.endLine = last
	end
	local out = table.create(last - first + 1)
	for i = first, last do
		out[#out + 1] = if args.numbered then string.format("%d: %s", i, lines[i]) else lines[i]
	end
	result.source = table.concat(out, "\n")
	if not args.numbered and first == 1 and last == #lines then
		result.rawSource = text
	end
	return result
end

-- Writes `newText` if the script still holds `baseText`; returns the method used or an error.
local function apply(container: LuaSourceContainer, baseText: string, newText: string)
	local editorOk, editorErr = pcall(function()
		ScriptEditorService:UpdateSourceAsync(container, function(current)
			if current ~= baseText then
				error("Script source changed while the edit was being applied; read the script again and retry.", 0)
			end
			return newText
		end)
	end)
	if editorOk and sourceOf(container) == newText then
		return "editor", nil
	end
	if not editorOk and string.find(tostring(editorErr), "changed while the edit", 1, true) then
		return nil, tostring(editorErr)
	end
	if container.Source ~= baseText and sourceOf(container) ~= baseText then
		return nil, "Script source changed while the edit was being applied; read the script again and retry."
	end
	local directOk, directErr = pcall(function()
		container.Source = newText
	end)
	if not directOk then
		return nil, "Could not write the script: " .. tostring(editorErr or directErr)
	end
	if container.Source ~= newText then
		return nil, "Studio did not keep the new source."
	end
	return "direct", nil
end

local function commit(container: LuaSourceContainer, baseText: string, newText: string, expectedRevision: string?, action: string, extra)
	local previous = Util.revision(baseText)
	if expectedRevision ~= nil and expectedRevision ~= previous then
		return {
			error = "Source revision conflict; the script changed after it was read. Read it again and retry.",
			errorCode = "source_revision_conflict",
			expectedRevision = expectedRevision,
			actualRevision = previous,
			path = Util.pathOf(container),
		}
	end
	local recording = Util.beginRecording(action .. " " .. container.Name)
	local method, problem = apply(container, baseText, newText)
	if method == nil then
		Util.finishRecording(recording, false)
		return { error = problem, path = Util.pathOf(container) }
	end
	Util.finishRecording(recording, true)
	local result = {
		success = true,
		path = Util.pathOf(container),
		instanceRef = Util.refOf(container),
		method = method,
		previousRevision = previous,
		revision = Util.revision(newText),
		oldLength = #baseText,
		newLength = #newText,
	}
	for key, value in extra or {} do
		result[key] = value
	end
	for key, value in syntaxCheck(newText, container.Name) do
		result[key] = value
	end
	if result.syntaxError then
		result.message = "Written, but it does not compile: fix line " .. tostring(result.syntaxError.line) .. " before playtesting."
	end
	return result
end

function Scripts.set(args)
	local container, problem = resolveScript(args)
	if container == nil then
		return { error = problem }
	end
	if type(args.source) ~= "string" then
		return { error = "source is required" }
	end
	if type(args.expectedRevision) ~= "string" then
		return { error = "expectedRevision is required" }
	end
	local base = sourceOf(container)
	return commit(container, base, args.source, args.expectedRevision, "Write")
end

local function lineAt(text: string, position: number): number
	local _, count = string.gsub(string.sub(text, 1, position - 1), "\n", "")
	return count + 1
end

function Scripts.edit(args)
	local container, problem = resolveScript(args)
	if container == nil then
		return { error = problem }
	end
	local edits = args.edits
	if type(edits) ~= "table" or #edits == 0 then
		return { error = "edits must hold 1 to 20 replacements" }
	end
	if #edits > MAX_EDITS then
		return { error = string.format("at most %d edits per call", MAX_EDITS) }
	end
	local base = sourceOf(container)
	local spans = {}
	for index, edit in edits do
		local prefix = string.format("Edit %d: ", index)
		if type(edit) ~= "table" or type(edit.old_string) ~= "string" or type(edit.new_string) ~= "string" then
			return { error = prefix .. "old_string and new_string are required" }
		end
		if edit.old_string == "" then
			return { error = prefix .. "old_string must not be empty" }
		end
		local found = {}
		local from = 1
		while true do
			local s, e = string.find(base, edit.old_string, from, true)
			if s == nil then
				break
			end
			table.insert(found, { s = s, e = e })
			from = s + 1
		end
		if #found == 0 then
			return { error = prefix .. "old_string not found in script. Read it with get_script_source and copy the exact text, including indentation." }
		end
		local chosen = found[1]
		if #found > 1 then
			local anchor = tonumber(edit.line)
			if anchor == nil then
				return { error = string.format("%sold_string matches %d places. Add surrounding context, or pass line (where it starts).", prefix, #found) }
			end
			local best = math.huge
			for _, span in found do
				local distance = math.abs(lineAt(base, span.s) - anchor)
				if distance < best then
					best = distance
					chosen = span
				end
			end
		end
		table.insert(spans, { s = chosen.s, e = chosen.e, text = edit.new_string, index = index })
	end
	table.sort(spans, function(a, b)
		return a.s < b.s
	end)
	for i = 2, #spans do
		if spans[i].s <= spans[i - 1].e then
			return { error = string.format("Edits %d and %d overlap in the script. Combine them into one edit.", spans[i - 1].index, spans[i].index) }
		end
	end
	local parts = {}
	local cursor = 1
	for _, span in spans do
		table.insert(parts, string.sub(base, cursor, span.s - 1))
		table.insert(parts, span.text)
		cursor = span.e + 1
	end
	table.insert(parts, string.sub(base, cursor))
	local newText = table.concat(parts)
	local expected = if type(args.expectedRevision) == "string" then args.expectedRevision else nil
	return commit(container, base, newText, expected, "Edit", { editsApplied = #spans })
end

function Scripts.grep(args)
	local pattern = args.pattern
	if type(pattern) ~= "string" or pattern == "" then
		return { error = "pattern is required" }
	end
	local usePattern = args.usePattern == true
	local caseSensitive = args.caseSensitive == true
	if usePattern and not caseSensitive then
		caseSensitive = true
	end
	local needle = if caseSensitive then pattern else string.lower(pattern)
	if usePattern and not pcall(string.find, "", needle) then
		return { error = "pattern is not a valid Lua pattern" }
	end
	local root = nil
	if type(args.path) == "string" and args.path ~= "" and args.path ~= "game" then
		root = Util.resolvePath(args.path)
		if root == nil then
			return { error = "Instance not found: " .. args.path }
		end
	end
	local maxResults = math.clamp(tonumber(args.maxResults) or 100, 1, 1000)
	local context = math.clamp(tonumber(args.contextLines) or 0, 0, 5)
	local results = {}
	local total = 0
	local searched = 0
	local truncated = false
	Util.walk(root, function(instance)
		if not instance:IsA("LuaSourceContainer") then
			return false
		end
		searched += 1
		local lines = splitLines(sourceOf(instance))
		local matches = {}
		for number, line in lines do
			local haystack = if caseSensitive then line else string.lower(line)
			local column = string.find(haystack, needle, 1, not usePattern)
			if column then
				if total >= maxResults then
					truncated = true
					break
				end
				total += 1
				local match = { line = number, column = column, text = string.sub(line, 1, 300) }
				if context > 0 then
					match.before = {}
					match.after = {}
					for i = math.max(1, number - context), number - 1 do
						table.insert(match.before, string.sub(lines[i], 1, 300))
					end
					for i = number + 1, math.min(#lines, number + context) do
						table.insert(match.after, string.sub(lines[i], 1, 300))
					end
				end
				table.insert(matches, match)
			end
		end
		if #matches > 0 then
			table.insert(results, { path = Util.pathOf(instance), className = instance.ClassName, matches = matches })
		end
		return truncated
	end)
	return {
		results = results,
		totalMatches = total,
		scriptsSearched = searched,
		scriptsMatched = #results,
		truncated = truncated,
	}
end

return Scripts
