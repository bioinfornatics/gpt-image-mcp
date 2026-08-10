import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfidentialClientApplication, InteractionRequiredAuthError } from '@azure/msal-node';
import { createHash } from 'node:crypto';
import type { AppConfig } from '../config/app.config';
import { AZURE_OPENAI_SCOPE } from '../providers/azure-openai-client.factory';
import { RequestIdentityContextService } from './request-identity-context.service';

export class OboTokenError extends Error {
  constructor(message: string, readonly kind: 'interaction_required' | 'configuration' | 'unavailable') { super(message); }
}

@Injectable()
export class OboTokenService {
  private readonly config: AppConfig['entra'];
  private client?: ConfidentialClientApplication;
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(config: ConfigService, private readonly context: RequestIdentityContextService) {
    this.config = config.get<AppConfig['entra']>('entra') ?? { requiredScope: 'mcp.access', allowedClientIds: [] };
  }

  acquireAzureOpenAIToken(): Promise<string> {
    const identity = this.context.requireIdentity();
    const assertion = this.context.requireAssertion();
    const key = createHash('sha256').update([identity.tenantId, identity.subject, identity.clientId, AZURE_OPENAI_SCOPE, assertion].join('\0')).digest('base64url');
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const pending = this.exchange(assertion, identity.correlationId).finally(() => { if (this.inFlight.get(key) === pending) this.inFlight.delete(key); });
    this.inFlight.set(key, pending);
    return pending;
  }

  private getClient(): ConfidentialClientApplication {
    if (!this.config.tenantId || !this.config.clientId || !this.config.clientSecret) throw new OboTokenError('OBO requires tenant ID, client ID, and a confidential client credential.', 'configuration');
    return this.client ??= new ConfidentialClientApplication({
      auth: { clientId: this.config.clientId, authority: `https://login.microsoftonline.com/${this.config.tenantId}`, clientSecret: this.config.clientSecret },
      system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => undefined } },
    });
  }

  private async exchange(assertion: string, correlationId: string): Promise<string> {
    try {
      const result = await this.getClient().acquireTokenOnBehalfOf({ oboAssertion: assertion, scopes: [AZURE_OPENAI_SCOPE], correlationId });
      if (!result?.accessToken) throw new OboTokenError('Microsoft Entra returned no downstream access token.', 'unavailable');
      return result.accessToken;
    } catch (error) {
      if (error instanceof OboTokenError) throw error;
      if (error instanceof InteractionRequiredAuthError) throw new OboTokenError('Additional Microsoft Entra consent or interaction is required.', 'interaction_required');
      throw new OboTokenError('Microsoft Entra OBO token exchange failed.', 'unavailable');
    }
  }
}
