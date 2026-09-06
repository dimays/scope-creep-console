/**
 * Pure, DOM-free unified-diff parser (work-017). Turns the `git diff` text produced
 * by the ADR-009 preview sandbox into a structured, renderable shape so the Console
 * (and, portably, the work-013 chat shell) can show a proposed change as a diff block
 * instead of a raw blob. No filesystem, no git — just string → structure, so it's
 * fully unit-testable.
 */

export type DiffLineKind = "add" | "del" | "context" | "hunk";
export type DiffLine = { kind: DiffLineKind; text: string };
export type FileStatus = "added" | "deleted" | "modified" | "renamed";

export type FileDiff = {
  /** The file's path after the change (the `b/` side). */
  path: string;
  /** The pre-change path, present for renames. */
  oldPath?: string;
  status: FileStatus;
  lines: DiffLine[];
  additions: number;
  deletions: number;
};

/** Strip a leading `a/` or `b/` prefix git puts on diff paths. */
function stripPrefix(p: string): string {
  return p.replace(/^[ab]\//, "");
}

/**
 * Parse `git diff` / `git diff --cached` output into one entry per file. Unknown or
 * malformed input yields an empty array rather than throwing — a diff block should
 * never crash the chat.
 */
export function parseUnifiedDiff(diff: string): FileDiff[] {
  if (typeof diff !== "string" || diff.trim() === "") return [];
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;

  const push = () => {
    if (current) files.push(current);
  };

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      push();
      // `diff --git a/x b/x` — take the b-side as the canonical path.
      const parts = raw.slice("diff --git ".length).split(" ");
      const bSide = parts.length >= 2 ? parts[parts.length - 1] : parts[0];
      current = {
        path: stripPrefix(bSide ?? ""),
        status: "modified",
        lines: [],
        additions: 0,
        deletions: 0,
      };
      continue;
    }
    if (!current) continue;

    if (raw.startsWith("new file")) {
      current.status = "added";
      continue;
    }
    if (raw.startsWith("deleted file")) {
      current.status = "deleted";
      continue;
    }
    if (raw.startsWith("rename from ")) {
      current.oldPath = raw.slice("rename from ".length).trim();
      current.status = "renamed";
      continue;
    }
    if (raw.startsWith("rename to ")) {
      current.path = raw.slice("rename to ".length).trim();
      current.status = "renamed";
      continue;
    }
    // Header noise we don't render.
    if (
      raw.startsWith("index ") ||
      raw.startsWith("similarity ") ||
      raw.startsWith("old mode ") ||
      raw.startsWith("new mode ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ") ||
      raw.startsWith("\\ No newline")
    ) {
      // Recover the path from the +++ line for adds (where `diff --git` b-side is /dev/null-free anyway).
      if (raw.startsWith("+++ ") && current.path === "") {
        const p = raw.slice(4).trim();
        if (p !== "/dev/null") current.path = stripPrefix(p);
      }
      continue;
    }

    if (raw.startsWith("@@")) {
      current.lines.push({ kind: "hunk", text: raw });
      continue;
    }
    if (raw.startsWith("+")) {
      current.additions += 1;
      current.lines.push({ kind: "add", text: raw.slice(1) });
      continue;
    }
    if (raw.startsWith("-")) {
      current.deletions += 1;
      current.lines.push({ kind: "del", text: raw.slice(1) });
      continue;
    }
    if (raw.startsWith(" ")) {
      current.lines.push({ kind: "context", text: raw.slice(1) });
      continue;
    }
    // A blank trailing line inside a hunk is context.
    if (raw === "") {
      // Only keep in-hunk blanks (after we've started collecting lines).
      if (current.lines.length > 0) current.lines.push({ kind: "context", text: "" });
    }
  }
  push();
  return files;
}

/** Aggregate add/del counts across a parsed diff — handy for a one-line summary. */
export function diffStat(files: FileDiff[]): {
  files: number;
  additions: number;
  deletions: number;
} {
  return files.reduce(
    (acc, f) => ({
      files: acc.files + 1,
      additions: acc.additions + f.additions,
      deletions: acc.deletions + f.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}
