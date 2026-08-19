/**
 * Internal Azure deployment → model-family resolver.
 *
 * `IMAGE_DEPLOYMENT` is the only user-facing Azure configuration knob: it is
 * the customer-chosen Azure OpenAI/AI Foundry deployment name, and it is
 * always sent verbatim as the wire `model` field (see AzureStrategy —
 * "deployment stays opaque on the wire"). It is NOT itself a model name we
 * can trust: Azure deployment names are arbitrary strings chosen by the
 * customer at deployment-creation time, so the server cannot infer image API
 * capabilities (supported sizes, moderation, input_fidelity, ...) from the
 * deployment name alone.
 *
 * This registry is the single place where a deployment name is mapped to a
 * *known, confirmed* model family. Only exact, verified deployments are
 * listed here:
 *   - "gpt-image-2" → the deployment name for the gpt-image-2 model happens
 *     to match the model family name exactly, and this has been confirmed.
 *
 * Everything else — including plausible-looking names such as
 * "MAI-Image-2.5" — is intentionally left unresolved. We will not guess a
 * model family from a naming convention. Until Azure exposes reliable
 * deployment-scoped metadata (or an explicit mapping is added here after
 * confirmation), any other deployment name fails fast with a
 * `model-family-unresolved` error *before* a generate/edit request is sent.
 *
 * Note: `provider_validate` (AzureStrategy.validate()) is deliberately
 * decoupled from this registry — it only confirms that the deployment
 * exists/is reachable via the deployment listing, it never claims to know
 * the deployment's model family. A deployment can validate successfully
 * while still being unresolved for generate/edit.
 */

export class AzureModelFamilyUnresolvedError extends Error {
  readonly code = 'model-family-unresolved' as const;

  constructor(readonly deployment: string) {
    super(
      `model-family-unresolved: Azure deployment "${deployment}" model capabilities are unresolved. ` +
        'Deployment metadata is required; the server will not guess its image API schema from the deployment name.',
    );
    this.name = 'AzureModelFamilyUnresolvedError';
  }
}

/**
 * Exact, confirmed deployment-name → model-family mappings for the
 * OpenAI-compatible `AzureStrategy` path only. Note: "MAI-Image-2.5" is
 * intentionally NOT listed here — MAI Image is not OpenAI-compatible (see
 * {@link isMaiImageDeployment} / `MaiImageProvider`) and is routed to a
 * dedicated adapter *before* `AzureStrategy` is ever constructed. If
 * `AzureStrategy` is ever exercised directly against "MAI-Image-2.5" (e.g.
 * misconfiguration bypassing the routing in providers.module.ts), it must
 * still fail fast with `model-family-unresolved` rather than guess.
 */
const KNOWN_AZURE_DEPLOYMENTS: ReadonlyMap<string, string> = new Map([['gpt-image-2', 'gpt-image-2']]);

/**
 * Resolves the model family for an Azure deployment, or throws
 * {@link AzureModelFamilyUnresolvedError} when the deployment is not an
 * exact, confirmed entry in the registry.
 */
export function resolveAzureModelFamily(deployment: string): string {
  const family = KNOWN_AZURE_DEPLOYMENTS.get(deployment);
  if (!family) throw new AzureModelFamilyUnresolvedError(deployment);
  return family;
}

/**
 * True when `deployment` is the confirmed MAI Image deployment name
 * ("MAI-Image-2.5", case-insensitive). Used to route requests to the
 * dedicated `/mai/v1` adapter ({@link MaiImageProvider}) instead of the
 * OpenAI-compatible `AzureStrategy` path, which MAI Image does not support.
 */
export function isMaiImageDeployment(deployment: string | undefined): boolean {
  return !!deployment && deployment.trim().toLowerCase() === 'mai-image-2.5';
}
