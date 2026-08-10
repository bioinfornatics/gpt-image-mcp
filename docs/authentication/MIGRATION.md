# Authentication migration

## Existing Azure API-key users

No mandatory change. `IMAGE_PROVIDER=azure` plus `IMAGE_API_KEY` continues to infer `api_key`. Setting `IMAGE_AZURE_AUTH_MODE=api_key` explicitly is recommended for clarity.

## Move from API key to Azure CLI

1. Grant the user Azure OpenAI data-plane RBAC.
2. Run `az login --tenant <tenant>`.
3. Set `IMAGE_AZURE_AUTH_MODE=azure_cli` and optionally `IMAGE_AZURE_TENANT_ID`.
4. Remove `IMAGE_API_KEY` from Goose and the environment.
5. Restart and validate.

## Move from static remote bearer to Entra/OBO

Do not reuse `IMAGE_MCP_API_KEY` as an Entra token. Create server/client app registrations, set `IMAGE_MCP_AUTH_MODE=entra`, configure OBO values, place the confidential credential in a secure store, deploy behind HTTPS, validate with a test tenant, then revoke the static bearer after clients migrate.

Rollback by restoring the previous deployment/configuration. Revocation means deleting/rotating API keys, client secrets/certificates, federated credentials, sessions, and role assignments as appropriate.
