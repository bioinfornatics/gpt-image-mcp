import { RequestIdentityContextService } from '../../../src/security/request-identity-context.service';

const identity = (subject: string) => ({ tenantId: 'tenant', subject, clientId: 'client', scopes: ['mcp.access'], correlationId: subject });

describe('RequestIdentityContextService', () => {
  it('is empty outside a request and visible through awaits', async () => {
    const service = new RequestIdentityContextService();
    expect(service.identity()).toBeUndefined();
    await service.run(identity('alice'), 'alice-token', async () => {
      await Promise.resolve();
      expect(service.requireIdentity().subject).toBe('alice');
      expect(service.requireAssertion()).toBe('alice-token');
    });
    expect(service.identity()).toBeUndefined();
  });

  it('isolates concurrent users', async () => {
    const service = new RequestIdentityContextService();
    const subjects = await Promise.all(['alice', 'bob'].map((name) => service.run(identity(name), `${name}-token`, async () => {
      await new Promise((resolve) => setTimeout(resolve, name === 'alice' ? 10 : 1));
      return [service.requireIdentity().subject, service.requireAssertion()];
    })));
    expect(subjects).toEqual([['alice', 'alice-token'], ['bob', 'bob-token']]);
  });
});
