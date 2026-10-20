import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  buildSkillLibrary,
  loadStudioSkills,
  renderSkillResources,
  skillCatalog,
} from "./studioSkills.ts";

const library = buildSkillLibrary([
  {
    path: "roblox-gui/SKILL.md",
    text: '---\nname: roblox-gui\ndescription: "Use for UI."\n---\n# GUI\nUse inspect_ui.',
  },
  { path: "roblox-gui/references/full.md", text: "# Full\n" + "x".repeat(100) },
  { path: "broken/SKILL.md", text: "no frontmatter" },
  { path: "roblox-data/SKILL.md", text: "---\nname: other-name\ndescription: x\n---\n" },
]);

describe("studio skills", () => {
  it("keeps only skills whose frontmatter name matches their folder", () => {
    expect([...library.skills.keys()]).toEqual(["roblox-gui"]);
    expect(skillCatalog(library)).toBe("- `roblox-gui`: Use for UI.");
  });

  it("renders a resource once per thread, then points back to it", () => {
    const first = renderSkillResources({
      library,
      name: "roblox-gui",
      resources: ["SKILL.md"],
      alreadyLoaded: new Set(),
    });
    expect(first.ok).toBe(true);
    expect(first.loaded).toEqual(["roblox-gui/SKILL.md"]);
    expect(first.text).toContain('<skill name="roblox-gui" resource="SKILL.md">');
    expect(first.text).toContain("MIT, TabooHarmony");
    const again = renderSkillResources({
      library,
      name: "roblox-gui",
      resources: ["SKILL.md"],
      alreadyLoaded: new Set(first.loaded),
    });
    expect(again.ok).toBe(true);
    expect(again.text).toContain("already loaded");
  });

  it("refuses paths outside the skill and unknown skills, keeping the good resources", () => {
    const mixed = renderSkillResources({
      library,
      name: "roblox-gui",
      resources: ["references/full.md", "../roblox-data/SKILL.md", "nope.md"],
      alreadyLoaded: new Set(),
    });
    expect(mixed.loaded).toEqual(["roblox-gui/references/full.md"]);
    expect(mixed.text).toContain("Not loaded: ../roblox-data/SKILL.md");
    expect(
      renderSkillResources({
        library,
        name: "nope",
        resources: ["SKILL.md"],
        alreadyLoaded: new Set(),
      }).ok,
    ).toBe(false);
  });

  it.effect("loads the vendored roblox-brain pack", () =>
    Effect.gen(function* () {
      const real = yield* loadStudioSkills;
      expect(real.skills.size).toBeGreaterThanOrEqual(25);
      expect(real.skills.get("roblox-gui")?.files.has("SKILL.md")).toBe(true);
      expect(real.skills.has("roblox-studio-mcp")).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
