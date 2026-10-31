import type { ModelSelection } from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionDescriptors,
  migrateLegacyUltracodeSelection,
} from "@t3tools/shared/model";

import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  getClaudeCatalogModelCapabilities,
  normalizeClaudeCatalogEffort,
  resolveClaudeCatalogApiModelId,
  resolveClaudeCatalogEffort,
  type ClaudeModelCatalog,
} from "./provider/ClaudeModelCatalog.ts";

export interface CompiledClaudeModelSelection {
  readonly apiModelId: string;
  readonly effort: string | undefined;
  readonly settings: Readonly<Record<string, boolean>>;
  readonly queryIdentity: string;
}

export function compileClaudeModelSelection(
  input: ModelSelection,
  catalog: ClaudeModelCatalog = BUNDLED_CLAUDE_MODEL_CATALOG,
): CompiledClaudeModelSelection {
  const selection = migrateLegacyUltracodeSelection(input);
  const capabilities = getClaudeCatalogModelCapabilities(catalog, selection.model);
  const descriptors = getProviderOptionDescriptors({ caps: capabilities });
  const supportsBoolean = (id: string) =>
    descriptors.some((descriptor) => descriptor.type === "boolean" && descriptor.id === id);
  const rawEffort = getModelSelectionStringOptionValue(selection, "effort");
  const resolvedEffort = resolveClaudeCatalogEffort(catalog, selection.model, rawEffort);
  const effort = normalizeClaudeCatalogEffort(catalog, resolvedEffort, selection.model);
  const fastMode = supportsBoolean("fastMode")
    ? (getModelSelectionBooleanOptionValue(selection, "fastMode") ?? false)
    : undefined;
  const thinking = supportsBoolean("thinking")
    ? getModelSelectionBooleanOptionValue(selection, "thinking")
    : undefined;
  const ultracode =
    supportsBoolean("ultracode") && getModelSelectionBooleanOptionValue(selection, "ultracode");
  const settings = {
    ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
    ...(typeof fastMode === "boolean" ? { fastMode } : {}),
    ...(ultracode ? { ultracode: true } : {}),
  };
  const apiModelId = resolveClaudeCatalogApiModelId(catalog, selection);
  return {
    apiModelId,
    effort,
    settings,
    queryIdentity: JSON.stringify({ apiModelId, effort: effort ?? null, settings }),
  };
}
