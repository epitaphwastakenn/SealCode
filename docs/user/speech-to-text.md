# Speech to text

The composer can turn a spoken note into text. Click the microphone to the left of Send, talk, then
click it again (or Stop) to drop the transcript into the prompt. You can edit the text before
sending. Discard throws the clip away.

The same action is available from the command palette as **Record voice note**, and from the
keyboard as `composer.voice` (default `mod+shift+v`).

Recording does not send the message on its own. After the transcript lands in the composer, send it
the usual way.

## How transcription works

Chrome, Edge, and the desktop app can transcribe in the browser while you record. No audio is
uploaded in that case.

If the browser cannot transcribe, SealCode sends the clip to a speech-to-text API on the machine
running the server. Configure one of these on that machine:

- `GROQ_API_KEY` — Groq Whisper
- `OPENAI_API_KEY` — OpenAI Whisper
- `SEALCODE_STT_API_KEY` and `SEALCODE_STT_BASE_URL` — any OpenAI-compatible transcription endpoint.
  Optional `SEALCODE_STT_MODEL` selects the model.

On the desktop app, you can also put those variables in `~/.t3/userdata/.env` (outside the git
repo). Restart SealCode after changing that file.

A custom endpoint is used first when both the key and URL are set. Otherwise Groq is preferred when
both Groq and OpenAI keys are present.

If neither browser transcription nor a server key is available, the microphone still records, then
explains that Chrome/Edge or a Groq/OpenAI key is needed.

## Permissions

The first recording asks for microphone access. Allow it in the browser or in system settings if
the desktop app prompts. Remote browsers need a microphone on the machine running the browser, not
on the server.

Clips are limited to two minutes.

The iOS and Android apps do not record voice notes yet. Use the web or desktop composer.
