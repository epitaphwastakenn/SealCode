// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off globalErrorInEffectCatch:off preferSchemaOverJson:off
import { parse } from "yaml";

/**
 * Roblox's engine API reference, read from the creator-docs repository's generated YAML and cut
 * down to what an agent needs: a summary and one short line per member, or one member in full.
 */

const RAW_BASE =
  "https://raw.githubusercontent.com/Roblox/creator-docs/main/content/en-us/reference/engine";
const TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 6 * 60 * 60_000;
const CACHE_MAX = 64;
/** Characters of member lines one answer may carry before they are shortened. */
const LIST_BUDGET = 15_000;
const MAX_INHERITED_LOOKUPS = 8;

export type DocsKind = "class" | "enum" | "datatype" | "library" | "global";

const FOLDERS: Readonly<Record<DocsKind, string>> = {
  class: "classes",
  enum: "enums",
  datatype: "datatypes",
  library: "libraries",
  global: "globals",
};

const GLOBAL_FILES = ["RobloxGlobals", "LuaGlobals"] as const;

/** Sections of a reference page that list members, in the order an agent reads them. */
const SECTIONS = [
  "constructors",
  "constants",
  "properties",
  "methods",
  "functions",
  "events",
  "callbacks",
  "math_operations",
  "items",
] as const;
type Section = (typeof SECTIONS)[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const asList = (value: unknown): ReadonlyArray<Record<string, unknown>> =>
  Array.isArray(value) ? value.filter(isRecord) : [];

/**
 * Documentation markdown as plain sentences: reference tokens become their label (or last name),
 * links keep their text, and code blocks, HTML and heading marks are dropped.
 */
export const cleanDocText = (text: string): string =>
  text
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(
      /`(?:Class|Enum|Datatype|Global|Library)\.([\w.:()]+?)(?:\|([^`]+))?`/gu,
      (_match, name: string, label: string | undefined) => `\`${label ?? name}\``,
    )
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/#{1,6}\s+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();

const shorten = (text: string, max: number): string => {
  const cleaned = cleanDocText(text);
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

/** The first sentence, or the first `max` characters when the sentence is long. */
const firstSentence = (text: string, max: number): string => {
  const cleaned = cleanDocText(text);
  const end = /[.!?](?:\s|$)/u.exec(cleaned);
  return shorten(end === null ? cleaned : cleaned.slice(0, end.index + 1), max);
};

const tagsOf = (entry: Record<string, unknown>): ReadonlyArray<string> =>
  Array.isArray(entry.tags)
    ? entry.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

const isDeprecated = (entry: Record<string, unknown>): boolean =>
  tagsOf(entry).includes("Deprecated") || asString(entry.deprecation_message).trim() !== "";

const typeText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (isRecord(value)) return asString(value.name) || asString(value.type);
  return "";
};

const parameterText = (parameter: Record<string, unknown>): string => {
  const fallback = parameter.default;
  const hasDefault = fallback !== null && fallback !== undefined && fallback !== "";
  return `${asString(parameter.name)}: ${typeText(parameter.type)}${hasDefault ? ` = ${String(fallback)}` : ""}`;
};

const returnText = (entry: Record<string, unknown>): string => {
  const types = asList(entry.returns).map((item) => typeText(item.type));
  return types.length === 0 ? "" : types.length === 1 ? types[0]! : `(${types.join(", ")})`;
};

/** `Animator:LoadAnimation(animation: Animation): AnimationTrack`. */
const signature = (section: Section, entry: Record<string, unknown>): string => {
  const name = asString(entry.name);
  switch (section) {
    case "properties":
    case "constants":
      return `${name}: ${typeText(entry.type)}`;
    case "items":
      return `${name} = ${String(entry.value)}`;
    case "math_operations":
      return `${typeText(entry.type_a)} ${asString(entry.operation)} ${typeText(entry.type_b)} -> ${typeText(entry.return_type)}`;
    default: {
      const parameters = asList(entry.parameters).map(parameterText).join(", ");
      const result = returnText(entry);
      return `${name}(${parameters})${result === "" ? "" : `: ${result}`}`;
    }
  }
};

