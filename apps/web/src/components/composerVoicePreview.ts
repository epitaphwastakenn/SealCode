import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { formatVoicePreviewText } from "~/lib/liveTranscription/transcript";

export const COMPOSER_VOICE_PREVIEW_KEY = new PluginKey<string>("composer-voice-preview");

/**
 * Shows the live voice guess dimmed after the draft, where the final transcript will land. It is
 * a decoration, so it never enters the document, the draft, or the undo history.
 */
export function createComposerVoicePreviewPlugin(): Plugin<string> {
  return new Plugin<string>({
    key: COMPOSER_VOICE_PREVIEW_KEY,
    state: {
      init: () => "",
      apply: (transaction, current) => {
        const next: unknown = transaction.getMeta(COMPOSER_VOICE_PREVIEW_KEY);
        return typeof next === "string" ? next : current;
      },
    },
    props: {
      decorations(state) {
        const text = COMPOSER_VOICE_PREVIEW_KEY.getState(state);
        if (!text) {
          return null;
        }
        const end = Selection.atEnd(state.doc).to;
        const tail = state.doc.textBetween(Math.max(0, end - 1), end, "\n", "\u0000");
        const display = formatVoicePreviewText(tail, text);
        if (display.length === 0) {
          return null;
        }
        return DecorationSet.create(state.doc, [
          Decoration.widget(
            end,
            () => {
              const element = document.createElement("span");
              element.className = "pointer-events-none select-none text-placeholder";
              element.setAttribute("aria-hidden", "true");
              element.setAttribute("data-composer-voice-preview", "true");
              element.textContent = display;
              return element;
            },
            { side: 1, key: `voice-preview:${display}` },
          ),
        ]);
      },
    },
  });
}

export const ComposerVoicePreviewExtension = Extension.create({
  name: "composer-voice-preview",
  addProseMirrorPlugins() {
    return [createComposerVoicePreviewPlugin()];
  },
});
