# Speech to text

The composer can turn a spoken note into text. Click the microphone to the left of Send, talk, then
click it again (or Stop) to drop the transcript into the prompt. You can edit the text before
sending. Discard throws the clip away.

The same action is available from the command palette as **Record voice note**, and from the
keyboard as `composer.voice` (default `mod+shift+v`).

Recording does not send the message on its own. After the transcript lands in the composer, send it
the usual way.

## How transcription works

Chrome and Edge can transcribe in the browser while you record. No audio is uploaded in that
case. The desktop app does not have a browser speech service, so it always uses the server.

If the browser cannot transcribe, Harp sends the clip to a speech-to-text API on the machine
running the server. Configure one of these on that machine:

- `GROQ_API_KEY` — Groq Whisper
- `OPENAI_API_KEY` — OpenAI Whisper
- `SEALCODE_STT_API_KEY` and `SEALCODE_STT_BASE_URL` — any OpenAI-compatible transcription endpoint.
  Optional `SEALCODE_STT_MODEL` selects the model.

On the desktop app, you can also put those variables in `~/.t3/userdata/.env` (outside the git
repo). Restart Harp after changing that file.

A custom endpoint is used first when both the key and URL are set. Otherwise Groq is preferred when
both Groq and OpenAI keys are present.

If neither browser transcription nor a server key is available, the microphone still records. Harp
inserts the live preview text when it has any (see below), and otherwise explains that Chrome/Edge
or a Groq/OpenAI key is needed.

## Live preview

While you record, the words Harp hears appear dimmed at the end of the draft, so you can see what
is being captured. When you stop, the real transcript replaces them. If the server cannot
transcribe, Harp inserts the preview text instead of losing what you said.

The preview runs a small Whisper model in the app itself, on your GPU when there is one. The first
recording downloads the model from Hugging Face (about 600 MB, 40 MB without a GPU) and keeps it
for later; recording works meanwhile and the preview starts once the download finishes. The
download happens on the machine running the browser or desktop app, even when the server is
remote. The preview is a guide, so it can differ from the final transcript, and it may be wrong
on quiet audio or less common languages.

Turn it off in **Settings > General > Live transcription preview**.

## Permissions

The first recording asks for microphone access. Allow it in the browser or in system settings if
the desktop app prompts. Remote browsers need a microphone on the machine running the browser, not
on the server.

Clips are limited to two minutes.