const flagsOf = (entry: Record<string, unknown>): string => {
  const flags = tagsOf(entry).filter((tag) =>
    ["ReadOnly", "Yields", "NotScriptable", "NotReplicated", "Hidden"].includes(tag),
  );
  const security = asString(entry.security);
  if (security !== "" && security !== "None") flags.push(security);
  else if (isRecord(entry.security)) {
    const read = asString(entry.security.read);
    const write = asString(entry.security.write);
    if (read !== "" && read !== "None") flags.push(`read ${read}`);
    if (write !== "" && write !== "None" && write !== read) flags.push(`write ${write}`);
  }
  return flags.length === 0 ? "" : ` [${flags.join(", ")}]`;
};

interface Line {
  readonly section: Section;
  readonly name: string;
  readonly head: string;
  readonly summary: string;
}

const linesOf = (doc: Record<string, unknown>): { lines: Line[]; deprecated: number } => {
  const lines: Line[] = [];
  let deprecated = 0;
  for (const section of SECTIONS) {
    for (const entry of asList(doc[section])) {
      if (isDeprecated(entry)) {
        deprecated += 1;
        continue;
      }
      lines.push({
        section,
        name: asString(entry.name).split(/[.:]/u).at(-1) ?? "",
        head: `${signature(section, entry)}${flagsOf(entry)}`,
        summary: asString(entry.summary),
      });
    }
  }
  return { lines, deprecated };
};

/** Member lines per section, shortened step by step until they fit the budget. */
const fitLines = (lines: ReadonlyArray<Line>): Record<string, string[]> => {
  const render = (summaryMax: number, cap: number) => {
    const out: Record<string, string[]> = {};
    const counts: Record<string, number> = {};
    for (const line of lines) {
      const bucket = (out[line.section] ??= []);
      counts[line.section] = (counts[line.section] ?? 0) + 1;
      if (bucket.length >= cap) continue;
      const summary = summaryMax === 0 ? "" : firstSentence(line.summary, summaryMax);
      bucket.push(summary === "" ? line.head : `${line.head} - ${summary}`);
    }
    for (const [section, bucket] of Object.entries(out)) {
      const hidden = (counts[section] ?? 0) - bucket.length;
      if (hidden > 0) bucket.push(`…and ${String(hidden)} more; ask for one with member.`);
    }
    return out;
  };
  const size = (value: Record<string, string[]>) =>
    Object.values(value).reduce(
      (total, bucket) => total + bucket.reduce((sum, text) => sum + text.length + 4, 0),
      0,
    );
  for (const [summaryMax, cap] of [
    [140, 200],
    [90, 200],
    [50, 200],
    [0, 200],
    [0, 80],
    [0, 40],
  ] as const) {
    const rendered = render(summaryMax, cap);
    if (size(rendered) <= LIST_BUDGET) return rendered;
  }
  return render(0, 25);
};

const memberNames = (section: Section, entry: Record<string, unknown>): ReadonlyArray<string> => {
  const full = asString(entry.name);
  const short = full.split(/[.:]/u).at(-1) ?? full;
  return section === "math_operations" ? [asString(entry.operation), full] : [full, short];
};

const SECTION_KIND: Readonly<Record<Section, string>> = {
  constructors: "constructor",
  constants: "constant",
  properties: "property",
  methods: "method",
  functions: "function",
  events: "event",
  callbacks: "callback",
  math_operations: "operator",
  items: "item",
};

/** Every entry whose name, or name after the last `.`/`:`, equals `member` (case-insensitive). */
export const findMembers = (
  doc: Record<string, unknown>,
  member: string,
): ReadonlyArray<{ readonly section: Section; readonly entry: Record<string, unknown> }> => {
  const wanted = member.trim().toLowerCase();
  const found: Array<{ section: Section; entry: Record<string, unknown> }> = [];
  for (const section of SECTIONS) {
    for (const entry of asList(doc[section])) {
      if (memberNames(section, entry).some((name) => name.toLowerCase() === wanted)) {
        found.push({ section, entry });
      }
    }
  }
  return found;
};

