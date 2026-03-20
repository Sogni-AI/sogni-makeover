import type { AppSettings } from '@/types';

// ---------------------------------------------------------------------------
// Model IDs
// ---------------------------------------------------------------------------

export const QWEN_LIGHTNING_MODEL_ID = 'qwen_image_edit_2511_fp8_lightning';
export const QWEN_STANDARD_MODEL_ID = 'qwen_image_edit_2511_fp8';
export const FLUX2_DEV_MODEL_ID = 'flux2_dev_fp8';

export const DEFAULT_MODEL = FLUX2_DEV_MODEL_ID;

// ---------------------------------------------------------------------------
// Per-model defaults (pulled from sogni-photobooth)
// ---------------------------------------------------------------------------

export interface ModelOption {
  label: string;
  value: string;
  defaults: {
    steps: number;
    guidance: number;
    sampler: string;
    scheduler: string;
  };
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    label: 'Qwen Lightning',
    value: QWEN_LIGHTNING_MODEL_ID,
    defaults: { steps: 4, guidance: 1, sampler: 'euler', scheduler: 'simple' },
  },
  {
    label: 'Qwen 2511',
    value: QWEN_STANDARD_MODEL_ID,
    defaults: { steps: 25, guidance: 2.5, sampler: 'euler', scheduler: 'simple' },
  },
  {
    label: 'Flux.2 [dev]',
    value: FLUX2_DEV_MODEL_ID,
    defaults: { steps: 30, guidance: 4, sampler: 'euler', scheduler: 'simple' },
  },
];

/** Look up the ModelOption for a given model ID, falling back to the first entry. */
export function getModelOption(modelId: string): ModelOption {
  return MODEL_OPTIONS.find((m) => m.value === modelId) ?? MODEL_OPTIONS[0];
}

// ---------------------------------------------------------------------------
// App-wide default settings
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: DEFAULT_MODEL,
  defaultWidth: 1024,
  defaultHeight: 1536,
  defaultGuidance: 4,
  defaultSteps: 30,
  defaultSampler: 'euler',
  defaultScheduler: 'simple',
  outputFormat: 'jpg',
  autoEnhanceWebcam: true,
};

export const AUTO_ENHANCE_CONFIG = {
  prompt:
    'Professional headshot with soft studio lighting. Subtly smooth skin blemishes and even out skin tone while keeping natural skin texture. Sharpen facial details. Add subtle depth-of-field with softly blurred background. Preserve the exact same person: same ethnicity, same skin tone, same hair color, same hair style, same hair texture, same eye color, same facial structure, same bone structure, same nose shape, same lip shape, same face shape, same freckles, same moles, same birthmarks, same scars. Maintain exact same facial features, identity, expression, pose, and face proportions. Professional retouched portrait quality.',
  negativePrompt:
    'deformed, distorted, bad quality, blurry, ugly, disfigured, changed face, different person, altered features, different ethnicity, different skin color, lighter skin, darker skin, different hair color, different hair style, cartoon, painting, illustration, skin whitening, skin darkening, race change, stretched face, elongated face, warped proportions',
  denoisingStrength: 0.35,
};

export const GENERATION_DEFAULTS = {
  numberOfMedia: 1,
  negativePrompt: 'deformed, distorted, bad quality, blurry, ugly, disfigured',
};

export const DEMO_MODE_LIMITS = {
  maxFreeGenerations: 3,
  softGateMessage: 'Sign in for unlimited makeovers!',
};

export const IMAGE_CONSTRAINTS = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxDimension: 2048,
  minDimension: 256,
  acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  outputWidth: 1024,
  outputHeight: 1536,
};

export const SSE_CONFIG = {
  retryDelay: 1000,
  maxRetries: 3,
  heartbeatInterval: 30000,
};
