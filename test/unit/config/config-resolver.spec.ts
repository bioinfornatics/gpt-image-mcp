import {
  resolveConfig,
  getConfigFieldSpec,
  CONFIG_FIELD_REGISTRY,
  type CliConfigOverride,
} from '../../../src/config/config-resolver';

// ─── Table-driven precedence matrix ──────────────────────────────────────────

interface PrecedenceCase {
  readonly name: string;
  readonly cli: CliConfigOverride;
  readonly env: Record<string, string | undefined>;
  readonly expectedValue: string | undefined;
  readonly expectedSource: 'cli' | 'env' | 'legacy' | 'default';
}

const PRECEDENCE_CASES: readonly PrecedenceCase[] = [
  {
    name: 'CLI beats canonical env, legacy env, and default',
    cli: { provider: 'cli-provider' },
    env: { IMAGE_PROVIDER: 'env-provider', PROVIDER: 'legacy-provider' },
    expectedValue: 'cli-provider',
    expectedSource: 'cli',
  },
  {
    name: 'canonical env beats legacy env and default',
    cli: {},
    env: { IMAGE_PROVIDER: 'env-provider', PROVIDER: 'legacy-provider' },
    expectedValue: 'env-provider',
    expectedSource: 'env',
  },
  {
    name: 'legacy env beats default',
    cli: {},
    env: { PROVIDER: 'legacy-provider' },
    expectedValue: 'legacy-provider',
    expectedSource: 'legacy',
  },
  {
    name: 'default applies when nothing else is set',
    cli: {},
    env: {},
    expectedValue: undefined, // provider has no default
    expectedSource: 'default',
  },
  {
    name: 'CLI beats legacy env when canonical env is absent',
    cli: { provider: 'cli-provider' },
    env: { PROVIDER: 'legacy-provider' },
    expectedValue: 'cli-provider',
    expectedSource: 'cli',
  },
];

describe('resolveConfig() — precedence matrix (provider field)', () => {
  it.each(PRECEDENCE_CASES.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const resolution = resolveConfig(testCase.cli, testCase.env);
    expect(resolution.values['provider']).toBe(testCase.expectedValue);
    expect(resolution.provenance['provider'].source).toBe(testCase.expectedSource);
  });
});

// ─── Canonical-over-legacy across every field with a legacy alias ────────────

describe('resolveConfig() — canonical beats legacy for every aliased field', () => {
  const fieldsWithLegacy = CONFIG_FIELD_REGISTRY.filter((f) => f.legacyEnvs.length > 0);

  it.each(fieldsWithLegacy.map((f) => [f.key, f] as const))(
    'canonical %s wins over its legacy alias(es)',
    (_key, field) => {
      const env: Record<string, string> = { [field.canonicalEnv]: 'canonical-value' };
      for (const legacy of field.legacyEnvs) {
        env[legacy] = 'legacy-value';
      }
      const resolution = resolveConfig({}, env);
      expect(resolution.values[field.key]).toBe('canonical-value');
      expect(resolution.provenance[field.key].source).toBe('env');
      expect(resolution.provenance[field.key].legacyEnvUsed).toBeUndefined();
    },
  );

  it.each(fieldsWithLegacy.map((f) => [f.key, f] as const))(
    'legacy %s is used only when canonical is absent',
    (_key, field) => {
      const env: Record<string, string> = { [field.legacyEnvs[0]]: 'legacy-value' };
      const resolution = resolveConfig({}, env);
      expect(resolution.values[field.key]).toBe('legacy-value');
      expect(resolution.provenance[field.key].source).toBe('legacy');
      expect(resolution.provenance[field.key].legacyEnvUsed).toBe(field.legacyEnvs[0]);
    },
  );
});

// ─── Defaults ────────────────────────────────────────────────────────────────

describe('resolveConfig() — defaults', () => {
  const fieldsWithDefault = CONFIG_FIELD_REGISTRY.filter((f) => f.defaultValue !== undefined);

  it.each(fieldsWithDefault.map((f) => [f.key, f] as const))(
    'applies the built-in default for %s when unset everywhere',
    (_key, field) => {
      const resolution = resolveConfig({}, {});
      expect(resolution.values[field.key]).toBe(field.defaultValue);
      expect(resolution.provenance[field.key].source).toBe('default');
    },
  );
});

// ─── Azure deployment: single canonical field + internal registry entry ─────

describe('resolveConfig() — Azure deployment field', () => {
  it('exposes exactly one deployment field in the registry (IMAGE_DEPLOYMENT)', () => {
    const deploymentFields = CONFIG_FIELD_REGISTRY.filter((f) => f.key === 'deployment');
    expect(deploymentFields).toHaveLength(1);
    expect(deploymentFields[0].canonicalEnv).toBe('IMAGE_DEPLOYMENT');
    expect(deploymentFields[0].legacyEnvs).toEqual(['AZURE_OPENAI_DEPLOYMENT']);
  });

  it('resolves IMAGE_DEPLOYMENT with the standard precedence', () => {
    expect(resolveConfig({}, { IMAGE_DEPLOYMENT: 'canon-deploy', AZURE_OPENAI_DEPLOYMENT: 'legacy-deploy' }).values['deployment'])
      .toBe('canon-deploy');
    expect(resolveConfig({}, { AZURE_OPENAI_DEPLOYMENT: 'legacy-deploy' }).values['deployment']).toBe('legacy-deploy');
    expect(resolveConfig({ deployment: 'cli-deploy' }, { IMAGE_DEPLOYMENT: 'canon-deploy' }).values['deployment'])
      .toBe('cli-deploy');
  });

  it('resolves the Foundry project endpoint with CLI precedence', () => {
    const resolution = resolveConfig(
      { foundryProjectEndpoint: 'https://cli.services.ai.azure.com/api/projects/cli' },
      { IMAGE_FOUNDRY_PROJECT_ENDPOINT: 'https://env.services.ai.azure.com/api/projects/env' },
    );
    expect(resolution.values['foundryProjectEndpoint'])
      .toBe('https://cli.services.ai.azure.com/api/projects/cli');
    expect(resolution.provenance['foundryProjectEndpoint'].source).toBe('cli');
  });

  it('getConfigFieldSpec("deployment") returns the registry entry', () => {
    expect(getConfigFieldSpec('deployment')?.canonicalEnv).toBe('IMAGE_DEPLOYMENT');
    expect(getConfigFieldSpec('does-not-exist')).toBeUndefined();
  });
});

