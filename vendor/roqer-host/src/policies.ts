import type { SkillLibrary } from "@roqer/apps/desktop/runtime/skill-library";
import type { McpToolOutcome } from "@roqer/apps/desktop/runtime/mcp-types";

import { isRecord } from "./outcome";

type JsonRecord = Record<string, unknown>;

/**
 * The checks Roqer's desktop wraps around Studio calls (`runtime/studio-tools.ts`), for a host whose
 * caller sees the bridge tools directly. The evidence and activity records Roqer keeps for its own
 * interface stay there; what is kept here is what changes a call or what the model is told.
 */

export const SCRIPT_MUTATIONS = new Set([
  "set_script_source",
  "edit_script_lines",
  "edit_script_batch",
  "insert_script_lines",
  "delete_script_lines",
]);

const LUAU_EXECUTION = new Set(["execute_luau", "eval_server_runtime", "eval_client_runtime"]);

/** Same text match as Roqer: it misses concatenated assignments and may flag a mention. */
const SOURCE_WRITE_IN_LUAU = /\.Source\s*=[^=]|\bSetSource\b/;

export const SOURCE_WRITE_REFUSAL = [
  "This code assigns a script's Source, so it was not run.",
  "Script bodies must go through set_script_source: only the structured script operations produce a reviewable change and the read-back that verifies the write. Source assigned inside arbitrary Luau reaches Studio unchecked.",
  "Split it: run the Luau that creates or finds the instances, leaving Source alone, then call set_script_source {instancePath, source} once per script.",
].join("\n");

export const TEMPLATE_EXAMPLE = "roblox-animation-vfx/templates/vfx/emit.lua";

export type StudioCall = (tool: string, args: JsonRecord) => Promise<McpToolOutcome>;

export type PreparedCall =
  | { readonly kind: "send"; readonly args: JsonRecord; readonly note?: string }
  | { readonly kind: "answer"; readonly ok: boolean; readonly text: string };

const omitted = (value: unknown): boolean => value === undefined || value === null || value === "";

const normalizeNewlines = (value: string) => value.replace(/\r\n?/g, "\n");

type ScriptSnapshot = { source?: string; revision?: string; complete: boolean };

function stripLineNumbers(source: string, startLine: number): string {
  const lines = source.split("\n");
  const stripped: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const prefix = `${startLine + index}: `;
    const line = lines[index] ?? "";
    if (!line.startsWith(prefix)) return source;
    stripped.push(line.slice(prefix.length));
  }
  return stripped.join("\n");
}

export function snapshotFromOutcome(outcome: McpToolOutcome): ScriptSnapshot {
  const data = outcome.data;
  if (!isRecord(data)) return { complete: false };
  const startLine = typeof data.startLine === "number" ? data.startLine : 1;
  const endLine = typeof data.endLine === "number" ? data.endLine : undefined;
  const lineCount = typeof data.lineCount === "number" ? data.lineCount : undefined;
  return {
    ...(typeof data.source === "string"
      ? { source: stripLineNumbers(normalizeNewlines(data.source), startLine) }
      : {}),
    ...(typeof data.sourceRevision === "string"
      ? { revision: data.sourceRevision }
      : typeof data.revision === "string"
        ? { revision: data.revision }
        : {}),
    complete:
      startLine === 1 &&
      data.truncated !== true &&
      (endLine === undefined || lineCount === undefined || endLine >= lineCount),
  };
}

function templatePath(value: string): { name: string; resource: string } | undefined {
  const [name, ...rest] = value.split("/");
  const resource = rest.join("/");
  if (!name || rest[0] !== "templates" || !resource.toLowerCase().endsWith(".lua"))
    return undefined;
  return { name, resource };
}

/** Studio shortens an unqualified read of a long script; an explicit range is never shortened. */
const readWholeScript = (call: StudioCall, target: string, instanceId: unknown) =>
  call("get_script_source", {
    instancePath: target,
    line_range: "1-",
    ...(omitted(instanceId) ? {} : { instance_id: instanceId }),
  });

const failureReason = (outcome: McpToolOutcome) =>
  (
    outcome.message ||
    outcome.text ||
    outcome.errorCode ||
    "Studio did not return the script"
  ).slice(0, 500);

