@description('Azure region for the Container Apps environment')
param location string = resourceGroup().location
@description('Globally unique Container App name')
param appName string
@description('Published image-mcp container image')
param containerImage string
@secure()
@description('Microsoft Entra confidential client secret; prefer a Key Vault reference in production')
param entraClientSecret string
param entraTenantId string
param entraClientId string
param entraAudience string
param azureOpenAiEndpoint string
param azureOpenAiDeployment string

resource log 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: '${appName}-logs'
  location: location
  properties: { retentionInDays: 30 }
}
resource env 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: '${appName}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: log.properties.customerId
        sharedKey: listKeys(log.id, log.apiVersion).primarySharedKey
      }
    }
  }
}
resource app 'Microsoft.App/containerApps@2025-02-02-preview' = {
  name: appName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 3000, transport: 'http', allowInsecure: false }
      secrets: [{ name: 'entra-client-secret', value: entraClientSecret }]
    }
    template: {
      containers: [{
        name: 'image-mcp'
        image: containerImage
        env: [
          { name: 'IMAGE_PROVIDER', value: 'azure' }
          { name: 'IMAGE_AZURE_AUTH_MODE', value: 'on_behalf_of' }
          { name: 'IMAGE_MCP_TRANSPORT', value: 'http' }
          { name: 'IMAGE_MCP_AUTH_MODE', value: 'entra' }
          { name: 'IMAGE_HTTP_HOST', value: '0.0.0.0' }
          { name: 'IMAGE_BASE_URL', value: azureOpenAiEndpoint }
          { name: 'IMAGE_DEPLOYMENT', value: azureOpenAiDeployment }
          { name: 'IMAGE_ENTRA_TENANT_ID', value: entraTenantId }
          { name: 'IMAGE_ENTRA_CLIENT_ID', value: entraClientId }
          { name: 'IMAGE_ENTRA_AUDIENCE', value: entraAudience }
          { name: 'IMAGE_ENTRA_SCOPE', value: 'mcp.access' }
          { name: 'IMAGE_ENTRA_CLIENT_SECRET', secretRef: 'entra-client-secret' }
        ]
        resources: { cpu: json('0.5'), memory: '1Gi' }
      }]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}
output mcpUrl string = 'https://${app.properties.configuration.ingress.fqdn}/mcp'
