#!/usr/bin/env bash
# image-mcp launcher — works from any working directory.
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

# MCP hosts may intentionally launch child processes with a minimal environment.
# Default this stdio-specific launcher to stdio so it can never accidentally bind
# the HTTP port when the host omits or filters IMAGE_MCP_TRANSPORT.
export IMAGE_MCP_TRANSPORT="${IMAGE_MCP_TRANSPORT:-stdio}"

exec bun run src/main.ts "$@"