/** Applied before a call reaches the bridge. */
export async function prepareCall(
  tool: string,
  args: JsonRecord,
  call: StudioCall,
  templates: Pick<SkillLibrary, "load">,
): Promise<PreparedCall> {
  if (
    LUAU_EXECUTION.has(tool) &&
    typeof args.code === "string" &&
    SOURCE_WRITE_IN_LUAU.test(args.code)
  ) {
    return { kind: "answer", ok: false, text: SOURCE_WRITE_REFUSAL };
  }
  if (tool !== "set_script_source") return { kind: "send", args };

  const refuse = (reason: string): PreparedCall => ({
    kind: "answer",
    ok: false,
    text: `set_script_source was not called: ${reason}`,
  });
  let prepared = args;
  let note: string | undefined;
  let templateSource: string | undefined;
  const template = args.template;
  if (!omitted(template)) {
    if (typeof template !== "string")
      return refuse(`template must be a skill template path, such as ${TEMPLATE_EXAMPLE}.`);
    if (!omitted(args.source)) return refuse("pass source or template, not both.");
    const path = templatePath(template);
    if (path === undefined) {
      return refuse(
        `template must name a Lua file in a skill's templates folder, such as ${TEMPLATE_EXAMPLE}.`,
      );
    }
    try {
      templateSource = normalizeNewlines((await templates.load(path.name, path.resource)).content);
    } catch (error) {
      return refuse(
        `${template} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const { template: _template, ...rest } = args;
    prepared = { ...rest, source: templateSource };
    note = `Wrote ${template} (${templateSource.split("\n").length} lines) as this script's source. It has not changed, so there is no need to read it.`;
  } else if (typeof args.source !== "string") {
    return refuse(
      `source is required: the script's whole new text, or template for a skill template such as ${TEMPLATE_EXAMPLE}.`,
    );
  }

  const target = typeof prepared.instancePath === "string" ? prepared.instancePath : undefined;
  if (target === undefined || !omitted(prepared.expectedRevision)) {
    return { kind: "send", args: prepared, ...(note === undefined ? {} : { note }) };
  }
  // Only a script with nothing to lose is written against a revision read here; Studio still
  // refuses the write if it changed in between.
  const read = await readWholeScript(call, target, prepared.instance_id);
  if (!read.ok) {
    return refuse(
      `expectedRevision was omitted, and ${target} could not be read to check that it is empty: ${failureReason(read)}`,
    );
  }
  const snapshot = snapshotFromOutcome(read);
  if (templateSource !== undefined && snapshot.complete && snapshot.source === templateSource) {
    return {
      kind: "answer",
      ok: true,
      text: `${target} already holds ${String(template)} exactly, so nothing was written.`,
    };
  }
  if (!snapshot.complete || snapshot.source?.trim() !== "" || snapshot.revision === undefined) {
    const how = templateSource === undefined ? "" : ' (for a template, line_range "1" is enough)';
    return refuse(
      `${target} is not empty, so expectedRevision is required: read it with get_script_source${how} and pass that revision.`,
    );
  }
  return {
    kind: "send",
    args: { ...prepared, expectedRevision: snapshot.revision },
    ...(note === undefined ? {} : { note }),
  };
}

const reportedRevision = (outcome: McpToolOutcome): string | undefined => {
  const data = outcome.data;
  if (!isRecord(data)) return undefined;
  for (const key of ["revision", "newRevision", "sourceRevision"]) {
    if (typeof data[key] === "string") return data[key];
  }
  return undefined;
};

/**
 * Roqer reads back every successful script mutation and says whether the revision the write
 * reported is the one Studio now holds; the model is told to trust that and not re-read.
 */
export async function verifyScriptWrite(
  args: JsonRecord,
  outcome: McpToolOutcome,
  call: StudioCall,
): Promise<string | undefined> {
  if (!outcome.ok) return undefined;
  const target = typeof args.instancePath === "string" ? args.instancePath : undefined;
  if (target === undefined) return undefined;
  const expected = reportedRevision(outcome);
  const read = await readWholeScript(call, target, args.instance_id).catch(
    (error: unknown) =>
      ({
        ok: false,
        data: undefined,
        text: error instanceof Error ? error.message : String(error),
        httpStatus: 0,
        durationMs: 0,
      }) satisfies McpToolOutcome,
  );
  if (!read.ok) {
    return `The mutation succeeded, but the automatic read-back failed: ${failureReason(read)}. Do not describe this change as verified.`;
  }
  const actual = snapshotFromOutcome(read).revision;
  if (expected !== undefined && actual !== undefined && expected === actual) {
    return `Automatically read the script back and verified revision ${actual}.`;
  }
  const detail =
    expected === undefined
      ? "the mutation did not report a source revision"
      : actual === undefined
        ? "the read did not report a source revision"
        : "Studio holds a different revision than the write reported, so something else changed this script";
  return `The mutation succeeded, but the automatic read-back did not verify it: ${detail}. Do not describe this change as verified.`;
}

/** `set_script_source` takes `template` instead of `source`, and an empty script needs no revision. */
export function widenSetScriptSourceSchema(schema: JsonRecord): JsonRecord {
  const properties = isRecord(schema.properties) ? { ...schema.properties } : {};
  properties.source = {
    ...(isRecord(properties.source) ? properties.source : { type: "string" }),
    description: "The script's whole new text; or pass template instead.",
  };
  properties.template = {
    type: "string",
    description: `A skill's Lua template written verbatim as the source, e.g. ${TEMPLATE_EXAMPLE}. Do not load a template you are not changing, and never retype one.`,
  };
  properties.expectedRevision = {
    ...(isRecord(properties.expectedRevision) ? properties.expectedRevision : { type: "string" }),
    description:
      "The sourceRevision your last read returned. Omit it only for a script that is still empty.",
  };
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name) => name !== "source" && name !== "expectedRevision")
    : [];
  return { ...schema, properties, required };
}
