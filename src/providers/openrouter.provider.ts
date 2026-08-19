import type { IImageProvider, GenerateParams, EditParams, VariationParams, ImageResult, ValidationResult } from './provider.interface';
import { ImageProviderError } from './provider.interface';
import { decodeImageData, imageMimeType } from './image-media';
import { OPENROUTER_DEFAULT_MODEL, OPENROUTER_IMAGE_MODELS } from '../config/models';
import { maskSecret } from '../security/sanitise';

const NANO = 'google/gemini-3.1-flash-image';
const MAI = 'microsoft/mai-image-2.5';
const NANO_RATIOS = new Set(['1:1','1:4','1:8','2:3','3:2','3:4','4:1','4:3','4:5','5:4','8:1','9:16','16:9','21:9']);
const MAI_RATIOS = new Set(['auto','1:1','4:3','3:4','16:9','9:16','3:2','2:3']);

interface OpenRouterOptions { apiKey: string; baseUrl?: string; defaultModel?: string; fetchImpl?: typeof fetch }
interface WireResponse { created?: number; data?: Array<{ b64_json?: string; media_type?: string }> }

export class OpenRouterImageProvider implements IImageProvider {
  readonly name = 'openrouter' as const;
  readonly defaultModel: string;
  readonly availableModels = OPENROUTER_IMAGE_MODELS;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenRouterOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    this.defaultModel = options.defaultModel?.trim() || OPENROUTER_DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listAvailableModels(): Promise<readonly string[]> {
    const response = await this.request('/images/models', undefined, 'GET');
    const payload = await response.json() as { data?: Array<{ id?: unknown }> };
    const discovered = new Set((payload.data ?? []).map((m) => typeof m.id === 'string' ? m.id : '').filter(Boolean));
    return OPENROUTER_IMAGE_MODELS.filter((model) => discovered.has(model));
  }

  async generate(params: GenerateParams): Promise<ImageResult[]> {
    const model = this.validateRequest(params, false);
    return this.createImage({ model, prompt: params.prompt, n: params.n ?? 1,
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(params.aspect_ratio ? { aspect_ratio: params.aspect_ratio } : {}) }, model);
  }

  async edit(params: EditParams): Promise<ImageResult[]> {
    const model = this.validateRequest(params, true);
    if (params.mask) this.fail('MODEL_CAPABILITY_UNSUPPORTED', model, 'OpenRouter image references do not support mask.', false);
    if (params.input_fidelity) this.fail('MODEL_CAPABILITY_UNSUPPORTED', model, 'OpenRouter does not support input_fidelity.', false);
    const images = params.images?.length ? params.images : params.image ? [params.image] : [];
    const limit = model === MAI ? 1 : 14;
    if (images.length > limit) this.fail('MODEL_CAPABILITY_UNSUPPORTED', model, `${model} supports at most ${limit} input reference(s).`, false);
    const input_references = images.map((input) => {
      const decoded = decodeImageData(input);
      return { type: 'image_url', image_url: { url: `data:${decoded.mimeType};base64,${decoded.bytes.toString('base64')}` } };
    });
    return this.createImage({ model, prompt: params.prompt, n: params.n ?? 1, input_references,
      ...(params.resolution ? { resolution: params.resolution } : {}),
      ...(params.aspect_ratio ? { aspect_ratio: params.aspect_ratio } : {}) }, model);
  }

  variation(_params: VariationParams): Promise<ImageResult[]> {
    return Promise.reject(new ImageProviderError({ code: 'MODEL_CAPABILITY_UNSUPPORTED',
      message: 'image_variation is not supported by OpenRouter; use image_edit with an input reference.',
      provider: this.name, model: this.defaultModel, retryable: false }));
  }

