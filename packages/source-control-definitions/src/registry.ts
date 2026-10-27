import { makeSourceControlDefinitionRegistry } from "@t3tools/source-control-core/shared/definition";
import * as GitHub from "@t3tools/source-control-github/shared/definition";

export const builtInSourceControlDefinitions = makeSourceControlDefinitionRegistry([
  GitHub.definition,
]);