// ─── Safe conflict diagnostics ────────────────────────────────────────────────

describe('resolveConfig() — diagnostics', () => {
  it('emits a diagnostic when canonical env overrides a legacy alias', () => {
    const resolution = resolveConfig({}, { IMAGE_API_KEY: 'sk-canonical-secret-value', OPENAI_API_KEY: 'sk-legacy-secret-value' });
    const diag = resolution.diagnostics.find((d) => d.includes('apiKey'));
    expect(diag).toBeDefined();
    expect(diag).toContain('IMAGE_API_KEY');
    expect(diag).toContain('OPENAI_API_KEY');
    // Values must never leak into diagnostics, secret or not.
    expect(diag).not.toContain('sk-canonical-secret-value');
    expect(diag).not.toContain('sk-legacy-secret-value');
  });

  it('emits a diagnostic when CLI overrides an environment value', () => {
    const resolution = resolveConfig({ provider: 'cli-value' }, { IMAGE_PROVIDER: 'env-value' });
    const diag = resolution.diagnostics.find((d) => d.includes('provider') && d.includes('CLI'));
    expect(diag).toBeDefined();
    expect(diag).not.toContain('cli-value');
    expect(diag).not.toContain('env-value');
  });

  it('emits a diagnostic when two distinct legacy aliases for the same field conflict', () => {
    const resolution = resolveConfig(
      {},
      { OPENAI_API_KEY: 'sk-secret-one-value', AZURE_OPENAI_API_KEY: 'sk-secret-two-value' },
    );
    const diag = resolution.diagnostics.find((d) => d.includes('Conflicting legacy'));
    expect(diag).toBeDefined();
    expect(diag).toContain('OPENAI_API_KEY');
    expect(diag).toContain('AZURE_OPENAI_API_KEY');
    expect(diag).not.toContain('sk-secret-one-value');
    expect(diag).not.toContain('sk-secret-two-value');
  });

  it('produces no diagnostics for a clean, unambiguous configuration', () => {
    const resolution = resolveConfig({}, { IMAGE_PROVIDER: 'openai' });
    expect(resolution.diagnostics).toEqual([]);
  });
});

// ─── No secret values anywhere in provenance/errors ──────────────────────────

describe('resolveConfig() — secret safety', () => {
  const SECRET_KEYS = ['apiKey', 'mcpApiKey', 'entraClientSecret'] as const;
  const SECRET_ENV: Record<string, string> = {
    IMAGE_API_KEY: 'sk-super-secret-api-key-value',
    IMAGE_MCP_API_KEY: 'super-secret-mcp-bearer-token-value',
    IMAGE_ENTRA_CLIENT_SECRET: 'super-secret-entra-client-secret-value',
    OPENAI_API_KEY: 'sk-legacy-super-secret-value',
  };

  it('marks every declared secret field as secret in the registry', () => {
    for (const key of SECRET_KEYS) {
      expect(getConfigFieldSpec(key)?.secret).toBe(true);
    }
  });

  it('provenance never carries the resolved secret value, only metadata', () => {
    const resolution = resolveConfig({}, SECRET_ENV);
    const serializedProvenance = JSON.stringify(resolution.provenance);
    for (const secretValue of Object.values(SECRET_ENV)) {
      expect(serializedProvenance).not.toContain(secretValue);
    }
    for (const key of SECRET_KEYS) {
      expect(resolution.provenance[key].secret).toBe(true);
    }
  });

  it('diagnostics never carry secret values even when secrets conflict across sources', () => {
    const resolution = resolveConfig(
      { apiKey: 'sk-cli-super-secret-value' },
      { IMAGE_API_KEY: 'sk-env-super-secret-value', OPENAI_API_KEY: 'sk-legacy-super-secret-value' },
    );
    const serializedDiagnostics = JSON.stringify(resolution.diagnostics);
    expect(serializedDiagnostics).not.toContain('sk-cli-super-secret-value');
    expect(serializedDiagnostics).not.toContain('sk-env-super-secret-value');
    expect(serializedDiagnostics).not.toContain('sk-legacy-super-secret-value');
  });

  it('non-secret fields are explicitly marked secret: false in provenance', () => {
    const resolution = resolveConfig({}, { IMAGE_PROVIDER: 'openai' });
    expect(resolution.provenance['provider'].secret).toBe(false);
  });
});

// ─── Registry sanity (compat with AppConfig / secret-loader) ────────────────

describe('CONFIG_FIELD_REGISTRY — structural invariants', () => {
  it('has no duplicate keys', () => {
    const keys = CONFIG_FIELD_REGISTRY.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has no duplicate canonical env names', () => {
    const envs = CONFIG_FIELD_REGISTRY.map((f) => f.canonicalEnv);
    expect(new Set(envs).size).toBe(envs.length);
  });

  it('every canonical env name starts with IMAGE_', () => {
    for (const field of CONFIG_FIELD_REGISTRY) {
      expect(field.canonicalEnv.startsWith('IMAGE_')).toBe(true);
    }
  });
});
