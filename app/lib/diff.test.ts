import { describe, expect, it } from "vitest";
import { diffStat, parseUnifiedDiff } from "./diff";

const MODIFIED = `diff --git a/app/routes/home.tsx b/app/routes/home.tsx
index 1111111..2222222 100644
--- a/app/routes/home.tsx
+++ b/app/routes/home.tsx
@@ -1,4 +1,4 @@
 import { Link } from "react-router";
-const title = "Console";
+const title = "Mission Control";
 export default function Home() {
   return null;
`;

const NEW_FILE = `diff --git a/app/lib/new.ts b/app/lib/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/app/lib/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
`;

const DELETED = `diff --git a/old.txt b/old.txt
deleted file mode 100644
index 4444444..0000000
--- a/old.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-gone
`;

describe("parseUnifiedDiff", () => {
  it("returns an empty array for empty/garbage input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("   ")).toEqual([]);
    expect(parseUnifiedDiff(null as unknown as string)).toEqual([]);
  });

  it("parses a modified file into add/del/context lines", () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    expect(file.path).toBe("app/routes/home.tsx");
    expect(file.status).toBe("modified");
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(1);
    const kinds = file.lines.map((l) => l.kind);
    expect(kinds).toContain("hunk");
    expect(kinds).toContain("add");
    expect(kinds).toContain("del");
    expect(kinds).toContain("context");
    const added = file.lines.find((l) => l.kind === "add");
    expect(added?.text).toBe('const title = "Mission Control";');
  });

  it("marks a new file as added", () => {
    const [file] = parseUnifiedDiff(NEW_FILE);
    expect(file.path).toBe("app/lib/new.ts");
    expect(file.status).toBe("added");
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(0);
  });

  it("marks a removed file as deleted", () => {
    const [file] = parseUnifiedDiff(DELETED);
    expect(file.path).toBe("old.txt");
    expect(file.status).toBe("deleted");
    expect(file.deletions).toBe(1);
  });

  it("parses several files in one diff", () => {
    const files = parseUnifiedDiff(`${MODIFIED}${NEW_FILE}`);
    expect(files.map((f) => f.path)).toEqual(["app/routes/home.tsx", "app/lib/new.ts"]);
  });
});

describe("diffStat", () => {
  it("aggregates counts across files", () => {
    const files = parseUnifiedDiff(`${MODIFIED}${NEW_FILE}`);
    expect(diffStat(files)).toEqual({ files: 2, additions: 3, deletions: 1 });
  });
});