const memberDetail = (section: Section, entry: Record<string, unknown>) => {
  const parameters = asList(entry.parameters).map((parameter) => ({
    name: asString(parameter.name),
    type: typeText(parameter.type),
    ...(parameter.default === null || parameter.default === undefined || parameter.default === ""
      ? {}
      : { default: String(parameter.default) }),
    summary: shorten(asString(parameter.summary), 400),
  }));
  const returns = asList(entry.returns).map((item) => ({
    type: typeText(item.type),
    summary: shorten(asString(item.summary), 300),
  }));
  const flags = flagsOf(entry).trim();
  return {
    kind: SECTION_KIND[section],
    signature: signature(section, entry),
    ...(flags === "" ? {} : { flags: flags.slice(1, -1) }),
    summary: shorten(asString(entry.summary), 500),
    ...(asString(entry.description).trim() === ""
      ? {}
      : { description: shorten(asString(entry.description), 2500) }),
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(returns.length === 0 ? {} : { returns }),
    ...(isRecord(entry.security) || asString(entry.security) !== ""
      ? { security: entry.security }
      : {}),
    ...(asString(entry.thread_safety) === "" ? {} : { threadSafety: entry.thread_safety }),
    ...(isDeprecated(entry)
      ? { deprecated: shorten(asString(entry.deprecation_message) || "Deprecated.", 300) }
      : {}),
  };
};

/** What the agent receives for a whole page: header facts plus one line per member. */
export const summarizeDoc = (kind: DocsKind, doc: Record<string, unknown>) => {
  const { lines, deprecated } = linesOf(doc);
  const inherits = Array.isArray(doc.inherits)
    ? doc.inherits.filter((item): item is string => typeof item === "string")
    : [];
  const tags = tagsOf(doc);
  const description = shorten(asString(doc.description), 900);
  const summary = shorten(asString(doc.summary), 400);
  return {
    kind,
    name: asString(doc.name),
    summary,
    ...(description === "" || description === summary ? {} : { description }),
    ...(inherits.length === 0 ? {} : { inherits }),
    ...(tags.length === 0 ? {} : { tags }),
    ...(isDeprecated(doc) ? { deprecated: true } : {}),
    ...fitLines(lines),
    ...(deprecated === 0 ? {} : { deprecatedMembersOmitted: deprecated }),
    ...(kind === "class" && inherits.length > 0
      ? {
          note: `Members inherited from ${inherits.join(", ")} are not listed; look those up by name, or pass member and the ancestors are searched.`,
        }
      : {}),
  };
};

export interface DocsFetcher {
  /** The YAML text of a page, or undefined when the repository has no such page. */
  readonly fetchPage: (folder: string, name: string) => Promise<string | undefined>;
}

const cache = new Map<string, { readonly at: number; readonly text: string | undefined }>();

export const httpDocsFetcher: DocsFetcher = {
  fetchPage: async (folder, name) => {
    const url = `${RAW_BASE}/${folder}/${name}.yaml`;
    const hit = cache.get(url);
    if (hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status === 404) {
      cache.set(url, { at: Date.now(), text: undefined });
      return undefined;
    }
    if (!response.ok) {
      throw new Error(`The docs repository answered HTTP ${String(response.status)} for ${url}.`);
    }
    const text = await response.text();
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(url, { at: Date.now(), text });
    return text;
  },
};

const parsePage = (text: string): Record<string, unknown> | undefined => {
  const parsed: unknown = parse(text);
  return isRecord(parsed) ? parsed : undefined;
};

const PREFIX = /^(?:Class|Enum|Datatype|Global|Library|Enums|Classes)\./u;

const nameVariants = (name: string): ReadonlyArray<string> => {
  const capitalized = `${name.slice(0, 1).toUpperCase()}${name.slice(1)}`;
  return capitalized === name ? [name] : [name, capitalized];
};

export type DocsLookup =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: string; readonly message: string };

const notFound = (name: string, kind: DocsKind | undefined): DocsLookup => ({
  ok: false,
  error: "not_found",
  message: `No ${kind ?? "class, enum, datatype, library or global"} named ${name} in the Roblox engine reference. Names are case-sensitive (BasePart, EasingStyle, Vector3, task); members go in member, not in name.`,
});

/** Finds a page by kind, or by trying each kind when none is given. */
const loadPage = async (
  fetcher: DocsFetcher,
  name: string,
  kind: DocsKind | undefined,
): Promise<
  | { readonly kind: DocsKind; readonly doc: Record<string, unknown>; readonly name: string }
  | undefined
