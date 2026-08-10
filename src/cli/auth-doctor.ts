#!/usr/bin/env node
import 'reflect-metadata';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AzureCliCredential, getBearerTokenProvider } from '@azure/identity';
import { resolveSecrets } from '../config/secret-loader';
import { configValidationSchema } from '../config/app.config';
import { AZURE_OPENAI_SCOPE } from '../providers/azure-openai-client.factory';

const exec = promisify(execFile);
type Result = { label: string; status: 'ok' | 'error' | 'skip'; detail: string };
const results: Result[] = [];
const add = (label: string, status: Result['status'], detail: string) => results.push({ label, status, detail });

async function main(): Promise<number> {
  await resolveSecrets();
  const { error, value } = configValidationSchema.validate(process.env, { allowUnknown: true, abortEarly: false });
  const provider = process.env['IMAGE_PROVIDER'] ?? '(unset)';
  const mode = process.env['IMAGE_AZURE_AUTH_MODE'] ?? (provider === 'azure' && process.env['IMAGE_API_KEY'] ? 'api_key (inferred)' : '(unset)');
  add('Provider', provider === '(unset)' ? 'error' : 'ok', provider);
  add('Authentication mode', mode === '(unset)' ? 'error' : 'ok', mode);
  add('Configuration', error ? 'error' : 'ok', error ? error.details.map((d) => d.message).join('; ') : 'valid');
  if (error) return print(2);
  if (provider !== 'azure') { add('Azure checks', 'skip', 'not an Azure provider'); return print(0); }
  add('Azure endpoint', value.IMAGE_BASE_URL ? 'ok' : 'error', value.IMAGE_BASE_URL ? 'configured' : 'missing');
  add('Deployment', value.IMAGE_DEPLOYMENT ? 'ok' : 'error', value.IMAGE_DEPLOYMENT ? 'configured' : 'missing');
  if (value.IMAGE_AZURE_AUTH_MODE === 'api_key') {
    add('API key', value.IMAGE_API_KEY ? 'ok' : 'error', value.IMAGE_API_KEY ? 'configured (value hidden)' : 'missing');
    return print(value.IMAGE_API_KEY ? 0 : 2);
  }
  if (value.IMAGE_AZURE_AUTH_MODE === 'on_behalf_of') {
    add('Entra OBO', 'ok', 'static configuration is complete; runtime requires a delegated user token');
    return print(0);
  }
  try {
    const { stdout } = await exec('az', ['account', 'show', '--output', 'json'], { timeout: 10_000 });
    const account = JSON.parse(stdout) as { tenantId?: string; name?: string };
    add('Azure CLI', 'ok', 'installed and signed in');
    add('Tenant', 'ok', process.env['IMAGE_AZURE_TENANT_ID'] ?? account.tenantId ?? 'active CLI tenant');
    const tokenProvider = getBearerTokenProvider(new AzureCliCredential(process.env['IMAGE_AZURE_TENANT_ID'] ? { tenantId: process.env['IMAGE_AZURE_TENANT_ID'] } : undefined), AZURE_OPENAI_SCOPE);
    await tokenProvider();
    add('Token acquisition', 'ok', 'Cognitive Services token acquired (value hidden)');
    return print(0);
  } catch {
    add('Azure CLI', 'error', 'install Azure CLI and run `az login`, then `az account show`');
    return print(3);
  }
}

function print(exitCode: number): number {
  for (const item of results) console.log(`${item.status === 'ok' ? '✓' : item.status === 'skip' ? '-' : '✗'} ${item.label}: ${item.detail}`);
  return exitCode;
}

void access(process.cwd(), constants.F_OK).then(main).then((code) => { process.exitCode = code; }).catch(() => { process.exitCode = 4; });
