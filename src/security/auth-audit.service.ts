import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Counter } from 'prom-client';
import type { RequestIdentity } from './request-identity-context.service';

export const authenticationCounter = new Counter({
  name: 'image_mcp_authentication_events_total',
  help: 'Authentication outcomes without credentials or PII',
  labelNames: ['mode', 'outcome', 'reason'],
});

@Injectable()
export class AuthAuditService {
  private readonly logger = new Logger(AuthAuditService.name);

  record(mode: string, outcome: 'success' | 'failure', reason: string, identity?: Omit<RequestIdentity, 'correlationId'>): void {
    authenticationCounter.inc({ mode, outcome, reason });
    const subjectHash = identity ? createHash('sha256').update(`${identity.tenantId}\0${identity.subject}`).digest('hex').slice(0, 16) : undefined;
    this.logger.log(JSON.stringify({ event: 'mcp.authentication', mode, outcome, reason, tenantId: identity?.tenantId, clientId: identity?.clientId, subjectHash }));
  }
}
