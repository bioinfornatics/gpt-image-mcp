import { HttpException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimitGuard } from '../../../src/security/rate-limit.guard';

function makeContext(ip = '127.0.0.1'): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(limit = 3) {
  const configService = {
    get: (key: string) => {
      if (key === 'security') return { maxRequestsPerMinute: limit };
      return undefined;
    },
  } as unknown as ConfigService;
  return new RateLimitGuard(configService);
}

describe('RateLimitGuard', () => {
  it('should allow requests within limit', () => {
    const guard = makeGuard(3);
    const ctx = makeContext('10.0.0.1');
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw HttpException on the (limit+1)th request', () => {
    const guard = makeGuard(3);
    const ctx = makeContext('10.0.0.2');
    guard.canActivate(ctx); // 1
    guard.canActivate(ctx); // 2
    guard.canActivate(ctx); // 3
    expect(() => guard.canActivate(ctx)).toThrow(HttpException); // 4th → rejected
  });

  it('should track limits independently per IP', () => {
    const guard = makeGuard(2);
    const ctx1 = makeContext('10.0.1.1');
    const ctx2 = makeContext('10.0.1.2');
    guard.canActivate(ctx1); // IP1: 1
    guard.canActivate(ctx1); // IP1: 2
    // IP2 should still be allowed
    expect(guard.canActivate(ctx2)).toBe(true);
    // IP1 should now be blocked
    expect(() => guard.canActivate(ctx1)).toThrow(HttpException);
  });

  it('should include rate limit message in error', () => {
    const guard = makeGuard(1);
    const ctx = makeContext('10.0.2.1');
    guard.canActivate(ctx); // first passes
    try {
      guard.canActivate(ctx);
      fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      const response = (e as HttpException).getResponse() as any;
      expect(response.error.message).toMatch(/rate limit/i);
    }
  });
});
