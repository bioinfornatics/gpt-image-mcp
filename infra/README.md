# Azure Container Apps OBO deployment

This Bicep starter deploys the MCP on HTTPS Container Apps with Log Analytics. Create the Entra server/client registrations first using `docs/authentication/APP_REGISTRATIONS.md` and assign users least-privilege Azure OpenAI data-plane access at the resource scope.

Never put the real `entraClientSecret` in `main.bicepparam` or source control. Validate before deployment:

```bash
az deployment group what-if --resource-group <rg> --template-file infra/main.bicep --parameters infra/main.bicepparam entraClientSecret='<secure-value>'
az deployment group create --resource-group <rg> --template-file infra/main.bicep --parameters infra/main.bicepparam entraClientSecret='<secure-value>'
```

For production, replace the inline deployment secret with your organization's Key Vault/secret-reference pattern and private networking/APIM policy as required. Removing the resource group does not remove Entra app registrations, consent grants, credentials, or external role assignments; remove those separately.
