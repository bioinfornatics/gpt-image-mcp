# Use gpt-image-mcp with Goose (npx)

This guide targets an end-user computer; no repository clone or Bun installation is required.

## 1. Prerequisites

Install Goose and a current Node.js LTS release, then verify:

```bash
node --version
npx --version
```

## 2. Add the extension

Edit the Goose configuration file:

- Linux/macOS: `~/.config/goose/config.yaml`
- Windows: `%APPDATA%\Block\goose\config\config.yaml`

Merge one of the following entries under the existing `extensions:` map.

### OpenAI

```yaml
extensions:
  gptimagemcp:
    enabled: true
    type: stdio
    name: GPT Image MCP
    cmd: npx
    args: ["--yes", "@bioinfornatics/gpt-image-mcp@0.1.5"]
    env_keys:
      - IMAGE_API_KEY
    envs:
      IMAGE_PROVIDER: openai
      IMAGE_MCP_TRANSPORT: stdio
      IMAGE_DEFAULT_MODEL: gpt-image-2
      IMAGE_LOG_LEVEL: error
    timeout: 300
```

### Azure OpenAI

```yaml
extensions:
  gptimagemcp:
    enabled: true
    type: stdio
    name: GPT Image MCP
    cmd: npx
    args: ["--yes", "@bioinfornatics/gpt-image-mcp@0.1.5"]
    env_keys:
      - IMAGE_API_KEY
    envs:
      IMAGE_PROVIDER: azure
      IMAGE_MCP_TRANSPORT: stdio
      IMAGE_BASE_URL: "https://YOUR-RESOURCE.openai.azure.com"
      IMAGE_DEPLOYMENT: "YOUR-DEPLOYMENT"
      IMAGE_API_VERSION: "2025-04-01-preview"
      IMAGE_DEFAULT_MODEL: gpt-image-2
      IMAGE_LOG_LEVEL: error
    timeout: 300
```

`IMAGE_API_KEY` is the only secret above. Enter/update it through `goose configure`; do not put its value in `envs` or commit it to `config.yaml`. `IMAGE_MCP_API_KEY` is not needed for `stdio`: it protects the network-facing HTTP transport only.

Note: listing a name under `env_keys` only tells Goose which variable to forward — it does not read your shell's `export`. A shell `export IMAGE_API_KEY=sk-...` alone will not populate it; the value must be entered through `goose configure` (stored in Goose's keyring/config) before it can be resolved. If a secret fails to resolve at launch, re-run `goose configure` for the extension, or `goose auth:doctor` (where available) to diagnose secret resolution.

Restart Goose after changing the extension or its secret.

Goose may also add its own fields to the saved extension entry (e.g. `cwd`, `bundled`, `available_tools`) when it writes or normalizes `config.yaml`. These are managed by Goose itself — leave them as written; you do not need to set them by hand.

## 3. First image

Start a new Goose session and ask:

> Generate a 1024x1024 PNG of a red fox in a snowy forest.

Expected result:

1. the image is rendered in the conversation;
2. the response contains its saved path;
3. the file exists in the default directory below.

| System | Default image directory |
|---|---|
| Linux | Freedesktop `XDG_PICTURES_DIR/gpt-image-mcp`, otherwise `~/Images/gpt-image-mcp` |
| macOS | `~/Pictures/gpt-image-mcp` |
| Windows | `%USERPROFILE%\Pictures\gpt-image-mcp` |

Set `IMAGE_OUTPUT_DIR` under `envs` to override the final directory.

## Troubleshooting

| Symptom | Resolution |
|---|---|
| `npx is not recognized` | Install Node.js LTS, then restart Goose so it receives the updated `PATH`. |
| `Failed to fetch secret IMAGE_API_KEY` | Run `goose configure`, edit the extension, and enter the provider API key. |
| `Failed to fetch secret IMAGE_MODELS` | Remove `IMAGE_MODELS` from `env_keys`; if needed, put its non-secret value in `envs`. |
| `Incorrect API key` / HTTP 401 from provider | Replace `IMAGE_API_KEY` through `goose configure`. |
| `IMAGE_MCP_API_KEY is required` with package 0.1.1 | Upgrade the extension argument to `@0.1.2`; as a temporary 0.1.1 workaround, set `IMAGE_REQUIRE_MCP_AUTH: "false"` in `envs`. |
| npm prints dependency deprecation warnings | Warnings alone are non-blocking; inspect the final `ERROR` line if the extension exits. |
| Running `npx` manually appears to hang | This is normal for an MCP `stdio` process waiting for a client; launch it through Goose. |

