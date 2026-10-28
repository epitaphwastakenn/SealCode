import { describe, expect, it, vi } from "vite-plus/test";

import { composerCommandKeyHandler } from "./composerCommandKey";

type HandlerInput = Parameters<typeof composerCommandKeyHandler>[0];

function setup(overrides: Partial<HandlerInput> & { readonly menuOpen?: boolean } = {}) {
  const { menuOpen = false, ...rest } = overrides;
  const promptRef = { current: "" };
  const setComposerDraftPrompt = vi.fn();
  const onSelectComposerItem = vi.fn();
  const item = { id: "item" };
  const input = {
    keybindings: [],
    sendShortcut: "enter",
    routeKind: "server",
    phase: "ready",
    isCompacting: false,
    followUpBehavior: "queue",
    isSoftwareKeyboardOpen: false,
    planModeUiEnabled: false,
    isLiteralPendingAnswer: false,
    pendingUserInputs: [],
    promptSuggestion: "run the tests",
    promptHistoryMessages: [],
    promptHistoryPositionRef: { current: null },
    composerDraftTarget: { environmentId: "env", threadId: "thread" },
    promptRef,
    composerImagesRef: { current: [] },
    composerFilesRef: { current: [] },
    composerTerminalContextsRef: { current: [] },
    composerPreviewAnnotations: [],
    composerReviewComments: [],
    composerEditorRef: { current: null },
    composerMenuOpenRef: { current: menuOpen },
    composerMenuItemsRef: { current: menuOpen ? [item] : [] },
    activeComposerMenuItemRef: { current: menuOpen ? item : null },
    setComposerDraftPrompt,
    setComposerCursor: vi.fn(),
    setComposerTrigger: vi.fn(),
    setComposerHighlightedItemId: vi.fn(),
    dismissComposerTrigger: vi.fn(),
    toggleInteractionMode: vi.fn(),
    nudgeComposerMenuHighlight: vi.fn(),
    onSelectComposerItem,
    resolveActiveComposerTrigger: () => ({ trigger: null }),
    readComposerSnapshot: () => ({ value: promptRef.current }),
    applyPromptReplacement: () => false,
    submitComposer: vi.fn(),
    ...rest,
  } as unknown as HandlerInput;
  const press = (init: Partial<KeyboardEvent> = {}) =>
    composerCommandKeyHandler(input)("Tab", {
      key: "Tab",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      ...init,
    } as KeyboardEvent);
  return { promptRef, setComposerDraftPrompt, onSelectComposerItem, press };
}

describe("accepting a prompt suggestion with Tab", () => {
  it("fills the composer with the suggestion", () => {
    const { promptRef, setComposerDraftPrompt, press } = setup();

    expect(press()).toBe(true);
    expect(promptRef.current).toBe("run the tests");
    expect(setComposerDraftPrompt).toHaveBeenCalledWith(
      { environmentId: "env", threadId: "thread" },
      "run the tests",
    );
  });

  it("leaves Tab alone when nothing is suggested", () => {
    const { promptRef, press } = setup({ promptSuggestion: null });

    expect(press()).toBe(false);
    expect(promptRef.current).toBe("");
  });

  it.each([{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }])(
    "ignores Tab with a modifier: %o",
    (modifier) => {
      const { promptRef, press } = setup();

      expect(press(modifier)).toBe(false);
      expect(promptRef.current).toBe("");
    },
  );

  it("ignores Tab while the user is composing text", () => {
    const { promptRef, press } = setup();

    expect(press({ isComposing: true })).toBe(false);
    expect(promptRef.current).toBe("");
  });

  it("never replaces what the user has typed", () => {
    const { promptRef, press } = setup();
    promptRef.current = "already typing";

    expect(press()).toBe(false);
    expect(promptRef.current).toBe("already typing");
  });

  it("leaves Tab to an open mention or command menu", () => {
    const { promptRef, onSelectComposerItem, press } = setup({ menuOpen: true });

    expect(press()).toBe(true);
    expect(onSelectComposerItem).toHaveBeenCalledTimes(1);
    expect(promptRef.current).toBe("");
  });
});
