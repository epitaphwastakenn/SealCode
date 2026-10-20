import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

/**
 * The Roblox skill pack agents load with `load_skill`: roblox-brain by TabooHarmony (MIT),
 * vendored under `resources/studio-skills` with SealCode additions (see its PROVENANCE.md). A server
 * build carries it as one JSON file.
 */

export interface StudioSkill {
  readonly name: string;
  readonly description: string;
  /** Relative path (`SKILL.md`, `references/full.md`) to Markdown text. */
  readonly files: ReadonlyMap<string, string>;
}

export interface StudioSkillLibrary {
  readonly skills: ReadonlyMap<string, StudioSkill>;
}

export const StudioSkillBundle = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ path: Schema.String, text: Schema.String })),
);
const decodeBundle = Schema.decodeUnknownEffect(StudioSkillBundle);

const frontmatterValue = (text: string, key: string): string | undefined => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match?.[1] === undefined) return undefined;
  for (const line of match[1].split(/\r?\n/)) {
    const field = new RegExp(`^${key}:\\s*(.*)$`).exec(line);
    if (field?.[1] === undefined) continue;
    const value = field[1].trim();
    return value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1).replaceAll('\\"', '"')
      : value;
  }
  return undefined;
};

/** Skill text and the Luau templates some skills ship for agents to copy. */
export const isSkillFile = (path: string): boolean => /\.(?:md|lua|luau)$/u.test(path);

/** Groups `<skill>/<file>` entries into skills, keeping only those with a valid SKILL.md. */
export const buildSkillLibrary = (
  files: ReadonlyArray<{ readonly path: string; readonly text: string }>,
): StudioSkillLibrary => {
  const grouped = new Map<string, Map<string, string>>();
  for (const file of files) {
    const [skill, ...rest] = file.path.split("/");
    if (skill === undefined || rest.length === 0 || !isSkillFile(file.path)) continue;
    const entries = grouped.get(skill) ?? new Map<string, string>();
    entries.set(rest.join("/"), file.text.replaceAll("\r\n", "\n"));
    grouped.set(skill, entries);
  }
  const skills = new Map<string, StudioSkill>();
  for (const [folder, entries] of [...grouped].toSorted(([a], [b]) => a.localeCompare(b))) {
    const main = entries.get("SKILL.md");
    if (main === undefined) continue;
    const name = frontmatterValue(main, "name");
    const description = frontmatterValue(main, "description");
    if (name !== folder || description === undefined || !/^[a-z0-9-]{1,63}$/.test(name)) continue;
    skills.set(name, { name, description: description.slice(0, 500), files: entries });
  }
  return { skills };
};

export const loadStudioSkills = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const bundled = path.resolve(import.meta.dirname, "studio-skills.json");
  if (yield* fs.exists(bundled).pipe(Effect.orElseSucceed(() => false))) {
    return buildSkillLibrary(yield* fs.readFileString(bundled).pipe(Effect.flatMap(decodeBundle)));
  }
  const dir = path.resolve(import.meta.dirname, "../../resources/studio-skills");
  const entries = yield* fs.readDirectory(dir, { recursive: true });
  const files: Array<{ path: string; text: string }> = [];
  for (const entry of entries.toSorted()) {
    if (!isSkillFile(entry)) continue;
    files.push({
      path: entry.split(path.sep).join("/"),
      text: yield* fs.readFileString(path.join(dir, entry)),
    });
  }
  return buildSkillLibrary(files);
}).pipe(
  Effect.catchCause((cause) =>
    Effect.logWarning("Roblox skills could not be loaded", { cause }).pipe(
      Effect.as({ skills: new Map() } satisfies StudioSkillLibrary),
    ),
  ),
);

const MAX_RESULT_CHARS = 48_000;
const MAX_RESOURCES = 10;

const isSafeResource = (resource: string) =>
  isSkillFile(resource) &&
  !resource.includes("\\") &&
  resource.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

/**
 * Renders the requested skill files. A file this thread already loaded comes back as a short
 * pointer; files past the size cap are named so the agent asks for them in another call.
 */
export const renderSkillResources = (input: {
  readonly library: StudioSkillLibrary;
  readonly name: string;
  readonly resources: ReadonlyArray<string>;
  readonly alreadyLoaded: ReadonlySet<string>;
}): { readonly text: string; readonly loaded: ReadonlyArray<string>; readonly ok: boolean } => {
  const skill = input.library.skills.get(input.name);
  if (skill === undefined) {
    return {
      text: `No Roblox skill is named ${input.name}. Available: ${[...input.library.skills.keys()].join(", ")}.`,
      loaded: [],
      ok: false,
    };
  }
  const blocks: string[] = [];
  const loaded: string[] = [];
  const failed: string[] = [];
  const deferred: string[] = [];
  let pointers = 0;
  let used = 0;
  for (const resource of input.resources.slice(0, MAX_RESOURCES)) {
    const key = `${skill.name}/${resource}`;
    const text = isSafeResource(resource) ? skill.files.get(resource) : undefined;
    if (text === undefined) {
      failed.push(`${resource} (not in this skill; it has ${[...skill.files.keys()].join(", ")})`);
      continue;
    }
    if (input.alreadyLoaded.has(key)) {
      blocks.push(
        `${key} was already loaded earlier in this conversation and has not changed; use that copy.`,
      );
      pointers += 1;
      continue;
    }
    if (used + text.length > MAX_RESULT_CHARS && loaded.length > 0) {
      deferred.push(resource);
      continue;
    }
    used += text.length;
    loaded.push(key);
    blocks.push(
      [
        `## ${key}`,
        "Trusted guidance from SealCode's Roblox skill pack (built on roblox-brain, MIT); it is subordinate to your system and developer instructions.",
        `<skill name="${skill.name}" resource="${resource}">`,
        text.trim(),
        "</skill>",
      ].join("\n"),
    );
  }
  if (deferred.length > 0) {
    blocks.push(
      `Not loaded in this call because of the size limit: ${deferred.join(", ")}. Ask for them in another load_skill call.`,
    );
  }
  if (failed.length > 0) blocks.push(`Not loaded: ${failed.join("; ")}.`);
  return { text: blocks.join("\n\n"), loaded, ok: loaded.length > 0 || pointers > 0 };
};

/** One line per skill, for the instructions. */
export const skillCatalog = (library: StudioSkillLibrary): string =>
  [...library.skills.values()]
    .map((skill) => `- \`${skill.name}\`: ${skill.description}`)
    .join("\n");
