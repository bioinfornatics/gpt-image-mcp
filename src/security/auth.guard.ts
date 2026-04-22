import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import type { AppConfig } from '../config/app.config';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const mcpConfig = this.configService.get<AppConfig['mcp']>('mcp')!;

    // If no MCP_API_KEY configured, allow all requests
    if (!mcpConfig.apiKey) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing Authorization header. Use: Authorization: Bearer <MCP_API_KEY>',
      );
    }

    const token = authHeader.slice('Bearer '.length);

    // Use constant-time comparison to prevent timing-based brute-force attacks
    const providedBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(mcpConfig.apiKey);
    const isValid =
      providedBuf.length === expectedBuf.length &&
      timingSafeEqual(providedBuf, expectedBuf);

    if (!isValid) {
      throw new UnauthorizedException('Invalid API key.');
    }

    return true;
  }
}
