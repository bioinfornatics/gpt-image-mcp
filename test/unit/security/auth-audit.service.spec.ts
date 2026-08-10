import { AuthAuditService, authenticationCounter } from '../../../src/security/auth-audit.service';

describe('AuthAuditService', () => {
  it('records hashed identity metadata without raw subject or credentials', async () => {
    const service = new AuthAuditService();
    const logger = (service as unknown as { logger: { log: jest.Mock } }).logger;
    logger.log = jest.fn();
    service.record('entra', 'success', 'validated', { tenantId: 'tenant', subject: 'raw-user-secret', clientId: 'client', scopes: ['mcp.access'] });
    const output = String(logger.log.mock.calls[0][0]);
    expect(output).toContain('subjectHash');
    expect(output).not.toContain('raw-user-secret');
    expect(await authenticationCounter.get()).toBeDefined();
  });
});
