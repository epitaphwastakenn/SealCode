// Prints the system instructions Harp gives agents in the Harp Studio mode, for
// harness comparisons run outside the app: node scripts/print-studio-instructions.ts > out.md
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

import { studioBridgeInstructions } from "../src/studioBridge/instructions.ts";
import { loadStudioSkills, skillCatalog } from "../src/studioBridge/studioSkills.ts";

const program = Effect.gen(function* () {
  const library = yield* loadStudioSkills;
  process.stdout.write(
    studioBridgeInstructions({
      skillCatalog: skillCatalog(library),
      autoPlaytest: true,
      officialMcp: false,
      blenderMcp: false,
    }),
  );
});

Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer)));
