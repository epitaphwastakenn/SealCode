import { describe, expect, it } from "@effect/vitest";

import { cleanDocText, lookupRobloxDocs, type DocsFetcher } from "./robloxDocs.ts";

const PAGES: Readonly<Record<string, string>> = {
  "classes/Animator": `
name: Animator
type: class
summary: |
  Plays \`Class.Animation|Animations\` on a rig.
description: |
  Long text with a [link](../../x/) and \`Class.AnimationTrack\`.
inherits:
  - Instance
properties:
  - name: Animator.PreferLodEnabled
    summary: |
      Whether LOD throttling is allowed. It also does other things.
    type: boolean
    tags: []
    security:
      read: None
      write: None
  - name: Animator.Old
    summary: Gone.
    type: boolean
    tags: [Deprecated]
    deprecation_message: use something else
methods:
  - name: Animator:LoadAnimation
    summary: |
      Loads an animation.
    description: |
      More about loading.
    parameters:
      - name: animation
        type: Animation
        default: null
        summary: The animation.
      - name: fade
        type: number
        default: 0.1
        summary: Fade time.
    returns:
      - type: AnimationTrack
        summary: The track.
    tags: [Yields]
    security: None
events:
  - name: Animator.AnimationPlayed
    summary: Fires on play.
    parameters:
      - name: track
        type: AnimationTrack
        default: null
        summary: The track.
`,
  "classes/Instance": `
name: Instance
type: class
summary: Base class.
description: ''
inherits: []
properties:
  - name: Instance.Name
    summary: The name.
    type: string
    tags: []
    security:
      read: None
      write: None
methods: []
events: []
`,
  "enums/EasingStyle": `
name: EasingStyle
type: enum
summary: Easing.
description: ''
items:
  - name: Linear
    value: 0
    summary: Constant speed.
    tags: []
  - name: Sine
    value: 1
    summary: Gentle.
    tags: []
`,
  "globals/LuaGlobals": `
name: Lua globals
type: global
summary: Globals.
description: ''
properties: []
functions:
  - name: print
    summary: Prints values.
    parameters:
      - name: params
        type: Tuple
        default: null
        summary: Values.
    returns: []
`,
};

const fetcher: DocsFetcher = {
  fetchPage: async (folder, name) => PAGES[`${folder}/${name}`],
};

const value = async (input: Parameters<typeof lookupRobloxDocs>[0]) => {
  const found = await lookupRobloxDocs(input, fetcher);
  if (!found.ok) throw new Error(found.message);
  return found.value as Record<string, any>;
};

describe("cleanDocText", () => {
  it("turns reference tokens, links and code blocks into plain sentences", () => {
    expect(
      cleanDocText(
        "Use `Class.Animation|Animations` and `Class.Animator:LoadAnimation()` ([docs](../x)).\n\n```lua\nprint(1)\n```\n#### Warning\nDone.",
      ),
    ).toBe("Use `Animations` and `Animator:LoadAnimation()` (docs). Warning Done.");
  });
});

describe("lookupRobloxDocs", () => {
  it("lists a class's members one line each and leaves out deprecated ones", async () => {
    const doc = await value({ name: "Animator" });
    expect(doc).toMatchObject({
      kind: "class",
      name: "Animator",
      summary: "Plays `Animations` on a rig.",
      inherits: ["Instance"],
      deprecatedMembersOmitted: 1,
    });
    expect(doc.properties).toEqual([
      "Animator.PreferLodEnabled: boolean - Whether LOD throttling is allowed.",
    ]);
    expect(doc.methods).toEqual([
      "Animator:LoadAnimation(animation: Animation, fade: number = 0.1): AnimationTrack [Yields] - Loads an animation.",
    ]);
    expect(doc.events).toEqual([
      "Animator.AnimationPlayed(track: AnimationTrack) - Fires on play.",
    ]);
  });

  it("returns one member in full, finding it on an ancestor when the class has none", async () => {
    const own = await value({ name: "Animator", member: "loadanimation" });
    expect(own.members[0]).toMatchObject({
      kind: "method",
      signature: "Animator:LoadAnimation(animation: Animation, fade: number = 0.1): AnimationTrack",
      description: "More about loading.",
      parameters: [
        { name: "animation", type: "Animation" },
        { name: "fade", type: "number", default: "0.1" },
      ],
    });
    const inherited = await value({ name: "Animator", member: "Name" });
    expect(inherited).toMatchObject({ declaredIn: "Instance" });
    expect(inherited.members[0].signature).toBe("Instance.Name: string");
  });

  it("reads enums and finds a global by its own name", async () => {
    expect((await value({ name: "EasingStyle" })).items).toEqual([
      "Linear = 0 - Constant speed.",
      "Sine = 1 - Gentle.",
    ]);
    const print = await value({ name: "print" });
    expect(print).toMatchObject({ kind: "global" });
    expect(print.members[0].signature).toBe("print(params: Tuple)");
  });

  it("explains a missing page or member", async () => {
    expect(await lookupRobloxDocs({ name: "Nope" }, fetcher)).toMatchObject({
      ok: false,
      error: "not_found",
    });
    const missing = await lookupRobloxDocs({ name: "Animator", member: "Zzz" }, fetcher);
    expect(missing).toMatchObject({ ok: false, error: "member_not_found" });
    expect((missing as { message: string }).message).toContain("LoadAnimation");
  });

  it("reports a failing fetch instead of throwing", async () => {
    const broken: DocsFetcher = {
      fetchPage: async () => {
        throw new Error("offline");
      },
    };
    expect(await lookupRobloxDocs({ name: "Animator" }, broken)).toMatchObject({
      ok: false,
      error: "docs_unavailable",
    });
  });
});
