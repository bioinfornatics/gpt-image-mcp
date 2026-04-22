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
