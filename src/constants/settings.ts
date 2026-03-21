import type { AppSettings } from '@/types';
import type { PhotoAnalysis } from '@/types/chat';

// ---------------------------------------------------------------------------
// Model IDs
// ---------------------------------------------------------------------------

export const QWEN_LIGHTNING_MODEL_ID = 'qwen_image_edit_2511_fp8_lightning';
export const QWEN_STANDARD_MODEL_ID = 'qwen_image_edit_2511_fp8';
export const FLUX2_DEV_MODEL_ID = 'flux2_dev_fp8';
export const Z_IMAGE_TURBO_MODEL_ID = 'z_image_turbo_bf16';

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
    label: 'Flux.2 [dev]',
    value: FLUX2_DEV_MODEL_ID,
    defaults: { steps: 36, guidance: 4, sampler: 'euler', scheduler: 'simple' },
  },
  {
    label: 'Qwen 2511',
    value: QWEN_STANDARD_MODEL_ID,
    defaults: { steps: 25, guidance: 2.5, sampler: 'euler', scheduler: 'simple' },
  },
  {
    label: 'Qwen Lightning',
    value: QWEN_LIGHTNING_MODEL_ID,
    defaults: { steps: 4, guidance: 1, sampler: 'euler', scheduler: 'simple' },
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
  defaultSteps: 36,
  defaultSampler: 'euler',
  defaultScheduler: 'simple',
  outputFormat: 'jpg',
  autoEnhanceWebcam: true,
};

export const AUTO_ENHANCE_CONFIG = {
  negativePrompt:
    'deformed, distorted, bad quality, blurry, ugly, disfigured, changed identity, cartoon, illustration, warped features, blurry',
  guidance: 1,
};

/**
 * Build a minimal auto-enhance prompt. Avoids describing the subject
 * so the model preserves the original pixels rather than rebuilding
 * the face from a text description.
 */
export function buildAutoEnhancePrompt(_analysis: PhotoAnalysis): string {
  return 'Crop and reframe this photo as a tight head-and-shoulders portrait. Improve the lighting, exposure, sharpness, and overall image quality. Remove any aliasing, noise, or compression artifacts. Blur the background with shallow depth of field like a 35mm camera at f/1.2. Do not change the person at all.';
}

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

export const THUMBNAIL_CONFIG = {
  modelId: Z_IMAGE_TURBO_MODEL_ID,
  width: 512,
  height: 512,
  steps: 6,
  guidance: 1,
  sampler: 'euler',
  scheduler: 'simple',
  outputFormat: 'jpg',
  maxConcurrent: 8,
};

export const SSE_CONFIG = {
  retryDelay: 1000,
  maxRetries: 3,
  heartbeatInterval: 30000,
};
