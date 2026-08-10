import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/app.config';
import { ENTRA_AUTH, EntraAuthenticationError, EntraTokenValidatorService } from './entra-token-validator.service';
import { BearerAuthException } from './auth.exceptions';
import { AuthAuditService } from './auth-audit.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly entraValidator?: EntraTokenValidatorService,
    private readonly audit?: AuthAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const mcp = this.config.get<AppConfig['mcp']>('mcp')!;
    if (mcp.authMode === 'none') return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw new BearerAuthException(401, 'Missing Authorization bearer token.');
    const token = header.slice(7);
    if (mcp.authMode === 'entra') {
      if (!this.entraValidator) throw new BearerAuthException(401, 'Microsoft Entra validation is unavailable.', 'invalid_token');
      try {
        const auth = await this.entraValidator.validate(token);
        Object.defineProperty(request, ENTRA_AUTH, { value: auth, enumerable: false, configurable: true });
        this.audit?.record('entra', 'success', 'validated', auth.identity);
        return true;
      } catch (error) {
        if (error instanceof EntraAuthenticationError) {
          const scope = error.code === 'insufficient_scope' ? this.config.get<AppConfig['entra']>('entra')?.requiredScope : undefined;
          this.audit?.record('entra', 'failure', error.code);
          throw new BearerAuthException(error.status, error.status === 401 ? 'Bearer token is invalid or expired.' : error.message, error.code, scope);
        }
        throw new BearerAuthException(401, 'Bearer token is invalid or expired.', 'invalid_token');
      }
    }
    if (!mcp.apiKey) throw new BearerAuthException(401, 'Static bearer authentication is not configured.');
    const provided = Buffer.from(token); const expected = Buffer.from(mcp.apiKey);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      this.audit?.record('static_bearer', 'failure', 'invalid_token');
      throw new BearerAuthException(401, 'Invalid API key.', 'invalid_token');
    }
    this.audit?.record('static_bearer', 'success', 'validated');
    return true;
  }
}
