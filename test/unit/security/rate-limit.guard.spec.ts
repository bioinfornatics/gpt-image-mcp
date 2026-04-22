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

  it('should evict expired entries on next request', () => {
    const guard = makeGuard(2);
    const store = (guard as any).store as Map<string, { count: number; windowStart: number }>;
    const ctx = makeContext('10.0.3.1');

    // Fill up the limit
    guard.canActivate(ctx); // 1
    guard.canActivate(ctx); // 2
    expect(() => guard.canActivate(ctx)).toThrow(HttpException); // 3rd → blocked

    // Manually expire the entry by backdating windowStart
    const entry = store.get('10.0.3.1')!;
    entry.windowStart = Date.now() - 61_000; // 61s ago — expired

    // A new request from a different IP should trigger eviction of the expired entry
    const ctx2 = makeContext('10.0.3.2');
    guard.canActivate(ctx2); // triggers eviction loop

    // Expired entry should have been deleted
    expect(store.has('10.0.3.1')).toBe(false);
  });

  it('should reset count after window expires (new request from same IP)', () => {
    const guard = makeGuard(2);
    const store = (guard as any).store as Map<string, { count: number; windowStart: number }>;
    const ctx = makeContext('10.0.4.1');

    // Fill up the limit
    guard.canActivate(ctx); // 1
    guard.canActivate(ctx); // 2
    expect(() => guard.canActivate(ctx)).toThrow(HttpException); // blocked

    // Expire the entry
    const entry = store.get('10.0.4.1')!;
    entry.windowStart = Date.now() - 61_000;

    // Same IP — new window opens
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
