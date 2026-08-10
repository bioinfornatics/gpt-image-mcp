import { Module, Global } from '@nestjs/common';
import { EntraTokenValidatorService } from './entra-token-validator.service';
import { RequestIdentityContextService } from './request-identity-context.service';
import { OboTokenService } from './obo-token.service';
import { BearerAuthFilter } from './bearer-auth.filter';
import { OBO_TOKEN_PROVIDER } from '../providers/azure-obo-token.interface';
import { AuthAuditService } from './auth-audit.service';

@Global()
@Module({
  providers: [
    EntraTokenValidatorService, RequestIdentityContextService, OboTokenService, BearerAuthFilter, AuthAuditService,
    { provide: OBO_TOKEN_PROVIDER, useExisting: OboTokenService },
  ],
  exports: [EntraTokenValidatorService, RequestIdentityContextService, OboTokenService, OBO_TOKEN_PROVIDER, AuthAuditService],
})
export class SecurityModule {}