  async validate(): Promise<ValidationResult> {
    try {
      const models = [...await this.listAvailableModels()];
      return { valid: models.includes(this.defaultModel), provider: this.name, models,
        default_model: this.defaultModel,
        ...(!models.includes(this.defaultModel) ? { error: `Default model "${this.defaultModel}" is not available.` } : {}) };
    } catch (error) {
      return { valid: false, provider: this.name, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private validateRequest(params: Pick<GenerateParams, 'model'|'n'|'resolution'|'aspect_ratio'>, editing: boolean): string {
    const model = params.model?.trim() || this.defaultModel;
    if (!OPENROUTER_IMAGE_MODELS.includes(model as typeof OPENROUTER_IMAGE_MODELS[number]))
      this.fail('MODEL_NOT_FOUND', model, `Unsupported OpenRouter image model "${model}".`, false);
    if ((params.n ?? 1) !== 1) this.fail('INVALID_REQUEST', model, `${model} supports n=1 only.`, false);
    if (model === MAI && params.resolution) this.fail('MODEL_CAPABILITY_UNSUPPORTED', model, `${MAI} does not advertise resolution; omit it.`, false);
    const ratios = model === MAI ? MAI_RATIOS : NANO_RATIOS;
    if (params.aspect_ratio && !ratios.has(params.aspect_ratio)) this.fail('INVALID_REQUEST', model, `Unsupported aspect_ratio "${params.aspect_ratio}" for ${model}.`, false);
    if (editing && model !== NANO && model !== MAI) this.fail('MODEL_CAPABILITY_UNSUPPORTED', model, `Editing is not supported by ${model}.`, false);
    return model;
  }

  private async createImage(body: Record<string, unknown>, model: string): Promise<ImageResult[]> {
    const response = await this.request('/images', body, 'POST', model);
    const json = await response.json() as WireResponse;
    if (!json.data?.length) this.fail('INVALID_PROVIDER_RESPONSE', model, 'OpenRouter returned no image data.', true);
    return json.data!.map((item) => {
      if (!item.b64_json) this.fail('INVALID_PROVIDER_RESPONSE', model, 'OpenRouter returned an empty image payload.', true);
      const decoded = decodeImageData(item.b64_json!);
      if (item.media_type && item.media_type !== decoded.mimeType) this.fail('INVALID_PROVIDER_RESPONSE', model, 'OpenRouter media_type does not match image bytes.', false);
      return { b64_json: decoded.bytes.toString('base64'), format: decoded.format,
        mimeType: imageMimeType(decoded.format), model, created: json.created ?? Math.floor(Date.now()/1000) };
    });
  }

  private async request(path: string, body?: unknown, method = 'GET', model = this.defaultModel): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, { method,
        headers: { Authorization: `Bearer ${this.options.apiKey}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch (error) {
      throw new ImageProviderError({ code: 'PROVIDER_UNAVAILABLE', message: `OpenRouter request failed: ${maskSecret(String(error))}`,
        provider: this.name, model, retryable: true });
    }
    if (!response.ok) {
      let providerMessage = '';
      let providerCode: string | undefined;
      try { const p = await response.clone().json() as { error?: { code?: unknown; message?: unknown } };
        providerMessage = typeof p.error?.message === 'string' ? p.error.message : '';
        providerCode = p.error?.code === undefined ? undefined : String(p.error.code); } catch { /* safe generic mapping */ }
      const map: Record<number,[string,boolean]> = { 400:['INVALID_REQUEST',false],401:['AUTHENTICATION_FAILED',false],402:['INSUFFICIENT_CREDITS',false],403:['ACCESS_DENIED',false],404:['MODEL_NOT_FOUND',false],413:['PAYLOAD_TOO_LARGE',false],429:['RATE_LIMITED',true],502:['UPSTREAM_GENERATION_FAILED',true] };
      const [code,retryable] = map[response.status] ?? [response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'INVALID_REQUEST', response.status >= 500];
      throw new ImageProviderError({ code, message: `OpenRouter request failed (HTTP ${response.status})${providerMessage ? `: ${maskSecret(providerMessage)}` : '.'}`,
        provider: this.name, model, retryable, status: response.status, providerCode,
        requestId: response.headers.get('x-request-id') ?? undefined });
    }
    return response;
  }

  private fail(code: string, model: string, message: string, retryable: boolean): never {
    throw new ImageProviderError({ code, message, provider: this.name, model, retryable });
  }
}
