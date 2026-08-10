import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestIdentity {
  readonly tenantId: string;
  readonly subject: string;
  readonly objectId?: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly correlationId: string;
}

interface ExecutionIdentityContext {
  readonly identity: RequestIdentity;
  readonly assertion: string;
}

@Injectable()
export class RequestIdentityContextService {
  private readonly storage = new AsyncLocalStorage<ExecutionIdentityContext>();

  run<T>(identity: RequestIdentity, assertion: string, callback: () => T): T {
    const frozenIdentity = Object.freeze({ ...identity, scopes: Object.freeze([...identity.scopes]) });
    return this.storage.run(Object.freeze({ identity: frozenIdentity, assertion }), callback);
  }

  identity(): RequestIdentity | undefined {
    return this.storage.getStore()?.identity;
  }

  requireIdentity(): RequestIdentity {
    const identity = this.identity();
    if (!identity) throw new Error('Authenticated request identity is unavailable.');
    return identity;
  }

  requireAssertion(): string {
    const assertion = this.storage.getStore()?.assertion;
    if (!assertion) throw new Error('Inbound user assertion is unavailable.');
    return assertion;
  }
}
