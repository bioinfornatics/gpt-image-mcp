# Legacy v0.1.3 source-launch failure

This page is retained only for users diagnosing an old local-clone configuration.

## Symptom

When Goose launched v0.1.3 source directly with `bun run /absolute/path/src/main.ts`, startup could fail with:

```text
TypeError: undefined is not an object (evaluating 'descriptor.value')
```

## Cause

Goose starts the process from its own working directory. Bun therefore did not load the repository's `bunfig.toml` and its `reflect-metadata` preload before NestJS decorators were evaluated.

## Current resolution

Use the current packaged npm release, or for local development configure the absolute repository script:

```yaml
cmd: /ABSOLUTE/PATH/TO/gpt-image-mcp/bin/start.sh
args: []
```

Do not launch an absolute `src/main.ts` path directly from an unrelated working directory.
