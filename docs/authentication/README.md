# Azure authentication

Choose the simplest mode matching your deployment.

| You are... | Mode | Start here |
|---|---|---|
| Keeping an existing deployment or need the quickest setup | `api_key` | [API key](API_KEY.md) |
| Running Goose/Claude locally as an Azure user | `azure_cli` | [Azure CLI](AZURE_CLI.md) |
| Operating a remote multi-user enterprise MCP | `on_behalf_of` | [On-Behalf-Of](ON_BEHALF_OF.md) |

The two authentication boundaries are independent:

- `IMAGE_AZURE_AUTH_MODE` controls **MCP → Azure OpenAI**.
- `IMAGE_MCP_AUTH_MODE` controls **remote client → MCP HTTP**.

Run diagnostics without exposing credential values:

```bash
npx --yes @bioinfornatics/image-mcp auth doctor
```

The npm executable dispatches this subcommand before starting NestJS. From a clone, `bun run auth:doctor` provides the same diagnostic.

Enterprise administrators should also read [app registrations](APP_REGISTRATIONS.md) and the [managed identity/OBO credential roadmap](MANAGED_IDENTITY.md).

See [troubleshooting](TROUBLESHOOTING.md) and the [migration guide](MIGRATION.md).
