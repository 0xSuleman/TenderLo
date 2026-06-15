import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceFiles = collectSourceFiles(["apps", "packages"]);

describe("import boundaries", () => {
  it("keeps user-facing web code decoupled from worker jobs", () => {
    const offenders = sourceFiles
      .filter((file) => file.startsWith("apps/web/"))
      .filter((file) => !file.startsWith("apps/web/app/api/worker/"))
      .filter((file) => readFileSync(file, "utf8").includes("@tenderlo/worker"));

    expect(offenders).toEqual([]);
  });

  it("keeps package dependencies aligned with the architecture graph", () => {
    const allowed: Record<string, string[]> = {
      shared: [],
      db: ["shared"],
      sources: ["shared"],
      parsing: ["shared"],
      intelligence: ["shared", "parsing"],
      scoring: ["shared", "db"],
      notifications: ["shared", "db"]
    };

    const offenders: string[] = [];
    for (const file of sourceFiles.filter((item) => item.startsWith("packages/"))) {
      const packageName = file.split("/")[1];
      if (!packageName || !(packageName in allowed)) continue;
      const imports = [...readFileSync(file, "utf8").matchAll(/@tenderlo\/([a-z-]+)/g)].map((match) => match[1]).filter(Boolean);
      for (const importedPackage of imports) {
        if (importedPackage === packageName) continue;
        if (!allowed[packageName]?.includes(importedPackage)) {
          offenders.push(`${file} imports @tenderlo/${importedPackage}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

function collectSourceFiles(roots: string[]): string[] {
  const files: string[] = [];
  for (const root of roots) collect(root, files);
  return files;
}

function collect(path: string, files: string[]): void {
  if (path.includes("node_modules") || path.includes(".next")) return;
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const child of readdirSync(path)) collect(join(path, child), files);
    return;
  }
  if (path.endsWith(".ts") || path.endsWith(".tsx")) files.push(path);
}
