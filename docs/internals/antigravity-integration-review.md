> Update: Antigravity now uses ACP by default. The CLI launcher, parser, MCP overlays,
> and PTY model probe described below were removed. This comparison records the
> earlier diagnosis; current behavior is documented in [providers](./providers.md#antigravity-acp).

# Antigravity integration review

Compared on 2026-09-05 with T3 main at
[`eced382b451abc35137e7047b010c6ae5f6e9353`](https://github.com/pingdotgg/t3code/tree/eced382b451abc35137e7047b010c6ae5f6e9353).

## Main finding

These are different runtimes. SealCode's default uses `agy` print mode, spawning
a process per turn and resuming by conversation ID. Its optional SDK mode uses a
Python bridge. T3 uses Google's official ACP executable and companion helper,
with its own sign-in. Replacing our executable path alone is not a migration.
See [T3's provider guide](https://github.com/pingdotgg/t3code/blob/eced382b451abc35137e7047b010c6ae5f6e9353/docs/user/providers-antigravity.md).

## Comparison

| Area | T3 | SealCode |
| --- | --- | --- |
| Turn completion | Awaits the native prompt response and drains queued events before settlement. | Parses print-mode frames and previously finalized on process exit before stdout closed. |
| Concurrency | Serializes prompt transitions; a generation identifier prevents superseded prompts from settling replacements. | Rejects overlapping processes; previously reset cancellation before rejecting a second send and accepted late output from settled processes. |
| Continuation | Keeps the session through a failed or cancelled prompt. | Previously discarded the conversation ID on either outcome. |
| Model selection | Validates against the account's current model options and supports changes in-session. | Uses a CLI discovery/default-model path and hard-coded SDK defaults. |
| Questions and approvals | Maps native ACP permission requests and offered choices. | CLI injects an MCP question service and instructions to avoid native questions; headless approval callbacks are unsupported. |

Sources: [T3 adapter](https://github.com/pingdotgg/t3code/blob/eced382b451abc35137e7047b010c6ae5f6e9353/apps/server/src/provider/Layers/AntigravityAdapter.ts),
[ACP support](https://github.com/pingdotgg/t3code/blob/eced382b451abc35137e7047b010c6ae5f6e9353/apps/server/src/provider/acp/AntigravityAcpSupport.ts),
and [protocol translation](https://github.com/pingdotgg/t3code/blob/eced382b451abc35137e7047b010c6ae5f6e9353/apps/server/src/provider/acp/AntigravityProtocol.ts).

Our existing MCP question bridge does support custom text answers in the same CLI
turn, and final-text deduplication avoids repeating streamed answers. Those are
useful behaviors to preserve during a migration.

## Changes made

The CLI adapter now waits for stdout closure when no terminal result has arrived,
keeps initialization separate from the terminal outcome, ignores late frames,
preserves conversation IDs after failures and interruptions, and clears stale
session errors after success. Rejecting an overlapping send preserves an existing
cancellation request. A terminal result still finishes promptly without waiting
for CLI shutdown.

Six deterministic lifecycle tests cover these transitions. Five failed before
the fix. An existing process test now waits for both question resolution and turn
completion before deleting its temporary working directory.

## Remaining work

Saved local history contains completed assistant messages followed by runtime
errors including missing `grep` and `context canceled`. This confirms the symptom,
but does not establish that every terminal CLI error is spurious. The existing
missing-MCP-argument exception remains narrowly scoped; this change does not hide
other provider failures or claim to fix every reported error.

Recommend a separate migration to the official ACP runtime, including installation,
sign-in, model discovery, native questions/approvals, and an explicit policy for
existing CLI conversations. Keep the current CLI/SDK settings usable until that
migration is tested. Copying T3's adapter wholesale would require adapting newer
contracts and would bypass SealCode's custom MCP and harness behavior.

Validation: 55 focused CLI/MCP tests and the targeted TypeScript check passed in
an isolated copy because the checkout's dependency links are broken. Targeted lint
reports four existing errors in unchanged lines (Node import aliases and global
platform access). No authenticated live Antigravity turn or installed-app build
was tested. The shared CLI adapter also serves CommandCode; its existing tests
were included, but live CommandCode shutdown behavior remains unverified.
