import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { AppConfig } from '../../config/app.config';
import { sanitisePrompt, maskSecret } from '../../security/sanitise';

/**
 * Generation context known after elicitation runs.
 * All fields optional — the prompt builder degrades gracefully when absent.
 */
export interface ImagePromptContext {
  model: string;
  quality?: string;  // 'auto' | 'high' | 'medium' | 'low' | 'hd' | 'standard'
  size?: string;     // e.g. '1536x1024', '1024x1024', etc.
  output_format?: string; // 'png' | 'jpeg' | 'webp'
  background?: string;    // 'transparent' | 'opaque' | 'auto'
  n?: number;
}

@Injectable()
export class SamplingService {
  private readonly logger = new Logger(SamplingService.name);

  constructor(private readonly configService: ConfigService) {}

  get isEnabled(): boolean {
    return this.configService.get<AppConfig['mcp']>('mcp')!.useSampling;
  }

  /**
   * Request the client LLM to enhance an image generation prompt.
   *
   * All generation context (quality, size, format, background, n) must be
   * resolved BEFORE calling this — elicitation runs first for that reason.
   * The enhancer uses context to scale token budget and tailor guidance.
   *
   * Returns the enhanced prompt, or the original if sampling fails / unavailable.
   */
  async enhancePrompt(
    server: Server,
    originalPrompt: string,
    context: ImagePromptContext,
  ): Promise<string> {
    if (!this.isEnabled) {
      return originalPrompt;
    }

    try {
      const result = await server.createMessage({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: SamplingService.buildUserMessage(originalPrompt, context),
            },
          },
        ],
        maxTokens: SamplingService.resolveMaxTokens(context.quality, context.size),
        systemPrompt: SamplingService.SYSTEM_PROMPT,
      });

      if (result?.content?.type === 'text' && result.content.text) {
        const enhanced = String(result.content.text).trim();
        this.logger.debug(`Prompt enhanced via sampling: ${enhanced.substring(0, 80)}...`);
        // Re-sanitise: LLM output is untrusted — strip null bytes, enforce length
        try {
          return sanitisePrompt(enhanced, 32_000);
        } catch {
          this.logger.warn('Sampling response exceeded max length, falling back to original prompt');
          return originalPrompt;
        }
      }
      return originalPrompt;
    } catch (err) {
      this.logger.debug(`Sampling not available or failed: ${maskSecret(String(err))}`);
      return originalPrompt;
    }
  }

  // ── Static helpers — exported so they can be unit-tested independently ──

  /**
   * System prompt: establishes the enhancer's role, hard constraints, and
   * structural rules that apply regardless of generation context.
   *
   * Design rationale:
   * - Role clarity first: "only job" prevents the LLM from explaining or hedging.
   * - Rules are numbered so the LLM can reference them internally.
   * - Explicit anti-filler instruction prevents padding with hollow adjectives.
   * - The photorealism trigger instruction ("add 'photorealistic' + photography cue")
   *   follows OpenAI's guide recommendation: explicit keyword + medium signals.
   * - The mandatory closing constraint ("no watermark…") is a safety net against
   *   the model hallucinating text overlays or branding.
   */
  static readonly SYSTEM_PROMPT = [
    'You are an expert image prompt engineer specializing in OpenAI gpt-image-* models.',
    'Your only job: rewrite the user\'s prompt to maximize image quality for the given output parameters.',
    '',
    'Strict rules:',
    '1. Return ONLY the enhanced prompt text. No explanations, labels, quotes, preamble, or postscript.',
    '2. Preserve the user\'s original subject, mood, and intent — never contradict or replace them.',
    '3. Add specificity through: visual medium (photo / illustration / 3D render / watercolor / etc.),',
    '   materials, textures, lighting type, atmosphere, viewpoint, and composition framing.',
    '4. When the prompt implies photorealism (people, streets, products, food, architecture),',
    '   add "photorealistic" explicitly and at least one photography cue',
    '   (e.g. "shot on 35mm", "soft diffuse lighting", "shallow depth of field", "golden hour").',
    '5. Always append at the end: no watermark, no extra text, no logos',
    '6. Never add hollow filler: "beautiful", "amazing", "stunning", "best quality",',
    '   "masterpiece", "highly detailed" — use structural description instead.',
  ].join('\n');

  /**
   * Token budget scaled to output fidelity.
   *
   * Rationale:
   * - low quality → user wants a fast draft; a long elaborate prompt wastes both
   *   sampling tokens and slows the ideation loop. 80 tokens ≈ 1–2 tight sentences.
   * - high/hd + large canvas → maximum structural detail is genuinely used by the
   *   model; 350 tokens gives room for medium + lighting + composition + constraints.
   * - high/hd + standard size → 250 tokens; same richness, slightly shorter.
   * - everything else (medium / auto / standard) → 150 tokens; enough for key
   *   descriptors without over-specifying.
   */
  static resolveMaxTokens(quality?: string, size?: string): number {
    const isDraft = quality === 'low';
    const isHighFidelity = quality === 'high' || quality === 'hd';
    const isLargeCanvas =
      size === '1536x1024' ||
      size === '1024x1536' ||
      size === '1792x1024' ||
      size === '1024x1792' ||
      size === '2560x1440'; // future-proof; not in current schema enum

    if (isDraft) return 80;
    if (isHighFidelity && isLargeCanvas) return 350;
    if (isHighFidelity) return 250;
    return 150; // medium / auto / standard / unknown
  }

  /**
   * Build the context-aware user message sent to the sampling LLM.
   *
   * Structure (ordered by importance):
   *   1. Target model identifier
   *   2. Fidelity directive  — scales instruction depth to quality level
   *   3. Canvas directive    — composition cues matched to aspect ratio
   *   4. Background override — transparent bg triggers "isolated subject" mode
   *   5. Format note         — JPEG-specific colour guidance
   *   6. Variant guidance    — n > 1 keeps the prompt open for variation
   *   7. Anti-pattern list   — lightweight reminder, not exhaustive
   *   8. Original prompt     — always last, always quoted
   */
  static buildUserMessage(originalPrompt: string, ctx: ImagePromptContext): string {
    const {
      model,
      quality,
      size,
      output_format: fmt,
      background,
      n = 1,
    } = ctx;

    const isDraft         = quality === 'low';
    const isHighFidelity  = quality === 'high' || quality === 'hd';
    const isTransparentBg = background === 'transparent';
    const isUltraWide     = size === '2560x1440';
    const isWidescreen    = size === '1536x1024' || size === '1792x1024' || isUltraWide;
    const isPortrait      = size === '1024x1536' || size === '1024x1792';
    const isSquare        = size === '1024x1024';
    const isMultiVariant  = n > 1;
    const isJpeg          = fmt === 'jpeg';

    const lines: string[] = [
      `Enhance this image generation prompt for ${model}.`,
      '',
    ];

    // ── 1. Fidelity / quality directive ─────────────────────────────────
    if (isDraft) {
      lines.push(
        'FIDELITY: Draft / ideation (low quality). Keep the enhanced prompt SHORT — 1 to 2 sentences.',
        'Add only the single most important missing visual detail. Do not elaborate further.',
      );
    } else if (isHighFidelity) {
      lines.push(
        'FIDELITY: Maximum (high quality). Enrich with ALL of the following where relevant:',
        '  • Visual medium  — e.g. "professional photograph", "oil painting", "3D render", "watercolor illustration"',
        '  • Materials & textures — e.g. "brushed aluminium", "rough concrete", "silk fabric", "film grain"',
        '  • Lighting — e.g. "soft diffuse window light", "golden-hour rim light", "neon-lit shadows", "overcast diffuse"',
        '  • Atmosphere & mood — e.g. "misty morning", "tense high-contrast midday", "warm candlelit interior"',
        '  • Composition — e.g. "low-angle shot", "rule-of-thirds", "macro detail", "leading lines", "shallow depth of field"',
      );
    } else {
      // medium / auto / standard / unknown
      lines.push(
        'FIDELITY: Standard. Add key visual descriptors: subject detail, lighting quality, and composition framing.',
        'Keep the result focused — 2 to 3 sentences maximum.',
      );
    }

    lines.push('');

    // ── 2. Canvas / composition directive ───────────────────────────────
    if (isUltraWide) {
      lines.push(
        'CANVAS: Ultra-wide cinematic (2560×1440).',
        'Favour panoramic depth, environmental context, strong horizon lines, and wide establishing shots.',
        'Include foreground elements that guide the eye across the full width of the frame.',
      );
      lines.push('');
    } else if (isWidescreen) {
      lines.push(
        'CANVAS: Widescreen landscape.',
        'Favour cinematic framing, rule-of-thirds horizontal composition, and foreground-to-background depth layers.',
      );
      lines.push('');
    } else if (isPortrait) {
      lines.push(
        'CANVAS: Portrait orientation.',
        'Favour vertical composition: subject filling the frame from top to bottom, eye-level or slight high-angle viewpoint.',
      );
      lines.push('');
    } else if (isSquare) {
      lines.push(
        'CANVAS: Square format.',
        'Centred, radially balanced, or symmetrical composition. Avoid extreme wide-angle cues.',
      );
      lines.push('');
    }
    // No canvas section if size is 'auto' or unknown — let the model decide.

    // ── 3. Transparent background override ──────────────────────────────
    if (isTransparentBg) {
      lines.push(
        'OUTPUT: Transparent background PNG.',
        'This is an isolated subject — a logo, icon, product shot, UI element, sticker, or cutout.',
        'Describe ONLY the subject itself. Do NOT mention any background, scene, surface, shadow, or environment.',
        'Emphasise clean edges, solid fills, and a well-defined silhouette.',
        '',
      );
    }

    // ── 4. JPEG colour note ──────────────────────────────────────────────
    if (isJpeg && !isTransparentBg) {
      lines.push(
        'FORMAT: JPEG output. Emphasise colour richness, tonal contrast, and warm/cool colour balance.',
        'Avoid large flat white or black areas that compress poorly.',
        '',
      );
    }

    // ── 5. Multi-variant openness ────────────────────────────────────────
    if (isMultiVariant) {
      lines.push(
        `VARIANTS: ${n} images will be generated from this prompt.`,
        'Keep the prompt open-ended enough to allow natural variation between images.',
        'Avoid hyper-specific positional micro-details that would make every variant look identical.',
        '',
      );
    }

    // ── 6. Anti-pattern reminder ─────────────────────────────────────────
    lines.push(
      'AVOID: "beautiful", "amazing", "stunning", "best quality", "masterpiece", "highly detailed".',
      'AVOID: changing the subject, mood, or intent of the original.',
      'AVOID: wrapping output in quotes or adding any label such as "Enhanced prompt:".',
      '',
      `Original prompt: "${originalPrompt}"`,
    );

    return lines.join('\n');
  }
}
