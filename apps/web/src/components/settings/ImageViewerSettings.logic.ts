import type { ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { modelHasVision } from "@t3tools/shared/model";

import type { ProviderInstanceEntry } from "../../providerInstances";
import type { ModelEsque } from "../chat/providerIconUtils";

/**
 * The picker may only offer what the server accepts as a viewer, so both sides share
 * `modelHasVision`. A provider with no models yet (not signed in) stays visible when its driver
 * reads images, as it did before, so the saved choice does not vanish from the picker.
 */
export function providerCanViewImages(
  provider: Pick<ServerProvider, "driver" | "models">,
): boolean {
  return provider.models.length === 0
    ? modelHasVision({ driverKind: provider.driver })
    : provider.models.some((model) =>
        modelHasVision({ driverKind: provider.driver, capabilities: model.capabilities }),
      );
}

export function filterImageViewerModelOptions(
  entries: ReadonlyArray<ProviderInstanceEntry>,
  optionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>,
): ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>> {
  const filtered = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>();
  for (const entry of entries) {
    const options = optionsByInstance.get(entry.instanceId);
    if (options === undefined) continue;
    filtered.set(
      entry.instanceId,
      options.filter((option) =>
        modelHasVision({
          driverKind: entry.driverKind,
          // A custom model the catalog does not list has no capabilities, so its driver decides.
          capabilities: entry.models.find((model) => model.slug === option.slug)?.capabilities,
        }),
      ),
    );
  }
  return filtered;
}
