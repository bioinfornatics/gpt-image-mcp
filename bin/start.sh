#!/usr/bin/env bash
# gpt-image-mcp launcher — works from any working directory.
#
# Problem: Bun reads bunfig.toml only from the CWD. When Goose (or any MCP
# host) spawns this server from a different directory, bunfig.toml is not
# found, reflect-metadata is not preloaded, and NestJS decorators crash:
#   TypeError: undefined is not an object (evaluating 'descriptor.value')
#
# Fix: cd to the project root first so Bun finds bunfig.toml, which preloads
# reflect-metadata before any TypeScript module is evaluated.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"
exec bun run src/main.ts "$@"
