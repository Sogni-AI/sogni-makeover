/**
 * Thumbnail generation service
 *
 * Generates quick preview thumbnails for transformation cards using
 * z_image_turbo_bf16 at 6 steps / 512x512 for fast text-to-image previews.
 */
import { THUMBNAIL_CONFIG } from '@/constants/settings';
import type { GeneratedCategory, GeneratedTransformation, PhotoAnalysis } from '@/types/chat';
import { generateImage } from '@/services/api';

export interface ThumbnailResult {
  id: string;
  url: string;
}

/**
 * Build a subject context suffix from photo analysis for skin/age matching.
 */
export function buildSubjectContext(photoAnalysis: PhotoAnalysis | null): string {
  if (!photoAnalysis) return '';
  const parts: string[] = [];
  if (photoAnalysis.features.skinTone) {
    parts.push(`${photoAnalysis.features.skinTone} skin tone`);
  }
  if (photoAnalysis.estimatedAgeRange) {
    parts.push(`${photoAnalysis.estimatedAgeRange} age`);
  }
  if (photoAnalysis.perceivedGender) {
    parts.push(photoAnalysis.perceivedGender);
  }
  return parts.length > 0 ? parts.join(', ') : '';
}

/**
 * Build a fallback thumbnail prompt from a transformation name when
 * the LLM didn't provide a dedicated thumbnailPrompt.
 */
function buildFallbackTransformationPrompt(transformation: GeneratedTransformation, subjectContext: string): string {
  const subject = subjectContext ? `a person with ${subjectContext}` : 'a person';
  return `A close-up beauty shot of ${subject} featuring ${transformation.name}, realistic photograph, sharp focus on subject, clean detailed image, soft diffused studio portrait lighting with subtle rim light, plain neutral studio background, simple uncluttered composition, correct human anatomy, no text, no watermark, no logos, no UI elements`;
}

/**
 * Get the thumbnail prompt for a category, appending subject context
 * if it's not already embedded by the LLM.
 */
export function getCategoryThumbnailPrompt(
  category: GeneratedCategory,
  subjectContext: string,
): string {
  if (category.thumbnailPrompt) {
    return subjectContext
      ? `${category.thumbnailPrompt}, ${subjectContext}`
      : category.thumbnailPrompt;
  }
  // Fallback: generate a generic category preview prompt
  const subject = subjectContext ? `a person with ${subjectContext}` : 'a person';
  return `A close-up beauty shot of ${subject} showcasing ${category.name}, realistic photograph, sharp focus on subject, clean detailed image, soft diffused studio portrait lighting with subtle rim light, plain neutral gray studio background, simple uncluttered composition, correct human anatomy, no text, no watermark, no logos, no UI elements`;
}

/**
 * Build a stable ID for a category thumbnail (used as cache key).
 */
