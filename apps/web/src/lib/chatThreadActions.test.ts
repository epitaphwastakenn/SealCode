import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
  type ServerSettings,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { describe, expect, it } from "vite-plus/test";
import { resolveNewThreadDefaults } from "./chatThreadActions";

const projectId = ProjectId.make("project-a");
const ENVIRONMENT_DEFAULT: ModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-5-5",
};
const PROJECT_DEFAULT: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-6.1-mini",
  options: [{ id: "reasoningEffort", value: "low" }],
};
const lastUsed = {
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-6.1-sol",
    options: [{ id: "reasoningEffort", value: "high" }],
  },
  runtimeMode: "auto",
  interactionMode: "plan",
} as const;

function settingsFor(overrides: Partial<ServerSettings> = {}) {
  return resolveProjectSettings(
    {
      ...DEFAULT_SERVER_SETTINGS,
      defaultModelSelection: ENVIRONMENT_DEFAULT,
      defaultRuntimeMode: "approval-required",
      ...overrides,
    },
    projectId,
  );
}

describe("resolveNewThreadDefaults", () => {
  it("prefers the project's last-used settings over environment defaults", () => {
    expect(resolveNewThreadDefaults({ projectSettings: settingsFor(), lastUsed })).toEqual({
      modelSelection: lastUsed.modelSelection,
      runtimeMode: "auto",
      interactionMode: "plan",
    });
  });

  it("falls back to environment defaults for a project nobody has used", () => {
    expect(resolveNewThreadDefaults({ projectSettings: settingsFor(), lastUsed: null })).toEqual({
      modelSelection: ENVIRONMENT_DEFAULT,
      runtimeMode: "approval-required",
      interactionMode: null,
    });
  });

  it("lets settings configured on the project itself win over its last-used settings", () => {
    const projectSettings = settingsFor({
      projectSettingsOverrides: {
        [projectId]: { defaultModelSelection: PROJECT_DEFAULT, defaultRuntimeMode: "full-access" },
      },
    });

    expect(resolveNewThreadDefaults({ projectSettings, lastUsed })).toEqual({
      modelSelection: PROJECT_DEFAULT,
      runtimeMode: "full-access",
      interactionMode: "plan",
    });
  });
});
