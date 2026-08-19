import { maskSecret } from '../../security/sanitise';
import type { ProviderStrategy } from './provider.strategy';
import type { GenerateParams, EditParams } from '../provider.interface';
import type { AzureAuthMode } from '../../config/app.config';
import { resolveAzureModelFamily, AzureModelFamilyUnresolvedError } from '../azure-deployment-registry';
import type { AzureDeploymentCatalog } from '../azure-deployment-catalog';

export class AzureStrategy implements ProviderStrategy {
  readonly name = 'azure' as const;
  readonly logPrefix = '[Azure]';
  readonly supportsVariation = false;

  constructor(
    private readonly deployment: string,
    private readonly authMode: AzureAuthMode = 'api_key',
    /**
     * Optional deployment catalog. When injected, explicit `params.model`
     * values are resolved through discovered deployment metadata (exact
     * `modelName`, e.g. `microsoft/mai-image-2.5`) to the exact,
     * customer-chosen deployment/wire name before any request is sent — see
     * {@link resolveModelAsync}. When omitted (the default), the strategy
     * falls back to the old, purely-registry-based behaviour: only the
     * configured `deployment` is ever used on the wire (see
     * {@link resolveModel}) and capability family is resolved solely via
     * azure-deployment-registry.ts.
     */
    private readonly catalog?: AzureDeploymentCatalog,
    /** Authoritative model family from Foundry deployment metadata. */
    private readonly confirmedFamily?: string,
  ) {}

  resolveModel(_params: Pick<GenerateParams, 'model'>): string {
    // Azure always uses the deployment name, not the model from params
    return this.deployment;
  }

  /**
   * Async deployment/model resolver boundary (see ProviderStrategy doc).
   *
   * Only defined when a catalog was injected — this keeps the synchronous
   * `resolveModel()` as the sole, zero-risk path when no catalog is
   * configured (old registry-only fallback, unchanged behaviour).
   *
   * Resolution rules:
   *  - No explicit `params.model` (or it equals the configured default
   *    deployment) → use the configured default deployment verbatim.
   *  - Explicit `params.model` that matches a catalog-discovered
   *    `modelName` (case-insensitive) → resolve to that deployment's exact,
   *    verbatim wire name.
   *  - Explicit `params.model` that also happens to be an exact deployment
   *    name → resolve to itself (identity), matching `resolveByDeployment`.
   *  - Anything else → fail fast with an actionable error, *before* any SDK
   *    call — mirrors the existing model-family-unresolved fail-fast
   *    behaviour, just one layer earlier (catalog name resolution).
   */
  get resolveModelAsync(): ((params: Pick<GenerateParams, 'model'>) => Promise<string>) | undefined {
    if (!this.catalog) return undefined;
    return (params: Pick<GenerateParams, 'model'>): Promise<string> => this.resolveModelAsyncImpl(params);
  }

  private async resolveModelAsyncImpl(params: Pick<GenerateParams, 'model'>): Promise<string> {
    const requested = params.model?.trim();
    if (!requested || requested.toLowerCase() === this.deployment.toLowerCase()) {
      return this.deployment;
    }
    const byDeployment = await this.catalog!.resolveByDeployment(requested);
    if (byDeployment) return byDeployment.name;
    const byModel = await this.catalog!.resolveByModel(requested);
    if (byModel) return byModel.name;
    throw new Error(
      `Unsupported Azure image model "${requested}": no discovered deployment matches this model name or ` +
        `deployment name. Verify the model name against the Azure deployments listing (modelName metadata) ` +
        `or set it to the configured default deployment "${this.deployment}".`,
    );
  }

  buildGenerateExtras(params: GenerateParams, wireModel: string): Record<string, unknown> {
    const model = this.modelFamily(params.model, wireModel);
    this.validateGenerate(params, model, wireModel);
    return {
      ...(params.background ? { background: params.background } : {}),
      ...(params.output_format ? { output_format: params.output_format } : {}),
      ...(params.output_compression !== undefined ? { output_compression: params.output_compression } : {}),
      ...(params.moderation && this.isModerationSupported(model) ? { moderation: params.moderation } : {}),
    };
  }

