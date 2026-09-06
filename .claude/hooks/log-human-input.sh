#!/usr/bin/env bash
# UserPromptSubmit hook for console-rooted Scope Creep sessions (ADR-011 capture).
#
# Scope Creep work happens across two repos — the control plane (scope-creep) and this
# Console. The control plane has its own hook; this one captures prompts when the Owner
# runs Claude from the Console repo, and writes to the SAME local human-input store in
# the control plane (never here — see ADR-011: local-only, gitignored, never pushed).
#
# Single source of truth: reuses the control plane's redaction+append Python rather than
# duplicating it. Prompt JSON arrives on stdin; prints nothing to stdout; never blocks.

ROOT="${SCOPE_CREEP_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." 2>/dev/null && pwd)/scope-creep}"
SCRIPT="$ROOT/.claude/hooks/log-human-input.py"
[ -f "$SCRIPT" ] && python3 "$SCRIPT" "$ROOT" 2>/dev/null || true
exit 0
