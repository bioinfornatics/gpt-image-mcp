# Microsoft Entra app registrations for OBO

## Server API registration

1. Create a single-tenant app registration.
2. Record tenant ID and application/client ID.
3. Under **Expose an API**, set an Application ID URI such as `api://<server-client-id>`.
4. Add delegated scope `mcp.access`.
5. Under API permissions, add only downstream delegated permissions required for Azure Cognitive Services and grant the required administrator consent.
6. Configure one confidential credential supported by the deployment. The current server implementation supports a client secret; keep it in Key Vault or the platform secret store and rotate it. Certificate/workload federation is planned but not yet accepted by the runtime configuration.

## Client registration

1. Register each approved MCP client separately.
2. Add the server API delegated permission `mcp.access`.
3. Configure exact redirect URIs. Desktop/public clients use Authorization Code with PKCE and must not embed a secret.
4. Preauthorize approved client IDs or require explicit consent according to policy.
5. Put approved client IDs in `IMAGE_ENTRA_ALLOWED_CLIENT_IDS`; an explicit allowlist is recommended for enterprise deployment.

## Cleanup

Remove test redirect URIs, secrets, federated credentials, permissions, consent grants and role assignments. Deleting Azure infrastructure does not necessarily delete app registrations.
