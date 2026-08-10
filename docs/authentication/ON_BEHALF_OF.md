# Mode 3 — Microsoft Entra On-Behalf-Of

Use OBO for a remote HTTPS MCP where every call must retain the signed-in user's Azure authorization.

## Entra administrator

1. Create a **server app registration** for the MCP API.
2. Expose an Application ID URI such as `api://<server-client-id>`.
3. Expose delegated scope `mcp.access`.
4. Configure the downstream delegated permissions required for Azure Cognitive Services and grant required consent.
5. Create/preauthorize the public or confidential **client app registration**, using exact redirect URIs and PKCE for public clients.
6. Create a rotating client secret for the current implementation and inject it through the platform secret store; never commit it. Certificate and workload-federated client assertions are documented as a roadmap in [MANAGED_IDENTITY.md](MANAGED_IDENTITY.md), not as currently supported runtime options.

## Azure administrator

Grant users the minimum Azure OpenAI data-plane role on the target resource. OBO does not elevate their RBAC permissions.

## Platform operator

```env
IMAGE_PROVIDER=azure
IMAGE_AZURE_AUTH_MODE=on_behalf_of
IMAGE_BASE_URL=https://RESOURCE.openai.azure.com
IMAGE_DEPLOYMENT=DEPLOYMENT
IMAGE_MCP_TRANSPORT=http
IMAGE_MCP_AUTH_MODE=entra
IMAGE_ENTRA_TENANT_ID=<tenant-guid>
IMAGE_ENTRA_CLIENT_ID=<server-client-id>
IMAGE_ENTRA_AUDIENCE=api://<server-client-id>
IMAGE_ENTRA_SCOPE=mcp.access
IMAGE_ENTRA_ALLOWED_CLIENT_IDS=<client-app-id>
IMAGE_ENTRA_CLIENT_SECRET_FILE=/run/secrets/gpt-image-mcp-entra-client-secret
IMAGE_HTTP_HOST=0.0.0.0
```

Terminate TLS at App Service, Container Apps ingress, APIM, or another trusted gateway. Never expose this mode over plaintext networks.

## End user

Configure the HTTPS MCP URL in an OAuth-capable client and sign in when prompted. The client obtains a token for the MCP audience. The server validates it, exchanges it via OBO for Cognitive Services, and Azure applies the user's permissions.

## Verification

1. Missing token returns 401 with a Bearer challenge.
2. Missing `mcp.access` returns 403 with `insufficient_scope`.
3. An allowed user can generate an image.
4. A user lacking Azure OpenAI RBAC receives a distinct 403.
5. Application logs contain no token, assertion, secret, or image Base64. Privacy-safe audit telemetry is tracked separately and must not be assumed until enabled.

See [ADR-007](../adr/007-three-mode-azure-authentication.md) for security boundaries and threats.
