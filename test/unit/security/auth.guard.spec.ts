import { ExecutionContext } from '@nestjs/common';
import { BearerAuthException } from '../../../src/security/auth.exceptions';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '../../../src/security/auth.guard';
import { ENTRA_AUTH, EntraAuthenticationError } from '../../../src/security/entra-token-validator.service';

function request(headers: Record<string, string>) { return { headers }; }
function makeContext(req: ReturnType<typeof request>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}
function makeGuard(authMode: 'none' | 'static_bearer' | 'entra', apiKey?: string, validate?: (token: string) => Promise<unknown>) {
  const config = { get: (key: string) => key === 'mcp' ? { authMode, apiKey } : undefined } as unknown as ConfigService;
  return new AuthGuard(config, validate ? { validate } as never : undefined);
}

describe('AuthGuard', () => {
  it('allows none mode', async () => expect(await makeGuard('none').canActivate(makeContext(request({})))).toBe(true));
  it('allows the correct static bearer', async () => expect(await makeGuard('static_bearer', 'my-secret').canActivate(makeContext(request({ authorization: 'Bearer my-secret' })))).toBe(true));
  it('rejects missing bearer', async () => expect(makeGuard('static_bearer', 'my-secret').canActivate(makeContext(request({})))).rejects.toBeInstanceOf(BearerAuthException));
  it('rejects wrong and differently sized static tokens', async () => {
    await expect(makeGuard('static_bearer', 'my-secret').canActivate(makeContext(request({ authorization: 'Bearer xx-secret' })))).rejects.toBeInstanceOf(BearerAuthException);
    await expect(makeGuard('static_bearer', 'my-secret').canActivate(makeContext(request({ authorization: 'Bearer my-secret-extra' })))).rejects.toBeInstanceOf(BearerAuthException);
  });
  it('validates Entra and attaches non-enumerable auth', async () => {
    const auth = { identity: { tenantId: 't', subject: 's', clientId: 'c', scopes: ['mcp.access'] }, assertion: 'jwt' };
    const req = request({ authorization: 'Bearer jwt' });
    expect(await makeGuard('entra', undefined, async () => auth).canActivate(makeContext(req))).toBe(true);
    expect((req as typeof req & { [ENTRA_AUTH]?: unknown })[ENTRA_AUTH]).toEqual(auth);
    expect(Object.keys(req)).not.toContain(String(ENTRA_AUTH));
  });
  it('maps Entra authorization failures to forbidden', async () => {
    const guard = makeGuard('entra', undefined, async () => { throw new EntraAuthenticationError('scope', 403, 'insufficient_scope'); });
    await expect(guard.canActivate(makeContext(request({ authorization: 'Bearer jwt' })))).rejects.toBeInstanceOf(BearerAuthException);
  });
  it('maps invalid Entra tokens to unauthorized', async () => {
    const guard = makeGuard('entra', undefined, async () => { throw new EntraAuthenticationError('bad', 401); });
    await expect(guard.canActivate(makeContext(request({ authorization: 'Bearer jwt' })))).rejects.toBeInstanceOf(BearerAuthException);
  });
});
