# Authentication troubleshooting

| Symptom | Meaning and action |
|---|---|
| `IMAGE_API_KEY is required` | `api_key` mode was selected; supply the key securely or choose `azure_cli`. |
| Azure CLI executable/session unavailable | Install Azure CLI and run `az login --tenant <tenant>`, then `az account show`. |
| Azure CLI wrong tenant | Set `IMAGE_AZURE_TENANT_ID` and sign in to that tenant. |
| Azure 401 | Credential/token rejected; renew CLI login or check OBO app configuration. |
| Azure 403 | Authentication succeeded but Azure RBAC/model access is insufficient. |
| MCP 401 + `invalid_token` | Acquire a fresh token for the exact configured MCP audience. |
| MCP 403 + `insufficient_scope` | Client consent/token lacks `mcp.access`. |
| OBO interaction required | Administrator/user consent or Conditional Access interaction is required. |
| OBO unavailable | Verify tenant, server app ID, confidential credential and Entra availability. |

Never paste access tokens or client secrets into bug reports. Use correlation IDs and sanitized logs.

## Azure image deployments and runtime routing

IMAGE_DEPLOYMENT selects the default Azure image deployment. The router uses that default when model is omitted, the Microsoft MAI /mai/v1 adapter for MAI-Image-2.5, and the Azure OpenAI-compatible image endpoint for gpt-image-2. Unknown models are rejected before inference.

Both deployments must exist in the configured Foundry resource. provider_list shows the effective default and selectable models. MAI uses its own dimensions and PNG output without an explicit quality level; GPT Image 2 uses its documented quality and resolution options.

If a request fails, verify the exact deployment names, endpoint, authentication mode and access to the selected deployment.
