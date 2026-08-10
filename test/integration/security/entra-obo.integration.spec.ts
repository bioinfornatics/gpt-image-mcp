import { ConfigService } from '@nestjs/config';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { EntraTokenValidatorService } from '../../../src/security/entra-token-validator.service';
import { RequestIdentityContextService } from '../../../src/security/request-identity-context.service';
import { OboTokenService } from '../../../src/security/obo-token.service';
import { AzureOpenAIClientFactory, DefaultAzureCredentialProviderFactory } from '../../../src/providers/azure-openai-client.factory';
import { RequestAwareAzureProvider } from '../../../src/providers/request-aware-azure.provider';

const tenant = '11111111-1111-1111-1111-111111111111';
const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
const audience = 'api://server';
const providerConfig = {
  name: 'azure' as const, baseUrl: 'https://example.openai.azure.com', deployment: 'image-deployment', apiVersion: '2025-04-01-preview', models: [], azureAuthMode: 'on_behalf_of' as const,
};

describe('Entra → request identity → OBO → Azure provider integration', () => {
  it('keeps concurrent Alice and Bob assertions isolated through the provider token callback', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey); jwk.kid = 'key'; jwk.alg = 'RS256'; jwk.use = 'sig';
    const values = {
      entra: { tenantId: tenant, clientId: 'server', audience, requiredScope: 'mcp.access', allowedClientIds: ['client'], clientSecret: 'secret' },
      imageProvider: providerConfig,
    };
    const config = { get: (key: string) => values[key as keyof typeof values] } as unknown as ConfigService;
    const validator = new EntraTokenValidatorService(config, createLocalJWKSet({ keys: [jwk] }));
    const context = new RequestIdentityContextService();
    const obo = new OboTokenService(config, context);
    const exchanges: string[] = [];
    (obo as unknown as { client: { acquireTokenOnBehalfOf: (r: { oboAssertion: string }) => Promise<{ accessToken: string }> } }).client = {
      acquireTokenOnBehalfOf: async ({ oboAssertion }) => { exchanges.push(oboAssertion); await new Promise((r) => setTimeout(r, 2)); return { accessToken: `downstream:${oboAssertion}` }; },
    };
    const clients = new AzureOpenAIClientFactory(new DefaultAzureCredentialProviderFactory(), obo, config);
    const provider = new RequestAwareAzureProvider(clients, 'image-deployment', 'on_behalf_of');
    const sign = (subject: string) => new SignJWT({ ver: '2.0', tid: tenant, oid: subject, scp: 'mcp.access', azp: 'client' }).setProtectedHeader({ alg: 'RS256', kid: 'key' }).setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(privateKey);

    const invoke = async (subject: string) => {
      const auth = await validator.validate(await sign(subject));
      return context.run({ ...auth.identity, correlationId: subject }, auth.assertion, async () => {
        const client = (provider as unknown as { clients: AzureOpenAIClientFactory }).clients.createCurrent() as unknown as { _azureADTokenProvider: () => Promise<string> };
        return client._azureADTokenProvider();
      });
    };

    const [alice, bob] = await Promise.all([invoke('alice'), invoke('bob')]);
    expect(alice).toMatch(/^downstream:/);
    expect(bob).toMatch(/^downstream:/);
    expect(alice).not.toBe(bob);
    expect(exchanges).toHaveLength(2);
    expect(context.identity()).toBeUndefined();
  });
});