> => {
  const kinds: ReadonlyArray<DocsKind> =
    kind === undefined ? ["class", "enum", "datatype", "library"] : [kind];
  for (const candidateKind of kinds) {
    if (candidateKind === "global") continue;
    for (const variant of nameVariants(name)) {
      const text = await fetcher.fetchPage(FOLDERS[candidateKind], variant);
      const doc = text === undefined ? undefined : parsePage(text);
      if (doc !== undefined) return { kind: candidateKind, doc, name: variant };
    }
  }
  return undefined;
};

/** A global function or value such as `print` or `typeof`, or the whole `RobloxGlobals` page. */
const loadGlobal = async (
  fetcher: DocsFetcher,
  name: string,
): Promise<
  | {
      readonly doc: Record<string, unknown>;
      readonly pageName: string;
      readonly whole: boolean;
    }
  | undefined
> => {
  for (const file of GLOBAL_FILES) {
    const text = await fetcher.fetchPage(FOLDERS.global, file);
    const doc = text === undefined ? undefined : parsePage(text);
    if (doc === undefined) continue;
    if (file.toLowerCase() === name.toLowerCase()) return { doc, pageName: file, whole: true };
    if (findMembers(doc, name).length > 0) return { doc, pageName: file, whole: false };
  }
  return undefined;
};

/**
 * The reference for one class, enum, datatype, library or global; with `member`, only that member
 * in full. A member a class does not declare is searched in the classes it inherits from.
 */
const lookup = async (
  input: {
    readonly name: string;
    readonly kind?: DocsKind | undefined;
    readonly member?: string | undefined;
  },
  fetcher: DocsFetcher = httpDocsFetcher,
): Promise<DocsLookup> => {
  const name = input.name.trim().replace(PREFIX, "");
  if (name === "") return { ok: false, error: "invalid_arguments", message: "name is required." };
  const member = input.member?.trim() === "" ? undefined : input.member?.trim();

  let page:
    | { readonly kind: DocsKind; readonly doc: Record<string, unknown>; readonly name: string }
    | undefined;
  if (input.kind !== "global") page = await loadPage(fetcher, name, input.kind);
  let wholeGlobal = true;
  if (page === undefined && (input.kind === undefined || input.kind === "global")) {
    const found = await loadGlobal(fetcher, name);
    if (found !== undefined) {
      page = { kind: "global", doc: found.doc, name: found.pageName };
      wholeGlobal = found.whole;
    }
  }
  if (page === undefined) return notFound(name, input.kind);

  const wantedMember = member ?? (wholeGlobal ? undefined : name);
  if (wantedMember === undefined) {
    return { ok: true, value: { success: true, ...summarizeDoc(page.kind, page.doc) } };
  }

  const direct = findMembers(page.doc, wantedMember);
  if (direct.length > 0) {
    return {
      ok: true,
      value: {
        success: true,
        kind: page.kind,
        name: page.name,
        members: direct.map(({ section, entry }) => memberDetail(section, entry)),
      },
    };
  }

  if (page.kind === "class") {
    const chain = Array.isArray(page.doc.inherits)
      ? page.doc.inherits.filter((item): item is string => typeof item === "string")
      : [];
    for (const ancestor of chain.slice(0, MAX_INHERITED_LOOKUPS)) {
      const text = await fetcher.fetchPage(FOLDERS.class, ancestor);
      const doc = text === undefined ? undefined : parsePage(text);
      if (doc === undefined) continue;
      const inherited = findMembers(doc, wantedMember);
      if (inherited.length > 0) {
        return {
          ok: true,
          value: {
            success: true,
            kind: "class",
            name: page.name,
            declaredIn: ancestor,
            members: inherited.map(({ section, entry }) => memberDetail(section, entry)),
          },
        };
      }
    }
  }

  const available = linesOf(page.doc)
    .lines.map((line) => line.name)
    .slice(0, 60);
  return {
    ok: false,
    error: "member_not_found",
    message: `${page.name} has no member named ${wantedMember}. Its members include: ${available.join(", ")}. Call without member for the full list.`,
  };
};

/** Never rejects: a network or parse failure comes back as `docs_unavailable`. */
export const lookupRobloxDocs = async (
  input: Parameters<typeof lookup>[0],
  fetcher: DocsFetcher = httpDocsFetcher,
): Promise<DocsLookup> => {
  try {
    return await lookup(input, fetcher);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      error: "docs_unavailable",
      message: `The Roblox docs could not be read (${detail}). Check the connection, or read the class in Studio with execute_luau instead.`,
    };
  }
};
