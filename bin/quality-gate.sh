#!/usr/bin/env bash
# quality-gate.sh — run lint / type-check / test / build reliably from any cwd.
#
# Problem: when this repo is launched by Goose (or any MCP host) or by Hermit
# shims, the process cwd is often NOT the project root. `bun run <script>`
# then either fails to find package.json/bunfig.toml, or — worse — a naive
# wrapper that discards a child's exit status (or a script that doesn't
# `set -e`) can swallow a child failure and report success.
#
# Fix:
#   1. Resolve PROJECT_ROOT from this script's own location (works regardless
#      of the caller's cwd) and `cd` there before running anything, exactly
#      like bin/start.sh already does for the server entrypoint.
#   2. `set -euo pipefail` so any failing command (including one on the left
#      side of a pipe) aborts the script immediately with its exit code.
#   3. Never wrap child commands in constructs that discard exit status
#      (no fallback-to-success operators, no unchecked conditional that
#      ignores the failure branch). Each gate's exit code IS this script's
#      exit code.
#
# Usage:
#   bin/quality-gate.sh                # run all gates: lint, type-check, test, build
#   bin/quality-gate.sh lint
#   bin/quality-gate.sh type-check
#   bin/quality-gate.sh test
#   bin/quality-gate.sh build
#   bin/quality-gate.sh lint type-check   # run a subset, in the order given

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

BUN_BIN="${BUN_BIN:-bun}"

if ! command -v "$BUN_BIN" >/dev/null 2>&1; then
  echo "❌ '$BUN_BIN' not found on PATH (cwd: $(pwd))" >&2
  exit 127
fi

if [ ! -f package.json ]; then
  echo "❌ package.json not found at resolved project root: $PROJECT_ROOT" >&2
  exit 1
fi

run_lint() {
  echo "▶ lint ($PROJECT_ROOT)"
  "$BUN_BIN" run lint
}

run_type_check() {
  echo "▶ type-check ($PROJECT_ROOT)"
  "$BUN_BIN" run type-check
}

run_test() {
  echo "▶ test ($PROJECT_ROOT)"
  "$BUN_BIN" run test
}

run_build() {
  echo "▶ build ($PROJECT_ROOT)"
  "$BUN_BIN" run build
}

GATES=("$@")
if [ "${#GATES[@]}" -eq 0 ]; then
  GATES=(lint type-check test build)
fi

for gate in "${GATES[@]}"; do
  case "$gate" in
    lint) run_lint ;;
    type-check) run_type_check ;;
    test) run_test ;;
    build) run_build ;;
    *)
      echo "❌ unknown gate: '$gate' (expected one of: lint type-check test build)" >&2
      exit 2
      ;;
  esac
done

echo "✅ all requested gates passed: ${GATES[*]}"