## v0.1.3 initialization failure (bin/start.sh launch mode)

Symptom seen only with **v0.1.3** and only when the extension is configured to run the
source directly from a local clone (`cmd: bun`, `args: ["run", "/abs/path/src/main.ts"]`)
instead of the packaged `npx` distribution above:

```
TypeError: undefined is not an object (evaluating 'descriptor.value')
```

**Root cause:** the Goose host spawns the server process from **its own working
directory**, not from the project root. Bun only reads `bunfig.toml` (which preloads
`reflect-metadata`) from the process's current working directory. Without that preload,
NestJS decorators (`@Controller()`, `@Injectable()`, `@Post()`, …) call
`Reflect.defineMetadata()` before `reflect-metadata` has patched the global `Reflect`
object, and the process crashes on the first decorated class it evaluates. This is a
`cwd` problem, not a dependency, network, or secret problem.

**Resolution — pick one:**

1. **Preferred (packaged releases): use the packaged `npx` distribution** shown in section 2 above.
   The published npm package does not depend on a project-local `bunfig.toml` at all, so
   this failure mode does not apply. Upgrade the extension's package version pin from
   `@0.1.3` (or `bun run src/main.ts`) to `@0.1.2`.
2. **Local clone / development use only:** launch through the repository's
   `bin/start.sh`, which `cd`s into the project root before invoking Bun, guaranteeing
   `bunfig.toml` is found and `reflect-metadata` is preloaded:

   ```yaml
   extensions:
     gptimagemcp:
       enabled: true
       type: stdio
       name: GPT Image MCP (local clone)
       cmd: /ABSOLUTE/PATH/TO/gpt-image-mcp/bin/start.sh
       args: []
       env_keys:
         - IMAGE_API_KEY
       envs:
         IMAGE_PROVIDER: openai
         IMAGE_MCP_TRANSPORT: stdio
         IMAGE_LOG_LEVEL: error
       timeout: 300
   ```

   Use an **absolute path** to `bin/start.sh` in `cmd` — Goose does not otherwise know
   the project root, and a relative path is resolved against Goose's own `cwd`, which is
   exactly the problem being fixed. Do **not** point `cmd` at `bun` with `src/main.ts` in
   `args`.

**Credential configuration (either launch mode):**

- Set `IMAGE_PROVIDER` (and, for Azure, `IMAGE_BASE_URL` / `IMAGE_DEPLOYMENT` /
  `IMAGE_API_VERSION`) as plain, non-secret values under `envs:` — see the OpenAI/Azure
  examples in section 2.
- Provide the actual API key through one of:
  - `env_keys: [IMAGE_API_KEY]` with the value entered via `goose configure`, which stores
    it in Goose's own keyring/secret store (recommended, shown above); or
  - `IMAGE_API_KEY_FILE: /path/to/secret/file` under `envs:` with
    `IMAGE_MCP_SECRET_BACKEND: file` (the server's default), pointing at a file readable
    only by the local user — useful when the key is already provisioned by another
    secrets manager on disk.
- Never place the raw key value under `envs:` or commit it to `config.yaml`.
- `IMAGE_MCP_API_KEY` (the bearer token) is **not required** for `stdio` — it only
  protects the `IMAGE_MCP_TRANSPORT=http` network listener, irrelevant to this failure.

## HTTP deployments

HTTP remains secure by default. A server using `IMAGE_MCP_TRANSPORT=http` requires an `IMAGE_MCP_API_KEY` of at least 16 characters unless `IMAGE_REQUIRE_MCP_AUTH=false` is explicitly selected for trusted local-only use.

## Goose references

- [Using Extensions](https://goose-docs.ai/docs/getting-started/using-extensions/)
- [Configuration Files](https://goose-docs.ai/docs/guides/config-files/)
- [CLI Commands](https://goose-docs.ai/docs/guides/goose-cli-commands/)
