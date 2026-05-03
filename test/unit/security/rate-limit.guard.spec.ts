import { HttpException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimitGuard } from '../../../src/security/rate-limit.guard';

function makeContext(ip = '127.0.0.1', headers: Record<string, string> = {}, body?: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip, headers, body }),
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

  // ---------------------------------------------------------------------------
  // Byte-aware rate limiting
  // ---------------------------------------------------------------------------
  describe('byte-aware rate limiting', () => {
    const FIFTY_MB = 50 * 1024 * 1024;

    it('should allow request within byte budget', () => {
      const guard = makeGuard(100);
      // 1 KB payload — well within 50 MB
      const ctx = makeContext('10.1.0.1', { 'content-length': '1024' });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should reject request that would exceed byte budget (via Content-Length header)', () => {
      const guard = makeGuard(100);
      // Override maxBytesPerWindow to a tiny value so we can test without sending 50 MB
      (guard as any).maxBytesPerWindow = 1000;

      const ctx1 = makeContext('10.1.1.1', { 'content-length': '600' });
      expect(guard.canActivate(ctx1)).toBe(true); // 600 bytes — OK

      // Second request would push to 1200 > 1000 — should be rejected
      const ctx2 = makeContext('10.1.1.1', { 'content-length': '600' });
      expect(() => guard.canActivate(ctx2)).toThrow(HttpException);

      // Confirm error message mentions data rate limit
      try {
        const ctx3 = makeContext('10.1.1.1', { 'content-length': '600' });
        guard.canActivate(ctx3);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        const response = (e as HttpException).getResponse() as any;
        expect(response.error.message).toMatch(/data rate limit/i);
      }
    });

    it('should reject request that would exceed byte budget (via body size estimation)', () => {
      const guard = makeGuard(100);
      (guard as any).maxBytesPerWindow = 200;

      // No content-length header — guard falls back to body size estimation
      const smallBody = { prompt: 'hello' }; // ~16 bytes as JSON
      const ctx1 = makeContext('10.1.2.1', {}, smallBody);
      expect(guard.canActivate(ctx1)).toBe(true);

      // Large body that would push over 200 bytes
      const largeBody = { prompt: 'x'.repeat(300) };
      const ctx2 = makeContext('10.1.2.1', {}, largeBody);
      expect(() => guard.canActivate(ctx2)).toThrow(HttpException);
    });

    it('should count bytes cumulatively across requests in window', () => {
      const guard = makeGuard(100);
      (guard as any).maxBytesPerWindow = 500;

      // Send 3 × 150-byte requests — first two pass (300 bytes), third passes (450 bytes),
      // fourth would exceed 500 bytes
      const ctx = (n: number) => makeContext('10.1.3.1', { 'content-length': String(n) });

      expect(guard.canActivate(ctx(150))).toBe(true); // 150
      expect(guard.canActivate(ctx(150))).toBe(true); // 300
      expect(guard.canActivate(ctx(150))).toBe(true); // 450
      expect(() => guard.canActivate(ctx(150))).toThrow(HttpException); // 600 > 500
    });

    it('should reset byte count when window expires', () => {
      const guard = makeGuard(100);
      (guard as any).maxBytesPerWindow = 500;

      const store = (guard as any).store as Map<string, any>;
      const ip = '10.1.4.1';

      // Use up 450 bytes
      guard.canActivate(makeContext(ip, { 'content-length': '450' }));

      // Expire the window
      store.get(ip)!.windowStart = Date.now() - 61_000;

      // New window — byte counter resets, so a 450-byte request should pass
      expect(guard.canActivate(makeContext(ip, { 'content-length': '450' }))).toBe(true);

      // Verify the new entry has the fresh byte count
      expect(store.get(ip)!.bytesIn).toBe(450);
    });

    it('should still enforce request count limit independently of byte limit', () => {
      const guard = makeGuard(2); // only 2 requests allowed
      (guard as any).maxBytesPerWindow = FIFTY_MB; // very generous byte limit

      const ctx = makeContext('10.1.5.1', { 'content-length': '1' }); // tiny payload
      expect(guard.canActivate(ctx)).toBe(true);  // req 1
      expect(guard.canActivate(ctx)).toBe(true);  // req 2
      // 3rd request should be blocked by count limit, not byte limit
      expect(() => guard.canActivate(ctx)).toThrow(HttpException);

      try {
        guard.canActivate(ctx);
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        const response = (e as HttpException).getResponse() as any;
        expect(response.error.message).toMatch(/rate limit exceeded/i);
        // Should NOT be the data-rate-limit message
        expect(response.error.message).not.toMatch(/data rate limit/i);
      }
    });
  });
});
