import { describe, it, expect } from 'bun:test';
import { resolveAzureModelFamily, AzureModelFamilyUnresolvedError } from '../../../src/providers/azure-deployment-registry';

describe('resolveAzureModelFamily', () => {
  it('resolves the exact confirmed "gpt-image-2" deployment to its model family', () => {
    expect(resolveAzureModelFamily('gpt-image-2')).toBe('gpt-image-2');
  });

  it('throws AzureModelFamilyUnresolvedError (model-family-unresolved) for the opaque "MAI-Image-2.5" deployment', () => {
    expect(() => resolveAzureModelFamily('MAI-Image-2.5')).toThrow(AzureModelFamilyUnresolvedError);
    expect(() => resolveAzureModelFamily('MAI-Image-2.5')).toThrow(/model-family-unresolved/);
  });

  it('throws for an arbitrary/unknown deployment name', () => {
    expect(() => resolveAzureModelFamily('prod-my-custom-deployment')).toThrow(/model-family-unresolved/);
  });

  it('does not case-fold or fuzzy-match deployment names — only the exact registered entry resolves', () => {
    expect(() => resolveAzureModelFamily('GPT-IMAGE-2')).toThrow(/model-family-unresolved/);
    expect(() => resolveAzureModelFamily('gpt-image-2 ')).toThrow(/model-family-unresolved/);
  });
});
