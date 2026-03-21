import { useState, useRef, useCallback } from 'react';
import type { GenerationProgress, GenerationParams, AppSettings } from '@/types';
import { DEFAULT_SETTINGS, GENERATION_DEFAULTS, AUTO_ENHANCE_CONFIG, getModelOption } from '@/constants/settings';
import { getURLs } from '@/config/urls';
import { getPaymentMethod } from '@/services/walletService';

export interface AutoEnhanceResult {
  imageUrl: string;
}

export interface UseAutoEnhanceReturn {
  enhancePhoto: (
    imageBase64: string,
    client: unknown,
    isAuthenticated: boolean,
    settings?: AppSettings,
  ) => Promise<AutoEnhanceResult | null>;
  enhanceProgress: GenerationProgress | null;
  isEnhancing: boolean;
  cancelEnhancement: () => void;
}

export function useAutoEnhance(): UseAutoEnhanceReturn {
  const [enhanceProgress, setEnhanceProgress] = useState<GenerationProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isEnhancing =
    enhanceProgress !== null &&
    enhanceProgress.status !== 'completed' &&
    enhanceProgress.status !== 'error' &&
    enhanceProgress.status !== 'cancelled';

  const cancelEnhancement = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setEnhanceProgress(null);
  }, []);

  const enhancePhoto = useCallback(
    async (
      imageBase64: string,
      client: unknown,
      isAuthenticated: boolean,
      settings?: AppSettings,
      customPrompt?: string,
    ): Promise<AutoEnhanceResult | null> => {
      const abortController = new AbortController();
      abortRef.current = abortController;

      // Use the user's selected model and its defaults when available
      const modelId = settings?.defaultModel ?? DEFAULT_SETTINGS.defaultModel;
      const modelDefaults = getModelOption(modelId).defaults;

      const params: GenerationParams = {
        modelId,
        positivePrompt: customPrompt ?? '',
        negativePrompt: AUTO_ENHANCE_CONFIG.negativePrompt,
        contextImages: [imageBase64],
        width: DEFAULT_SETTINGS.defaultWidth,
        height: DEFAULT_SETTINGS.defaultHeight,
        guidance: AUTO_ENHANCE_CONFIG.guidance,
        steps: modelDefaults.steps,
        sampler: modelDefaults.sampler,
        scheduler: modelDefaults.scheduler,
        outputFormat: DEFAULT_SETTINGS.outputFormat,
        numberOfMedia: GENERATION_DEFAULTS.numberOfMedia,

        tokenType: isAuthenticated ? getPaymentMethod() : undefined,
      };

      setEnhanceProgress({
        projectId: '',
        status: 'uploading',
        progress: 0,
        message: 'Enhancing photo...',
      });

      try {
        // -----------------------------------------------------------------
        // Path A: Frontend SDK (authenticated user with initialized client)
        // -----------------------------------------------------------------
        /* eslint-disable @typescript-eslint/no-explicit-any */
        if (client && (client as any).projects) {
          const sdk = client as any;
          const project = await sdk.projects.create(params);
          const projectId: string = project.id;

          setEnhanceProgress({
            projectId,
            status: 'queued',
            progress: 5,
            message: 'Enhancing photo...',
          });

          const onAbort = () => {
            try { project.cancel(); } catch { /* best-effort */ }
          };

          const onJob = (event: any) => {
            if (abortController.signal.aborted) return;
            if (event.type === 'progress') {
              const normalised = typeof event.progress === 'number' ? event.progress : 0;
              setEnhanceProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      status: 'generating',
                      progress: Math.min(95, Math.round(normalised * 100)),
                      message: 'Enhancing photo...',
                      workerName: event.workerName,
                    }
                  : prev,
              );
            } else if (event.type === 'queued') {
              setEnhanceProgress((prev) =>
                prev
                  ? { ...prev, status: 'queued', progress: 10, message: 'Enhancing photo...' }
                  : prev,
              );
            }
          };

          const onJobCompleted = (event: any) => {
            if (abortController.signal.aborted) return;
            const imageUrl = event.resultUrl || event.previewUrl;
            if (imageUrl && !event.isPreview) {
              setEnhanceProgress((prev) =>
                prev
                  ? { ...prev, status: 'generating', progress: 90, message: 'Finalizing...' }
                  : prev,
              );
            }
          };

          const onFailed = (error: any) => {
            if (abortController.signal.aborted) return;
            let msg = 'Enhancement failed';
            if (typeof error === 'string') msg = error;
            else if (error instanceof Error) msg = error.message;
            else if (error && typeof error === 'object' && typeof error.message === 'string') msg = error.message;
            setEnhanceProgress({ projectId, status: 'error', progress: 0, message: msg });
          };

          abortController.signal.addEventListener('abort', onAbort);
          project.on('job', onJob);
          project.on('jobCompleted', onJobCompleted);
          project.on('failed', onFailed);
          project.on('error', onFailed);

          try {
            await project.waitForCompletion();
          } finally {
            abortController.signal.removeEventListener('abort', onAbort);
            project.off('job', onJob);
            project.off('jobCompleted', onJobCompleted);
            project.off('failed', onFailed);
            project.off('error', onFailed);
          }

          if (abortController.signal.aborted) return null;

          const jobs = project.jobs || [];
          const completedJob = jobs.find((j: any) => j.resultUrl) || jobs[0];
          const resultImageUrl = completedJob?.resultUrl || '';
          /* eslint-enable @typescript-eslint/no-explicit-any */

          if (!resultImageUrl) {
            setEnhanceProgress({ projectId, status: 'error', progress: 0, message: 'No result from enhancement' });
            return null;
          }

          setEnhanceProgress({ projectId, status: 'completed', progress: 100, message: 'Enhancement complete!' });
          return { imageUrl: resultImageUrl };
        }

        // -----------------------------------------------------------------
        // Path B: Backend proxy via SSE (demo / unauthenticated)
        // -----------------------------------------------------------------
        const urls = getURLs();
        const response = await fetch(`${urls.apiUrl}/api/sogni/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
          signal: abortController.signal,
          credentials: 'include',
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = (errorData as Record<string, string>).error || `Server error: ${response.status}`;
          throw new Error(errorMessage);
        }

        const data = (await response.json()) as { projectId: string; clientAppId?: string };
        const { projectId } = data;

        setEnhanceProgress({ projectId, status: 'queued', progress: 5, message: 'Enhancing photo...' });

        const clientAppId = data.clientAppId ?? '';
        const sseUrl = `${urls.apiUrl}/api/sogni/progress/${projectId}?clientAppId=${encodeURIComponent(clientAppId)}`;

        const result = await new Promise<AutoEnhanceResult | null>((resolve, reject) => {
          const eventSource = new EventSource(sseUrl, { withCredentials: true });

          const cleanup = () => { eventSource.close(); };

          abortController.signal.addEventListener('abort', () => {
            cleanup();
            reject(new DOMException('Aborted', 'AbortError'));
          });

          eventSource.addEventListener('connected', () => {
            setEnhanceProgress((prev) =>
              prev ? { ...prev, status: 'queued', progress: 10, message: 'Enhancing photo...' } : prev,
            );
          });

          eventSource.addEventListener('progress', (event) => {
            try {
              const progressData = JSON.parse(event.data) as {
                progress?: number;
                workerName?: string;
              };
              const scaledProgress =
                typeof progressData.progress === 'number'
                  ? Math.min(95, Math.round(progressData.progress * 100))
                  : undefined;
              setEnhanceProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      status: 'generating',
                      progress: scaledProgress ?? prev.progress,
                      message: 'Enhancing photo...',
                      workerName: progressData.workerName,
                    }
                  : prev,
              );
            } catch { /* ignore parse errors */ }
          });

          eventSource.addEventListener('jobCompleted', (event) => {
            try {
              const jobData = JSON.parse(event.data) as { imageUrl?: string };
              if (jobData.imageUrl) {
                setEnhanceProgress((prev) =>
                  prev
                    ? { ...prev, status: 'generating', progress: 90, message: 'Finalizing...' }
                    : prev,
                );
              }
            } catch { /* ignore */ }
          });

          eventSource.addEventListener('complete', (event) => {
            cleanup();
            try {
              const completeData = JSON.parse(event.data) as { imageUrl?: string };
              const imageUrl = completeData.imageUrl ?? '';

              if (!imageUrl) {
                setEnhanceProgress({ projectId, status: 'error', progress: 0, message: 'No result from enhancement' });
                resolve(null);
                return;
              }

              setEnhanceProgress({ projectId, status: 'completed', progress: 100, message: 'Enhancement complete!' });
              resolve({ imageUrl });
            } catch {
              reject(new Error('Failed to parse enhancement result'));
            }
          });

          eventSource.addEventListener('error', (event) => {
            cleanup();
            let errorMessage = 'Enhancement failed';
            try {
              if ('data' in event && typeof (event as MessageEvent).data === 'string') {
                const errorData = JSON.parse((event as MessageEvent).data) as { message?: string };
                errorMessage = errorData.message ?? errorMessage;
              }
            } catch { /* use default */ }
            reject(new Error(errorMessage));
          });

          eventSource.onerror = () => {
            cleanup();
            reject(new Error('Connection to enhancement server lost'));
          };
        });

        return result;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return null;
        }

        let errorMessage = 'Enhancement failed';
        if (err instanceof Error) errorMessage = err.message;
        else if (typeof err === 'string') errorMessage = err;

        setEnhanceProgress({ projectId: '', status: 'error', progress: 0, message: errorMessage });
        return null;
      } finally {
        abortRef.current = null;
      }
    },
    [],
  );

  return { enhancePhoto, enhanceProgress, isEnhancing, cancelEnhancement };
}
