import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  resolveRestingComposerControlsLayout,
  resolveRestingComposerControlsNaturalWidth,
} from "../composerFooterLayout";
import { measureRestingComposerControls } from "./restingComposerControlsMeasurement";

function measurePicker(input: {
  clientWidth: number;
  flexGrow: string;
  maxWidth?: string;
  hiddenEffortWidth?: number;
  fixedControlWidths?: ReadonlyArray<number>;
}) {
  const label = { clientWidth: input.clientWidth, scrollWidth: 160 };
  const effortLabel = { clientWidth: 20, scrollWidth: 20 + (input.hiddenEffortWidth ?? 0) };
  const picker = {
    getBoundingClientRect: () => ({ width: 52 }),
    querySelector: (selector: string) =>
      selector.includes("effort-label") ? effortLabel : selector.includes("label") ? label : null,
  };
  const controls = {
    querySelector: (selector: string) => {
      if (selector === "[data-chat-provider-model-picker]") return picker;
      if (selector === "[data-resting-controls-overflow]") {
        return { getBoundingClientRect: () => ({ width: 24 }) };
      }
      return null;
    },
    querySelectorAll: (selector: string) =>
      selector === "[data-resting-controls-fixed]"
        ? (input.fixedControlWidths ?? []).map((width) => ({
            getBoundingClientRect: () => ({ width }),
          }))
        : [
            {
              dataset: {},
              querySelectorAll: () => [],
              getBoundingClientRect: () => ({ width: 140 }),
            },
          ],
  };
  vi.stubGlobal("getComputedStyle", (element: unknown) => {
    if (element === label) return { flexGrow: input.flexGrow };
    if (element === picker) return { minWidth: "52px", maxWidth: input.maxWidth ?? "none" };
    return { columnGap: "4px" };
  });
  return measureRestingComposerControls(controls as unknown as HTMLElement)!;
}

afterEach(() => vi.unstubAllGlobals());

describe("measureRestingComposerControls", () => {
  it("keeps controls inline when the model label is deliberately collapsed", () => {
    const measurement = measurePicker({ clientWidth: 0, flexGrow: "0" });

    expect(measurement.naturalFixedWidth).toBe(52);
    expect(resolveRestingComposerControlsNaturalWidth(measurement)).toBe(196);
    expect(resolveRestingComposerControlsLayout({ ...measurement, hostWidth: 200 })).toEqual({
      hiddenCount: 0,
      iconOnlyCount: 0,
      visible: true,
    });
  });

  it("recovers truncated text while the model label is flexible", () => {
    const measurement = measurePicker({ clientWidth: 20, flexGrow: "1" });

    expect(measurement.naturalFixedWidth).toBe(192);
    expect(resolveRestingComposerControlsLayout({ ...measurement, hostWidth: 200 })).toEqual({
      hiddenCount: 1,
      iconOnlyCount: 1,
      visible: true,
    });
  });

  it("recovers flexible text squeezed to zero instead of mistaking it for collapsed text", () => {
    const measurement = measurePicker({ clientWidth: 0, flexGrow: "1" });

    expect(measurement.naturalFixedWidth).toBe(212);
    expect(resolveRestingComposerControlsLayout({ ...measurement, hostWidth: 200 })).toEqual({
      hiddenCount: 1,
      iconOnlyCount: 1,
      visible: true,
    });
  });

  it("reserves room for the attach button and usage meter before the blocks", () => {
    const measurement = measurePicker({
      clientWidth: 0,
      flexGrow: "0",
      fixedControlWidths: [28, 28],
    });

    expect(measurement.naturalFixedWidth).toBe(116);
    expect(measurement.minimumFixedWidth).toBe(116);
    expect(resolveRestingComposerControlsLayout({ ...measurement, hostWidth: 200 })).toEqual({
      hiddenCount: 1,
      iconOnlyCount: 1,
      visible: true,
    });
  });

  it("recovers a truncated effort label", () => {
    expect(
      measurePicker({ clientWidth: 0, flexGrow: "0", hiddenEffortWidth: 30 }).naturalFixedWidth,
    ).toBe(82);
  });

  it("still caps recovered text at the model picker's maximum width", () => {
    expect(
      measurePicker({ clientWidth: 0, flexGrow: "1", maxWidth: "180px" }).naturalFixedWidth,
    ).toBe(180);
  });
});
