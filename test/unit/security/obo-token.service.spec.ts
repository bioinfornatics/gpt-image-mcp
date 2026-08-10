import { ConfigService } from '@nestjs/config';
import { RequestIdentityContextService } from '../../../src/security/request-identity-context.service';
import { OboTokenService } from '../../../src/security/obo-token.service';

const config = { get: (key: string) => key === 'entra' ? { tenantId: 'tenant', clientId: 'client', clientSecret: 'secret' } : undefined } as unknown as ConfigService;
const identity = (subject: string) => ({ tenantId: 'tenant', subject, clientId: 'mcp-client', scopes: ['mcp.access'], correlationId: subject });

describe('OboTokenService', () => {
  it('exchanges the current assertion for the cognitive services scope', async () => {
    const context = new RequestIdentityContextService();
    const service = new OboTokenService(config, context);
    const acquire = jest.fn(async () => ({ accessToken: 'downstream-token' }));
    (service as unknown as { client: { acquireTokenOnBehalfOf: typeof acquire } }).client = { acquireTokenOnBehalfOf: acquire };
    const token = await context.run(identity('alice'), 'incoming-token', () => service.acquireAzureOpenAIToken());
    expect(token).toBe('downstream-token');
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({ oboAssertion: 'incoming-token', scopes: ['https://cognitiveservices.azure.com/.default'] }));
  });

  it('deduplicates concurrent exchange for one user but isolates users', async () => {
    const context = new RequestIdentityContextService();
    const service = new OboTokenService(config, context);
    let calls = 0;
    const acquire = jest.fn(async (request: { oboAssertion: string }) => { calls++; await new Promise((r) => setTimeout(r, 5)); return { accessToken: `${request.oboAssertion}-out` }; });
    (service as unknown as { client: { acquireTokenOnBehalfOf: typeof acquire } }).client = { acquireTokenOnBehalfOf: acquire };
    const alice = context.run(identity('alice'), 'alice-in', () => Promise.all([service.acquireAzureOpenAIToken(), service.acquireAzureOpenAIToken()]));
    const bob = context.run(identity('bob'), 'bob-in', () => service.acquireAzureOpenAIToken());
    expect(await alice).toEqual(['alice-in-out', 'alice-in-out']);
    expect(await bob).toBe('bob-in-out');
    expect(calls).toBe(2);
  });
});
