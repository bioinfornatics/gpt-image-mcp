import { ConfigService } from '@nestjs/config';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { EntraAuthenticationError, EntraTokenValidatorService } from '../../../src/security/entra-token-validator.service';

const tenant = '11111111-1111-1111-1111-111111111111';
const audience = `api://server`;
const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;

async function fixture() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey); jwk.kid = 'test-key'; jwk.use = 'sig'; jwk.alg = 'RS256';
  const config = { get: (key: string) => key === 'entra' ? { tenantId: tenant, audience, requiredScope: 'mcp.access', allowedClientIds: ['client-a'] } : undefined } as unknown as ConfigService;
  const service = new EntraTokenValidatorService(config, createLocalJWKSet({ keys: [jwk] }));
  const sign = (claims: Record<string, unknown> = {}, options: { audience?: string; issuer?: string; expiresIn?: string } = {}) => new SignJWT({ ver: '2.0', tid: tenant, oid: 'user-id', scp: 'mcp.access', azp: 'client-a', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(options.issuer ?? issuer).setAudience(options.audience ?? audience)
    .setSubject('subject').setIssuedAt().setExpirationTime(options.expiresIn ?? '5m').sign(privateKey);
  return { service, sign, privateKey };
}

describe('EntraTokenValidatorService', () => {
  it('accepts a signed delegated user token', async () => {
    const { service, sign } = await fixture();
    const result = await service.validate(await sign());
    expect(result.identity).toEqual(expect.objectContaining({ tenantId: tenant, subject: 'subject', clientId: 'client-a', scopes: ['mcp.access'] }));
  });
  it('rejects a bad signature, issuer, audience, and expiry', async () => {
    const { service, sign } = await fixture();
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({ ver: '2.0', tid: tenant, scp: 'mcp.access', azp: 'client-a' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setAudience(audience).setSubject('s').setIssuedAt().setExpirationTime('5m').sign(other.privateKey);
    for (const token of [forged, await sign({}, { issuer: 'https://issuer.invalid' }), await sign({}, { audience: 'wrong' }), await sign({}, { expiresIn: '-1m' })]) {
      await expect(service.validate(token)).rejects.toBeInstanceOf(EntraAuthenticationError);
    }
  });
  it('rejects wrong tenant, app-only/missing scope, insufficient scope, and disallowed client', async () => {
    const { service, sign } = await fixture();
    for (const claims of [{ tid: 'other' }, { scp: undefined }, { scp: 'other.scope' }, { azp: 'client-b' }]) {
      await expect(service.validate(await sign(claims))).rejects.toBeInstanceOf(EntraAuthenticationError);
    }
  });
});