export function getCategoryThumbnailId(categoryName: string): string {
  return `cat-${categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/**
 * Get the thumbnail prompt for a transformation, appending subject context
 * if it's not already embedded by the LLM.
 */
export function getTransformationThumbnailPrompt(
  transformation: GeneratedTransformation,
  subjectContext: string,
): string {
  if (transformation.thumbnailPrompt) {
    // LLM should already include skin/age, but append context as safety net
    return subjectContext
      ? `${transformation.thumbnailPrompt}, ${subjectContext}`
      : transformation.thumbnailPrompt;
  }
  return buildFallbackTransformationPrompt(transformation, subjectContext);
}

/**
 * Generate a single thumbnail via the frontend SDK (authenticated users).
 * Returns the result image URL. Cancels the project if signal aborts.
 */
async function generateThumbnailViaSdk(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sogniClient: any,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const project = await sogniClient.projects.create({
    type: 'image',
    modelId: THUMBNAIL_CONFIG.modelId,
    positivePrompt: prompt,
    width: THUMBNAIL_CONFIG.width,
    height: THUMBNAIL_CONFIG.height,
    steps: THUMBNAIL_CONFIG.steps,
    guidance: THUMBNAIL_CONFIG.guidance,
    sampler: THUMBNAIL_CONFIG.sampler,
    scheduler: THUMBNAIL_CONFIG.scheduler,
    outputFormat: THUMBNAIL_CONFIG.outputFormat,
    numberOfMedia: 1,
    disableNSFWFilter: true,
    tokenType: 'spark',
  });

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    };

    const timeout = setTimeout(() => {
      if (settled) return;
      cleanup();
      try { project.cancel(); } catch { /* best-effort */ }
      reject(new Error('Thumbnail generation timed out'));
    }, 30000);

    const onAbort = () => {
      if (settled) return;
      cleanup();
      try { project.cancel(); } catch { /* best-effort */ }
      reject(new Error('Thumbnail generation aborted'));
    };

    signal?.addEventListener('abort', onAbort);

    if (signal?.aborted) {
      cleanup();
      try { project.cancel(); } catch { /* best-effort */ }
      reject(new Error('Thumbnail generation aborted'));
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    project.on('jobCompleted', (event: any) => {
      if (settled) return;
      const url = event.resultUrl || event.imageUrl || event.previewUrl;
      if (url && !event.isPreview) {
        cleanup();
        resolve(url);
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    project.on('failed', (err: any) => {
      if (settled) return;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err?.message || 'Thumbnail generation failed')));
    });
  });
}

/**
 * Generate a single thumbnail via the backend proxy (demo users).
 * Returns the result image URL.
 */
async function generateThumbnailViaBackend(prompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const params = {
      modelId: THUMBNAIL_CONFIG.modelId,
      positivePrompt: prompt,
      width: THUMBNAIL_CONFIG.width,
      height: THUMBNAIL_CONFIG.height,
      guidance: THUMBNAIL_CONFIG.guidance,
      steps: THUMBNAIL_CONFIG.steps,
      sampler: THUMBNAIL_CONFIG.sampler,
      scheduler: THUMBNAIL_CONFIG.scheduler,
      outputFormat: THUMBNAIL_CONFIG.outputFormat,
      numberOfMedia: 1,
      tokenType: 'spark',
    };

    const timeout = setTimeout(() => {
      reject(new Error('Thumbnail generation timed out'));
    }, 30000);

    generateImage(params, (event: unknown) => {
      const data = event as Record<string, unknown>;
      if (data.type === 'jobCompleted') {
        const url = (data.resultUrl || data.imageUrl || data.previewUrl) as string;
        if (url) {
          clearTimeout(timeout);
          resolve(url);
        }
      } else if (data.type === 'failed' || data.type === 'error') {
        clearTimeout(timeout);
        reject(new Error((data.message as string) || 'Thumbnail generation failed'));
      }
    }).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Generate a single thumbnail image.
 * Automatically routes through SDK (authenticated) or backend (demo).
 */
export async function generateThumbnail(
  prompt: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sogniClient?: any,
  signal?: AbortSignal,
): Promise<string> {
  if (sogniClient?.projects) {
    return generateThumbnailViaSdk(sogniClient, prompt, signal);
  }
  return generateThumbnailViaBackend(prompt);
}

interface ThumbnailQueueItem {
  id: string;
  prompt: string;
}

/**
 * Generate thumbnails for a batch of items with concurrency control.
 * Calls onResult for each completed thumbnail.
 */
export async function generateThumbnailBatch(
  items: ThumbnailQueueItem[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sogniClient: any,
  onResult: (result: ThumbnailResult) => void,
  signal?: AbortSignal,
): Promise<void> {
  const maxConcurrent = THUMBNAIL_CONFIG.maxConcurrent;
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < items.length) {
      if (signal?.aborted) return;
      const item = items[index++];

      try {
        const url = await generateThumbnail(item.prompt, sogniClient, signal);
        if (!signal?.aborted) {
          onResult({ id: item.id, url });
        }
      } catch (err) {
        if (signal?.aborted) return;
        console.warn(`[ThumbnailService] Failed to generate thumbnail for ${item.id}:`, err);
      }
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrent, items.length) }, () => runNext());
  await Promise.all(workers);
}
