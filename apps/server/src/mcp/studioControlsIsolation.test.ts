import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { expect, it } from "vitest";

const sourceFiles = (directory: string): ReadonlyArray<string> =>
  NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/u.test(entry.name) && !/\.test\./u.test(entry.name) ? [full] : [];
  });

it("gives agents no tool that changes a thread's Studio controls", () => {
  const offenders = sourceFiles(import.meta.dirname).filter((file) =>
    NodeFS.readFileSync(file, "utf8").includes("thread.studio-controls.set"),
  );
  expect(offenders).toEqual([]);
});