  buildEditExtras(params: EditParams): Record<string, unknown> {
    const model = this.modelFamily(params.model, this.deployment);
    this.validateEdit(params, model);
    return {
      ...(params.quality && params.quality !== 'auto' ? { quality: params.quality } : {}),
      ...(params.output_format ? { output_format: params.output_format } : {}),
      ...(params.output_compression !== undefined ? { output_compression: params.output_compression } : {}),
      ...(!this.isGptImage2(model) && params.input_fidelity ? { input_fidelity: params.input_fidelity } : {}),
    };
  }

  private modelFamily(model: string, wireModel: string): string {
    // The deployment name is opaque on the wire. Capability decisions (which
    // sizes/params are supported) must be driven by the *resolved* registry
    // family for this deployment (see azure-deployment-registry.ts) — never
    // by the caller-supplied `params.model`, which is an arbitrary,
    // untrusted string. This throws AzureModelFamilyUnresolvedError
    // (model-family-unresolved) for any deployment that is not an exact,
    // confirmed registry entry.
    //
    // `wireModel` is the deployment that will actually be sent on the wire
    // (equal to `this.deployment` unless a catalog resolved an explicit
    // `params.model` to a *different* deployment — see resolveModelAsync).
    // Capabilities are always resolved for `wireModel`, since that is the
    // deployment that will actually serve the request.
    const family = this.confirmedFamily?.trim().toLowerCase() ?? resolveAzureModelFamily(wireModel);
    const requested = model.toLowerCase().trim();
    if (requested !== family) {
      // The caller asked for a model that does not match what this
      // deployment is actually confirmed to be. Fail fast, before any SDK
      // call, with an actionable message rather than silently using the
      // caller's (possibly wrong) assumption as the capability source.
      throw new Error(
        `Unsupported Azure image model "${model}" for deployment "${wireModel}": ` +
          `this deployment's resolved capability family is "${family}". ` +
          `Set model to "${family}" (matching the deployment's confirmed capabilities) to proceed.`,
      );
    }
    return family;
  }

  private isGptImage2(model: string): boolean {
    return model === 'gpt-image-2';
  }

  private isGptImage1Series(model: string): boolean {
    return /^gpt-image-1(?:\.5|-mini)?$/.test(model);
  }

  // Moderation is documented as supported only for the base gpt-image-1
  // model (docs/API.md:141) — not gpt-image-2, gpt-image-1.5, or
  // gpt-image-1-mini.
  private isModerationSupported(model: string): boolean {
    return model === 'gpt-image-1';
  }

  private validateGenerate(params: GenerateParams, model: string, wireModel: string): void {
    if (!this.isGptImage2(model) && !this.isGptImage1Series(model)) {
      throw new Error(`Unsupported Azure image model "${params.model}" for deployment "${wireModel}".`);
    }
    if (!this.isGptImage2(model) && params.size && params.size !== 'auto' && !['1024x1024', '1024x1536', '1536x1024'].includes(params.size)) {
      throw new Error(`Azure ${model} supports only auto, 1024x1024, 1024x1536, or 1536x1024 sizes.`);
    }
    if (params.moderation && !this.isModerationSupported(model)) {
      throw new Error(`Azure moderation parameter is only supported for gpt-image-1, not ${model}.`);
    }
    if (params.background === 'transparent' && params.output_format === 'jpeg') {
      throw new Error('Azure transparent background requires png or webp output.');
    }
    if (params.output_compression !== undefined && !params.output_format) {
      throw new Error('Azure output_compression requires output_format jpeg or webp.');
    }
    if (params.output_compression !== undefined && params.output_format === 'png') {
      throw new Error('Azure output_compression is only supported for jpeg or webp output.');
    }
  }

