# Mode 2 — Azure CLI (local, keyless)

Use this mode for a local `stdio` MCP process. It uses the signed-in Azure user and Azure RBAC; no Azure OpenAI key is stored.

## Administrator prerequisite

Grant the user the minimum Azure OpenAI data-plane role required to invoke the deployment, scoped to the Azure OpenAI resource.

## User setup

```bash
az login --tenant <tenant-id>
az account show
```

Goose configuration:

```yaml
extensions:
  imagemcp:
    enabled: true
    type: stdio
    name: Image MCP
    cmd: npx
    args: ["--yes", "@bioinfornatics/image-mcp"]
    envs:
      IMAGE_PROVIDER: azure
      IMAGE_AZURE_AUTH_MODE: azure_cli
      IMAGE_AZURE_TENANT_ID: "<tenant-id>"
      IMAGE_BASE_URL: "https://RESOURCE.openai.azure.com"
      IMAGE_DEPLOYMENT: "DEPLOYMENT"
      IMAGE_MCP_TRANSPORT: stdio
      IMAGE_LOG_LEVEL: error
    env_keys: []
    timeout: 300
```

## Verify

Restart Goose, run `provider_validate`, then generate an image and confirm its saved path.

## Failures

If authentication fails, rerun `az login --tenant ...`; if Azure returns 403, ask an administrator to verify the Azure OpenAI resource role assignment.

## Cleanup

Run `az logout` on shared machines, remove obsolete account sessions, and have an administrator remove role assignments that are no longer required.
