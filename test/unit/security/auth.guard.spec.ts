import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '../../../src/security/auth.guard';

function makeContext(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(apiKey?: string) {
  const configService = {
    get: (key: string) => {
      if (key === 'mcp') return { apiKey };
      return undefined;
    },
  } as unknown as ConfigService;
  return new AuthGuard(configService);
}

describe('AuthGuard', () => {
  it('should allow all requests when MCP_API_KEY is not configured', () => {
    const guard = makeGuard(undefined);
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });

  it('should allow request with correct Bearer token', () => {
    const guard = makeGuard('my-secret');
    const ctx = makeContext({ authorization: 'Bearer my-secret' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw UnauthorizedException when Authorization header is missing', () => {
    const guard = makeGuard('my-secret');
    expect(() => guard.canActivate(makeContext({}))).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when token is wrong', () => {
    const guard = makeGuard('my-secret');
    const ctx = makeContext({ authorization: 'Bearer wrong-token' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when format is not Bearer', () => {
    const guard = makeGuard('my-secret');
    const ctx = makeContext({ authorization: 'Basic my-secret' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should reject a token that is a prefix of the correct token (different lengths)', () => {
    const guard = makeGuard('my-secret-long');
    const ctx = makeContext({ authorization: 'Bearer my-secret' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should reject a token that has the correct token as a prefix (different lengths)', () => {
    const guard = makeGuard('my-secret');
    const ctx = makeContext({ authorization: 'Bearer my-secret-extra' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should use constant-time comparison (timingSafeEqual) — same-length wrong token rejected', () => {
    // Same length as 'my-secret' (9 chars), different value
    const guard = makeGuard('my-secret');
    const ctx = makeContext({ authorization: 'Bearer xx-secret' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
