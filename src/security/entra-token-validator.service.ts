import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { AppConfig } from '../config/app.config';
import type { RequestIdentity } from './request-identity-context.service';

export class EntraAuthenticationError extends Error {
  constructor(message: string, readonly status: 401 | 403, readonly code: 'invalid_token' | 'insufficient_scope' = 'invalid_token') { super(message); }
}
interface EntraClaims extends JWTPayload { ver?: string; tid?: string; oid?: string; scp?: string; azp?: string; appid?: string; }
export interface ValidatedEntraAuth { readonly identity: Omit<RequestIdentity, 'correlationId'>; readonly assertion: string; }
export const ENTRA_AUTH = Symbol('image-mcp.entra-auth');

@Injectable()
export class EntraTokenValidatorService {
  private readonly entra: AppConfig['entra'];
  private readonly issuer?: string;
  private readonly jwks?: JWTVerifyGetKey;

  constructor(config: ConfigService, @Optional() jwksOverride?: JWTVerifyGetKey) {
    this.entra = config.get<AppConfig['entra']>('entra') ?? { requiredScope: 'mcp.access', allowedClientIds: [] };
    if (this.entra.tenantId) {
      const authority = `https://login.microsoftonline.com/${encodeURIComponent(this.entra.tenantId)}`;
      this.issuer = `${authority}/v2.0`;
      this.jwks = jwksOverride ?? createRemoteJWKSet(new URL(`${authority}/discovery/v2.0/keys`), { timeoutDuration: 5_000, cooldownDuration: 30_000, cacheMaxAge: 600_000 });
    }
  }

  async validate(assertion: string): Promise<ValidatedEntraAuth> {
    if (!this.entra.tenantId || !this.entra.audience || !this.issuer || !this.jwks) throw new EntraAuthenticationError('Microsoft Entra authentication is not configured.', 401);
    try {
      const { payload } = await jwtVerify<EntraClaims>(assertion, this.jwks, {
        issuer: this.issuer, audience: this.entra.audience, algorithms: ['RS256'], clockTolerance: 60,
        requiredClaims: ['exp', 'iat', 'iss', 'aud', 'sub', 'tid'],
      });
      if (payload.ver !== '2.0' || payload.tid !== this.entra.tenantId) throw new EntraAuthenticationError('Bearer token tenant or version is invalid.', 401);
      if (!payload.scp) throw new EntraAuthenticationError('A delegated user token is required.', 403, 'insufficient_scope');
      const scopes = payload.scp.split(/\s+/).filter(Boolean);
      if (!scopes.includes(this.entra.requiredScope)) throw new EntraAuthenticationError('The required MCP delegated scope is missing.', 403, 'insufficient_scope');
      const clientId = payload.azp ?? payload.appid;
      if (!clientId) throw new EntraAuthenticationError('Calling client identity is missing.', 401);
      if (this.entra.allowedClientIds.length && !this.entra.allowedClientIds.includes(clientId)) throw new EntraAuthenticationError('Calling client is not authorized.', 403);
      return Object.freeze({ identity: Object.freeze({ tenantId: payload.tid, subject: payload.sub!, objectId: payload.oid, clientId, scopes: Object.freeze(scopes) }), assertion });
    } catch (error) {
      if (error instanceof EntraAuthenticationError) throw error;
      throw new EntraAuthenticationError('Bearer token is invalid or expired.', 401);
    }
  }
}
