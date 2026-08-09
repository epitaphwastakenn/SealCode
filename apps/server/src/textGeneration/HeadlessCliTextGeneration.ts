import * as NodeChildProcess from "node:child_process";

import { TextGenerationError, type ProviderDriverKind } from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";

import { makeUnsupportedTextGeneration } from "./UnsupportedTextGeneration.ts";
import { buildContextTransferSummaryPrompt } from "./TextGenerationPrompts.ts";
import * as TextGeneration from "./TextGeneration.ts";

export interface HeadlessCliTextGenerationOptions {
  readonly binaryPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly provider: ProviderDriverKind;
  readonly providerName: string;
  readonly protocol: "antigravity" | "commandcode";
  readonly platform: NodeJS.Platform;
}

function parseSummary(value: string): string | undefined {
  const trimmed = value.trim();
  const candidates = [trimmed, trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).summary === "string"
      ) {
        return ((parsed as Record<string, unknown>).summary as string).trim();
      }
    } catch {
      // The provider may return the requested summary without a JSON envelope.
    }
  }
  return trimmed || undefined;
}

export function makeHeadlessCliTextGeneration(
  options: HeadlessCliTextGenerationOptions,
): TextGeneration.TextGeneration["Service"] {
  const unsupported = makeUnsupportedTextGeneration(options.providerName);
  const generateContextTransferSummary: TextGeneration.TextGeneration["Service"]["generateContextTransferSummary"] =
    Effect.fn(`${options.providerName}TextGeneration.generateContextTransferSummary`)(
      function* (input) {
        const { prompt } = buildContextTransferSummaryPrompt(input.context);
        const model = input.modelSelection.model;
        const effort =
          getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort") ??
          getModelSelectionStringOptionValue(input.modelSelection, "effort");
        const args =
          options.protocol === "antigravity"
            ? [
                "--print",
                prompt,
                "--output-format",
                "stream-json",
                "--print-timeout",
                "2m",
                "--mode",
                "plan",
                ...(model ? ["--model", model] : []),
                ...(effort ? ["--effort", effort] : []),
              ]
            : [
                "--no-auto-update",
                "--skip-onboarding",
                "--trust",
                "--max-turns",
                "1",
                "--print",
                prompt,
                "--output-format",
                "json",
                "--plan",
                ...(model ? ["--model", model] : []),
                ...(effort ? ["--effort", effort] : []),
              ];

        const summary = yield* Effect.callback<string, TextGenerationError>((resume) => {
          const child = NodeChildProcess.spawn(options.binaryPath, args, {
            cwd: input.cwd,
            env: options.environment,
            windowsHide: true,
            shell: options.platform === "win32" && /\.(?:cmd|bat)$/i.test(options.binaryPath),
          });
          let stdout = "";
          let stderr = "";
          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.on("data", (chunk: string) => {
            stdout += chunk;
          });
          child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
          });
          child.on("error", (error) => {
            resume(
              Effect.fail(
                new TextGenerationError({
                  operation: "generateContextTransferSummary",
                  detail: `${options.providerName} handoff failed: ${error.message}`,
                  cause: error,
                }),
              ),
            );
          });
          child.on("close", (code) => {
            if (code !== 0) {
              resume(
                Effect.fail(
                  new TextGenerationError({
                    operation: "generateContextTransferSummary",
                    detail: `${options.providerName} handoff failed: ${stderr.trim() || `CLI exited with code ${code}.`}`,
                  }),
                ),
              );
              return;
            }
            let response = "";
            for (const line of stdout.split(/\r?\n/)) {
              try {
                const frame = JSON.parse(line) as Record<string, unknown>;
                if (options.protocol === "antigravity" && frame.event === "result") {
                  const result = frame.result as Record<string, unknown> | undefined;
                  if (typeof result?.response === "string") response = result.response;
                } else if (frame.type === "result" && typeof frame.finalText === "string") {
                  response = frame.finalText;
                }
              } catch {
                // Stream frames are line-delimited JSON; non-JSON diagnostics are ignored.
              }
            }
            const parsed = parseSummary(response || stdout);
            resume(
              parsed
                ? Effect.succeed(parsed)
                : Effect.fail(
                    new TextGenerationError({
                      operation: "generateContextTransferSummary",
                      detail: `${options.providerName} returned an empty handoff summary.`,
                    }),
                  ),
            );
          });
          return Effect.sync(() => child.kill());
        });
        return { summary };
      },
    );

  return { ...unsupported, generateContextTransferSummary };
}