  private validateEdit(params: EditParams, model: string): void {
    if (!this.isGptImage2(model) && !this.isGptImage1Series(model)) {
      throw new Error(`Unsupported Azure image model "${params.model}" for editing.`);
    }
    if (this.isGptImage2(model) && params.input_fidelity) {
      throw new Error('Azure input_fidelity is not supported by gpt-image-2.');
    }
    if (params.background === 'transparent' && params.output_format === 'jpeg') {
      throw new Error('Azure transparent background requires png or webp output.');
    }
    if (params.output_compression !== undefined && !params.output_format) {
      throw new Error('Azure output_compression requires output_format jpeg or webp.');
    }
    if (params.output_compression !== undefined && params.output_format === 'png') {
      throw new Error('Azure output_compression is only supported for jpeg or webp output.');
    }
  }

  async validate(client: import('openai').default): Promise<import('../provider.interface').ValidationResult> {
    if (!this.deployment.trim()) return { valid: false, provider: this.name, error: 'Azure deployment is missing.' };
    try {
      const models = await client.models.list();
      const entries = (models as unknown as { data?: Array<{ id?: string }> }).data ?? [];
      if (entries.length === 0) {
        return {
          valid: false,
          provider: this.name,
          deployment: this.deployment,
          error: 'Azure deployment could not be verified: the deployment listing returned no entries.',
        };
      }
      if (!entries.some((entry) => entry.id === this.deployment)) {
        return { valid: false, provider: this.name, deployment: this.deployment, error: `Azure deployment not found: ${this.deployment}.` };
      }
      // The deployment exists and is reachable, but a generic models.list()
      // entry is just an opaque deployment ID — it proves reachability, not
      // the deployment's model family/capabilities (see
      // azure-deployment-registry.ts). Only deployments that resolve through
      // the internal registry (currently: exact "gpt-image-2") are reported
      // as fully valid; anything else — including plausible-looking names
      // such as "MAI-Image-2.5" — is reported as unresolved/inconclusive
      // rather than claimed valid, since generate/edit will still reject it.
      try {
        resolveAzureModelFamily(this.deployment);
      } catch (familyErr) {
        const message = familyErr instanceof AzureModelFamilyUnresolvedError ? familyErr.message : String(familyErr);
        return {
          valid: false,
          provider: this.name,
          deployment: this.deployment,
          error: `Azure deployment "${this.deployment}" exists and is reachable, but is unresolved/inconclusive: ${message} A models.list() entry only proves the deployment ID is opaque and reachable — it does not confirm image API capabilities.`,
        };
      }
      return { valid: true, provider: this.name, deployment: this.deployment };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status?: unknown }).status) : undefined;
      const category = status === 401 ? 'Azure authentication failed' : status === 403 ? 'Azure deployment access denied' : status === 404 ? 'Azure deployment or endpoint not found' : 'Azure deployment validation failed';
      return { valid: false, provider: this.name, deployment: this.deployment, error: `${category}: ${maskSecret(message)}` };
    }
  }

  normalizeError(err: unknown): Error {
    if (err instanceof Error) {
      const msg = maskSecret(err.message);
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        return new Error(`Rate limit exceeded (Azure): ${msg}. Please wait before retrying.`);
      }
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        return new Error(
          this.authMode === 'azure_cli'
            ? 'Azure CLI authentication failed. Run `az login`, verify IMAGE_AZURE_TENANT_ID, and retry.'
            : this.authMode === 'on_behalf_of'
              ? 'Microsoft Entra OBO authentication failed. Acquire a fresh MCP token and verify server consent and confidential credentials.'
              : 'Authentication failed: invalid API key for Azure AI Foundry provider.',
        );
      }
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) {
        return new Error(
          `Access denied (Azure): ${msg}. Verify Azure OpenAI RBAC permissions for the selected identity. ` +
          `gpt-image-1, gpt-image-1.5, and gpt-image-1-mini require limited-access registration — ` +
          `apply at https://aka.ms/oai/gptimage1access. ` +
          `gpt-image-2 is Public Preview and does not require prior approval.`,
        );
      }
      if (msg.includes('404')) {
        return new Error(`Model not found: ${this.deployment}. Check IMAGE_DEPLOYMENT.`);
      }
      return new Error(`Azure AI Foundry error: ${msg}`);
    }
    return new Error(String(err));
  }
}
