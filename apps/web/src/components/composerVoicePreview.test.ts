import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { DecorationSet } from "@tiptap/pm/view";
import { describe, expect, it } from "vite-plus/test";

import {
  COMPOSER_VOICE_PREVIEW_KEY,
  createComposerVoicePreviewPlugin,
} from "./composerVoicePreview";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
});

function stateWith(...paragraphs: string[]) {
  const plugin = createComposerVoicePreviewPlugin();
  const state = EditorState.create({
    doc: schema.node(
      "doc",
      null,
      paragraphs.map((text) =>
        schema.node("paragraph", null, text.length > 0 ? [schema.text(text)] : []),
      ),
    ),
    plugins: [plugin],
  });
  return { plugin, state };
}

function previewWidgets(
  plugin: ReturnType<typeof createComposerVoicePreviewPlugin>,
  state: EditorState,
) {
  const decorations = plugin.props.decorations?.call(plugin, state) as
    | DecorationSet
    | null
    | undefined;
  return (
    decorations?.find().map((decoration) => ({
      position: decoration.from,
      key: (decoration.spec as { key: string }).key,
    })) ?? []
  );
}

describe("composer voice preview plugin", () => {
  it("shows nothing until a preview is set", () => {
    const { plugin, state } = stateWith("Notes:");
    expect(previewWidgets(plugin, state)).toEqual([]);
  });

  it("places the preview at the end of the draft, spaced from the last word", () => {
    const { plugin, state } = stateWith("Notes:");
    const next = state.apply(state.tr.setMeta(COMPOSER_VOICE_PREVIEW_KEY, "ship it"));

    // "Notes:" fills positions 1..7 inside the paragraph, so its end is 7.
    expect(previewWidgets(plugin, next)).toEqual([{ position: 7, key: "voice-preview: ship it" }]);
  });

  it("does not add a space after whitespace or at the start of an empty draft", () => {
    const spaced = stateWith("Notes: ");
    const afterSpace = spaced.state.apply(
      spaced.state.tr.setMeta(COMPOSER_VOICE_PREVIEW_KEY, "ship it"),
    );
    expect(previewWidgets(spaced.plugin, afterSpace)[0]?.key).toBe("voice-preview:ship it");

    const empty = stateWith("");
    const onEmpty = empty.state.apply(
      empty.state.tr.setMeta(COMPOSER_VOICE_PREVIEW_KEY, "ship it"),
    );
    expect(previewWidgets(empty.plugin, onEmpty)).toEqual([
      { position: 1, key: "voice-preview:ship it" },
    ]);
  });

  it("follows the last paragraph", () => {
    const { plugin, state } = stateWith("one", "two");
    const next = state.apply(state.tr.setMeta(COMPOSER_VOICE_PREVIEW_KEY, "three"));

    // <p>one</p> spans positions 0..5, so the second paragraph's text ends at 9.
    expect(previewWidgets(plugin, next)).toEqual([{ position: 9, key: "voice-preview: three" }]);
  });

  it("keeps the preview across document edits and clears when set empty", () => {
    const { plugin, state } = stateWith("Notes:");
    const previewing = state.apply(state.tr.setMeta(COMPOSER_VOICE_PREVIEW_KEY, "ship it"));
    const edited = previewing.apply(previewing.tr.insertText(" now", 7));

    expect(previewWidgets(plugin, edited)).toEqual([
      { position: 11, key: "voice-preview: ship it" },
    ]);

    const cleared = edited.apply(edited.tr.setMeta(COMPOSER_VOICE_PREVIEW_KEY, ""));
    expect(previewWidgets(plugin, cleared)).toEqual([]);
  });
});
