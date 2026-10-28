import type { Editor } from "@tiptap/core";
import { useEffect } from "react";

import { COMPOSER_VOICE_PREVIEW_KEY } from "./composerVoicePreview";

/** Hands the live voice guess to the editor's preview decoration. */
export function useComposerVoicePreview(editor: Editor | null, text: string): void {
  // oxlint-disable-next-line t3code/react-effect-budget -- ProseMirror owns the decoration state, so React can only push it in.
  useEffect(() => {
    if (
      !editor ||
      editor.isDestroyed ||
      COMPOSER_VOICE_PREVIEW_KEY.getState(editor.state) === text
    ) {
      return;
    }
    editor.view.dispatch(
      editor.state.tr.setMeta(COMPOSER_VOICE_PREVIEW_KEY, text).setMeta("addToHistory", false),
    );
  }, [editor, text]);
}
