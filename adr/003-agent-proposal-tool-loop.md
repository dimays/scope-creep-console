---
name: console-adr-003
description: How a natural-language request becomes a concrete, isolated {path, content} proposal — a bounded read → propose tool loop, gated by the ADR-009 path-safety and preview machinery, never auto-applied.
metadata:
  type: reference
  status: active
  version: 1.0.0
  owner_agent: cto
  last_verified: 2026-09-06
---

# ADR-003 (Console): Agent-generated proposals — the read → propose tool loop

- **Status:** accepted
- **Date:** 2026-09-06
- **Ticket:** work-017 (part 1) · **Spec:** prd-chatbot-extension · **Respects:**
  [[adr-009]] (isolation + gated merge), INVARIANTS §III (propose, don't dispose) and
  §12 (loops must terminate)

## Context

work-014 gave the Console an in-app agent runtime, but it was text-only: it could not
turn "add a footer link" into an actual edit. work-015/016 shipped the other half — an
isolated worktree that previews a `{path, content}` proposal as a diff, and a gated PR
flow that lands it — but nothing produced the proposal. This ADR is the bridge: how the
agent drafts real edits, safely.

## Decision

**A bounded, injectable `read_file` → `propose_edits` tool loop that only ever produces
a proposal object — it never writes to the running repo.**

1. **Two tools, Anthropic tool-use.** `read_file(path)` returns a repo-relative file's
   current contents so the model can edit accurately; `propose_edits({title, summary,
   edits})` emits the final proposal, where each edit's `content` is the **complete new
   file** (the sandbox writes files whole). No `apply`/`write`/`merge` tool exists — the
   loop's only output is data.

2. **Full-file-replacement semantics.** Edits are whole-file contents, matching the
   `sandbox.server` applier, so there is no fragile patch-application step. The model is
   told to `read_file` before editing an existing file.

3. **Bounded loop (§12).** The loop runs at most `maxSteps` (default 6) model turns and
   returns on the first `propose_edits`, on a prose-only answer (`no_proposal`), or when
   the cap is hit (`max_steps`). It cannot run forever.

4. **Path safety at the tool boundary (the CRO gate).** `read_file` and the applier share
   one `isSafeRelPath` check (absolute paths, `..` escapes, null bytes rejected). The
   parsed proposal is then re-checked by `validateProposal` before **any** filesystem/git
   action — the gate is enforced twice, mechanically, not by prompt.

5. **Never auto-applied (ADR-009 / §III).** `proposeEdits` returns `{proposal, text,
   reason}`. The `/chat/propose` route validates it, previews it in a **throwaway
   worktree** (proving the live app is untouched — `liveClean`), and returns the diff.
   Applying/merging is a separate, Owner-initiated step through the existing gated
   `/chat/land` PR flow. The propose path pushes nothing and opens no PR.

6. **Injectable transport → testable offline.** The model call is a `ProposeTransport`
   function; the real one POSTs to Anthropic, tests pass a fake. With no
   `ANTHROPIC_API_KEY` the runtime returns a clean `no_key` result, so the app runs and
   the suite is green offline.

## Alternatives considered

- **Diff/patch-format edits** (unified diff the app applies). Rejected: patch application
  is brittle against a moving tree; whole-file content is unambiguous and matches the
  existing applier.
- **A single non-agentic call that must guess file contents.** Rejected: without
  `read_file` the model can't produce a correct full-file replacement for an existing
  file. A minimal read → propose loop is the smallest thing that works.
- **Let the loop apply edits directly and show the result.** Rejected outright: it
  violates ADR-009 / INVARIANTS §III. Isolation + the gated PR are the whole safety story.

## Consequences

- The flagship's core capability — talk to the app, get a real, reviewable, isolated
  proposal — works, reusing every existing gate.
- The interactive **live-serve** preview (Vite HMR iframe) and porting the diff block into
  the portable work-013 shell are **not** in this slice; they are carved into a follow-up
  (see work-042). This ADR covers only proposal generation + the in-Console diff render.
