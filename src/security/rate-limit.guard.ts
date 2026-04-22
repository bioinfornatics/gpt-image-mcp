import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { AppConfig } from '../config/app.config';

// NOTE: In production behind a load balancer, ensure Express trust proxy is
// configured (app.set('trust proxy', 1) in main.ts) so request.ip reflects
// the real client IP from X-Forwarded-For, not the proxy's IP.

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly store = new Map<string, RateLimitEntry>();
  private readonly windowMs = 60_000; // 1 minute

  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const securityConfig = this.configService.get<AppConfig['security']>('security')!;
    const limit = securityConfig.maxRequestsPerMinute;

    const request = context.switchToHttp().getRequest<Request>();
    const clientKey = request.ip ?? 'unknown';
    const now = Date.now();

    // Evict expired entries to prevent unbounded memory growth
    for (const [key, entry] of this.store.entries()) {
      if (now - entry.windowStart > this.windowMs) {
        this.store.delete(key);
      }
    }

    const entry = this.store.get(clientKey);

    if (!entry || now - entry.windowStart > this.windowMs) {
      // New window
      this.store.set(clientKey, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= limit) {
      throw new HttpException(
        {
          jsonrpc: '2.0',
          error: {
            code: -32029,
            message: `Rate limit exceeded: ${limit} requests per minute. Please wait before retrying.`,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    entry.count++;
    return true;
  }
}
