import { ImageProviderError } from '../../providers/provider.interface';
import { maskSecret } from '../../security/sanitise';

export function providerErrorToToolResult(error: unknown) {
  const message = maskSecret(error instanceof Error ? error.message : String(error));
  if (!(error instanceof ImageProviderError)) {
    return {
      isError: true as const,
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
    };
  }

  const maxRetriesRecommended = error.code === 'CONTENT_SAFETY_BLOCK'
    ? error.stage === 'prompt' ? 0 : 1
    : error.retryable ? 1 : 0;

  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: `[${error.code}] ${message}` }],
    structuredContent: {
      error: {
        code: error.code,
        provider: error.provider,
        model: error.model,
        retryable: error.retryable,
        max_retries_recommended: maxRetriesRecommended,
        stage: error.stage,
        image_created: false,
        ...(error.status !== undefined ? { http_status: error.status } : {}),
        ...(error.providerCode ? { provider_code: error.providerCode } : {}),
        ...(error.label ? { provider_label: error.label } : {}),
        ...(error.requestId ? { request_id: error.requestId } : {}),
      },
    },
  };
}
