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
};

/**
 * Build a personalized auto-enhance prompt from VLM photo analysis.
 * Anchors the prompt to the subject's specific features so the model
 * knows exactly what to preserve.
 */
export function buildAutoEnhancePrompt(analysis: PhotoAnalysis): string {
  const { subjectDescription, features, estimatedAgeRange } = analysis;

  // Build a rich subject description
  const agePart = estimatedAgeRange ? `, approximately ${estimatedAgeRange} years old` : '';
  const subject = subjectDescription || 'the person';

  // Collect specific features to anchor preservation
  const preserveDetails: string[] = [];
  if (features.skinTone) preserveDetails.push(`${features.skinTone} skin tone`);
  if (features.hairColor) preserveDetails.push(`${features.hairColor} hair color`);
  if (features.hairStyle) preserveDetails.push(`${features.hairStyle} hair style`);
  if (features.hairLength) preserveDetails.push(`${features.hairLength} hair length`);
  if (features.facialHair) preserveDetails.push(`${features.facialHair} facial hair`);
  if (features.glasses) preserveDetails.push('glasses');
  if (features.distinctiveFeatures?.length) {
    preserveDetails.push(...features.distinctiveFeatures);
  }

  const featureList = preserveDetails.length > 0
    ? `, specifically their ${preserveDetails.join(', ')}`
    : '';

  return `Gently retouch and reframe this photo of ${subject}${agePart} as a shoulder-up portrait with neutral studio lighting and a clean background. Keep all skin texture, pores, blemishes, and imperfections exactly as they are. Do not smooth or beautify the skin. Do not refine or alter the hair. Preserve all facial features and exact likeness to the original image${featureList}. Maintain precise face shape, jawline contour, chin shape, cheekbone prominence, and forehead proportions. Keep exact nose shape including bridge width, nostril shape, and tip. Preserve exact lip shape, fullness, cupid's bow, and mouth width. Maintain exact eye shape, size, spacing, and color. Keep all natural facial asymmetry intact. Preserve every mole, freckle, birthmark, scar, dimple, and beauty mark in their exact positions. Only gently correct the lighting, exposure, and white balance.`;
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
