import React, { createContext, useContext, useCallback, useState, useEffect, useRef } from 'react';
import type {
  AppView,
  AppSettings,
  AuthState,
  Gender,
  GenerationProgress,
  GenerationResult,
  HistoryItem,
  Transformation,
  TransformationCategory,
  GenerationParams,
} from '@/types';
import { DEFAULT_SETTINGS, GENERATION_DEFAULTS, DEMO_MODE_LIMITS, getModelOption } from '@/constants/settings';
import {
  getDemoGenerationCount,
  incrementDemoGenerationCount,
  getTransformationHistory as getStoredHistory,
  saveTransformationHistory,
  clearTransformationHistory as clearStoredHistory,
  getSettingFromStorage,
  saveSettingToStorage,
  removeSettingFromStorage,
} from '@/utils/cookies';
import { useAutoEnhance } from '@/hooks/useAutoEnhance';
import { getURLs } from '@/config/urls';
import { sogniAuth } from '@/services/sogniAuth';
import { FrontendSogniClientAdapter } from '@/services/frontendSogniAdapter';
import { getPaymentMethod } from '@/services/walletService';
import type { EditMode } from '@/types';
import { useEditStack } from '@/hooks/useEditStack';
import type { UseEditStackReturn } from '@/hooks/useEditStack';
import { fetchImageAsBase64 } from '@/utils/image';

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface AppContextValue {
  // Navigation
  currentView: AppView;
  setCurrentView: (view: AppView) => void;

  // Gender
  selectedGender: Gender | null;
  setSelectedGender: (gender: Gender) => void;

  // Auth
  authState: AuthState;
  setAuthState: (state: AuthState) => void;

  // Original image
  originalImage: File | null;
  setOriginalImage: (file: File | null) => void;
  originalImageUrl: string | null;
  originalImageBase64: string | null;

  // Transformation
  currentTransformation: Transformation | null;
  setCurrentTransformation: (t: Transformation | null) => void;

  // Generation state
  generationProgress: GenerationProgress | null;
  setGenerationProgress: (progress: GenerationProgress | null) => void;
  isGenerating: boolean;
  currentResult: GenerationResult | null;

  // Edit stack
  editStack: UseEditStackReturn;

  // History
  history: HistoryItem[];
  addToHistory: (item: HistoryItem) => void;
  clearHistory: () => void;

  // Settings
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;

  // SDK client (typed loosely so consumers do not need to import SDK types)
  sogniClient: unknown;
  initializeSogniClient: (client: unknown) => void;

  // Actions
  generateMakeover: (transformation: Transformation) => Promise<void>;
  generateFromPrompt: (params: {
    prompt: string;
    intensity?: number;
    negativePrompt?: string;
    useStackedInput?: boolean;
  }) => Promise<{ resultUrl: string; projectId: string }>;
  cancelGeneration: () => void;
  resetPhoto: () => void;
  logout: () => Promise<void>;
  resetSettings: () => void;

  // Auto-enhance
  enhancePhoto: (imageBase64: string, client: unknown, isAuthenticated: boolean) => Promise<{ imageUrl: string } | null>;
  enhanceProgress: import('@/types').GenerationProgress | null;
  isEnhancing: boolean;
  cancelEnhancement: () => void;

  // Demo mode
  demoGenerationsRemaining: number;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

/**
 * Hook to consume the AppContext. Must be used inside AppProvider.
 */
export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AppProviderProps {
  children: React.ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  // -- Navigation --
  const [currentView, setCurrentView] = useState<AppView>('landing');

  // -- Gender --
  const [selectedGender, setSelectedGenderRaw] = useState<Gender | null>(null);
  const setSelectedGender = useCallback((gender: Gender) => {
    setSelectedGenderRaw(gender);
  }, []);

  // -- Auth --
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: false,
    user: null,
    authMode: 'demo',
    error: null,
  });

  // -- Original image --
  const [originalImage, setOriginalImageRaw] = useState<File | null>(null);
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [originalImageBase64, setOriginalImageBase64] = useState<string | null>(null);

  // -- Transformation --
  const [currentTransformation, setCurrentTransformation] = useState<Transformation | null>(null);

  // -- Generation --
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [currentResult, setCurrentResult] = useState<GenerationResult | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // -- History --
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // -- Settings --
  const [settings, setSettings] = useState<AppSettings>(() => {
    const savedModel = getSettingFromStorage<string>('defaultModel', DEFAULT_SETTINGS.defaultModel);
    const modelOption = getModelOption(savedModel);
    return {
      ...DEFAULT_SETTINGS,
      defaultModel: modelOption.value,
      defaultSteps: modelOption.defaults.steps,
      defaultGuidance: modelOption.defaults.guidance,
      defaultSampler: modelOption.defaults.sampler,
      defaultScheduler: modelOption.defaults.scheduler,
      autoEnhanceWebcam: getSettingFromStorage<boolean>('autoEnhanceWebcam', DEFAULT_SETTINGS.autoEnhanceWebcam),
    };
  });

  // -- Auto-enhance --
  const { enhancePhoto, enhanceProgress, isEnhancing, cancelEnhancement } = useAutoEnhance();

  // -- Edit stack --
  const editStack = useEditStack();

  // Ref to hold current input image for generation.
  // Avoids adding editStack to generateMakeover's dependency array.
  const editStackInputRef = useRef<{
    mode: EditMode;
    currentStepBase64: string | null;
    currentStepUrl: string | null;
  }>({ mode: 'stacked', currentStepBase64: null, currentStepUrl: null });

  editStackInputRef.current = {
    mode: editStack.mode,
    currentStepBase64: editStack.currentStep?.resultImageBase64 ?? null,
    currentStepUrl: editStack.currentStep?.resultImageUrl ?? null,
  };

  // -- SDK client --
  const [sogniClient, setSogniClient] = useState<unknown>(null);

  // -- Demo mode --
  const [demoGenerationsRemaining, setDemoGenerationsRemaining] = useState<number>(
    Math.max(0, DEMO_MODE_LIMITS.maxFreeGenerations - getDemoGenerationCount()),
  );

  // -----------------------------------------------------------------------
  // Sync auth state with sogniAuth singleton on mount + subscribe to changes
  // -----------------------------------------------------------------------
  useEffect(() => {
    // Map sogniAuth state shape to AppContext AuthState shape
    const mapAuthState = (state: ReturnType<typeof sogniAuth.getAuthState>) => {
      const user = state.user && state.user.username
        ? { id: state.user.username, username: state.user.username, email: state.user.email }
        : null;
      setAuthState({
        isAuthenticated: state.isAuthenticated,
        isLoading: state.isLoading,
        user,
        authMode: state.authMode ?? 'demo',
        error: state.error,
        sessionTransferred: state.sessionTransferred,
      });
      if (state.isAuthenticated) {
        const rawClient = sogniAuth.getSogniClient();
        if (rawClient) setSogniClient(new FrontendSogniClientAdapter(rawClient));
      } else {
        setSogniClient(null);
      }
    };

    // Wait for sogniAuth to finish its initial session check, then sync
    sogniAuth.waitForInitialization().then(() => {
      mapAuthState(sogniAuth.getAuthState());
    });

    // Subscribe to ongoing auth state changes (login, logout, etc.)
    const unsubscribe = sogniAuth.onAuthStateChange(mapAuthState);

    return unsubscribe;
  }, []);

  // -----------------------------------------------------------------------
  // Load persisted history on mount
  // -----------------------------------------------------------------------
  useEffect(() => {
    const stored = getStoredHistory();
    if (stored.length > 0) {
      setHistory(
        stored.map((entry) => ({
          id: entry.id,
          originalImage: entry.sourceImageUrl,
          resultImage: entry.resultImageUrl,
          transformation: {
            id: entry.id,
            name: entry.name || entry.prompt.slice(0, 30),
            category: (entry.category || 'hairstyles') as TransformationCategory,
            subcategory: entry.subcategory || 'style',
            prompt: entry.prompt,
            icon: entry.icon || '\uD83D\uDD04',
          },
          timestamp: entry.timestamp,
          duration: 0,
        })),
      );
    }
  }, []);

  // -----------------------------------------------------------------------
  // Revoke object URL when original image changes
  // -----------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (originalImageUrl) {
        URL.revokeObjectURL(originalImageUrl);
      }
    };
  }, [originalImageUrl]);

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------
  const isGenerating =
    generationProgress !== null &&
    generationProgress.status !== 'completed' &&
    generationProgress.status !== 'error' &&
    generationProgress.status !== 'cancelled';

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  /**
   * Set the original image file. Generates an object URL and base64 representation.
   */
  const setOriginalImage = useCallback((file: File | null) => {
    if (!file) {
      setOriginalImageRaw(null);
      setOriginalImageUrl(null);
      setOriginalImageBase64(null);
      return;
    }

    setOriginalImageRaw(file);
    setOriginalImageUrl(URL.createObjectURL(file));

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        // Strip data URL prefix to get raw base64
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        setOriginalImageBase64(base64);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  /**
   * Reset the photo back to capture state.
   */
  const resetPhoto = useCallback(() => {
    setOriginalImageRaw(null);
    setOriginalImageUrl(null);
    setOriginalImageBase64(null);
    setCurrentTransformation(null);
    setGenerationProgress(null);
    setCurrentResult(null);
    editStack.reset();
    setCurrentView('capture');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editStack.reset is a stable callback (useCallback with [] deps)
  }, []);

  /**
   * Store the Sogni SDK client instance for direct frontend generation.
   */
  const initializeSogniClient = useCallback((client: unknown) => {
    setSogniClient(client);
  }, []);

  /**
   * Add a completed generation to history.
   */
  const addToHistory = useCallback((item: HistoryItem) => {
    setHistory((prev) => {
      const updated = [item, ...prev].slice(0, 50);
      return updated;
    });

    saveTransformationHistory({
      id: item.id,
      timestamp: item.timestamp,
      prompt: item.transformation.prompt,
      name: item.transformation.name,
      icon: item.transformation.icon,
      subcategory: item.transformation.subcategory,
      sourceImageUrl: item.originalImage,
      resultImageUrl: item.resultImage,
      modelId: settings.defaultModel,
      width: settings.defaultWidth,
      height: settings.defaultHeight,
      category: item.transformation.category,
    });
  }, [settings.defaultModel, settings.defaultWidth, settings.defaultHeight]);

  /**
   * Clear all history.
   */
  const clearHistory = useCallback(() => {
    setHistory([]);
    clearStoredHistory();
  }, []);

  /**
   * Cancel an in-progress generation.
   */
  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setGenerationProgress((prev) => {
      if (!prev) return null;
      return { ...prev, status: 'cancelled', message: 'Generation cancelled' };
    });
  }, []);

  /**
   * Log out the current user, cancel any in-progress generation, and return to landing.
   */
  const logout = useCallback(async () => {
    // Cancel any in-progress generation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setGenerationProgress(null);
    setCurrentResult(null);
    setCurrentTransformation(null);

    await sogniAuth.logout();

    setCurrentView('landing');
  }, []);

  /**
   * Reset settings to defaults.
   */
  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    removeSettingFromStorage('autoEnhanceWebcam');
    removeSettingFromStorage('defaultModel');
  }, []);

  /**
   * Update a single setting and persist to localStorage if applicable.
   */
  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (key === 'defaultModel') {
      // Switching models — cascade the related defaults
      const modelOption = getModelOption(value as string);
      setSettings((prev) => ({
        ...prev,
        defaultModel: modelOption.value,
        defaultSteps: modelOption.defaults.steps,
        defaultGuidance: modelOption.defaults.guidance,
        defaultSampler: modelOption.defaults.sampler,
        defaultScheduler: modelOption.defaults.scheduler,
      }));
      saveSettingToStorage('defaultModel', modelOption.value);
    } else {
      setSettings((prev) => ({ ...prev, [key]: value }));
      if (key === 'autoEnhanceWebcam') {
        saveSettingToStorage('autoEnhanceWebcam', value);
      }
    }
  }, []);

  /**
   * Run a makeover generation for the given transformation.
   *
   * Flow:
   * 1. Check demo limits if not authenticated
   * 2. Build GenerationParams from transformation + settings + originalImage
   * 3. POST to backend API (or use sogniClient directly if authenticated)
   * 4. Listen for SSE progress events
   * 5. On completion, create HistoryItem, set currentResult, navigate to results
   * 6. Handle errors via toast / progress status
   */
  const generateMakeover = useCallback(
    async (transformation: Transformation) => {
      // 1. Demo gate check
      if (!authState.isAuthenticated) {
        const currentCount = getDemoGenerationCount();
        if (currentCount >= DEMO_MODE_LIMITS.maxFreeGenerations) {
          setGenerationProgress({
            projectId: '',
            status: 'error',
            progress: 0,
            message: DEMO_MODE_LIMITS.softGateMessage,
          });
          return;
        }
      }

      if (!originalImageBase64) {
        setGenerationProgress({
          projectId: '',
          status: 'error',
          progress: 0,
          message: 'No image selected. Please capture or upload a photo first.',
        });
        return;
      }

      // Determine input image: stacked mode uses previous result, original mode uses original
      let inputBase64 = originalImageBase64;
      const { mode: stackMode, currentStepBase64, currentStepUrl } = editStackInputRef.current;
      if (stackMode === 'stacked' && currentStepBase64) {
        inputBase64 = currentStepBase64;
      } else if (stackMode === 'stacked' && currentStepUrl) {
        // Base64 not yet cached — fetch on demand
        try {
          inputBase64 = await fetchImageAsBase64(currentStepUrl);
        } catch {
          // Fall back to original if fetch fails
          console.warn('Failed to fetch stacked image, falling back to original');
        }
      }

      // 2. Build params
      const negativePrompt = transformation.negativePrompt ?? GENERATION_DEFAULTS.negativePrompt;
      const params: GenerationParams = {
        modelId: settings.defaultModel,
        positivePrompt: transformation.prompt,
        negativePrompt,
        contextImages: [inputBase64],
        width: settings.defaultWidth,
        height: settings.defaultHeight,
        guidance: settings.defaultGuidance,
        steps: settings.defaultSteps,
        sampler: settings.defaultSampler,
        scheduler: settings.defaultScheduler,
        outputFormat: settings.outputFormat,
        numberOfMedia: GENERATION_DEFAULTS.numberOfMedia,
        denoisingStrength: transformation.intensity,
        tokenType: authState.isAuthenticated ? getPaymentMethod() : undefined,
      };

      // 3. Set generating state
      setCurrentTransformation(transformation);
      setCurrentResult(null);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const startTime = Date.now();

      setGenerationProgress({
        projectId: '',
        status: 'uploading',
        progress: 0,
        message: 'Uploading image...',
      });

      try {
        // ---------------------------------------------------------------
        // Path A: Frontend SDK (authenticated user with initialized client)
        // ---------------------------------------------------------------
        /* eslint-disable @typescript-eslint/no-explicit-any */
        if (sogniClient && (sogniClient as any).projects) {
          const client = sogniClient as any;

          const project = await client.projects.create(params);
          const projectId: string = project.id;

          setGenerationProgress({
            projectId,
            status: 'queued',
            progress: 5,
            message: 'Queued for processing...',
          });

          // Event handlers for cleanup
          const onAbort = () => {
            try { project.cancel(); } catch { /* best-effort cancel */ }
          };

          const onJob = (event: any) => {
            if (abortController.signal.aborted) return;

            if (event.type === 'progress') {
              const normalised = typeof event.progress === 'number' ? event.progress : 0;
              setGenerationProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      status: 'generating',
                      progress: Math.min(95, Math.round(normalised * 100)),
                      message: event.workerName ? `Generating on ${event.workerName}...` : 'Generating...',
                      workerName: event.workerName,
                    }
                  : prev,
              );
            } else if (event.type === 'queued') {
              setGenerationProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      status: 'queued',
                      progress: 10,
                      message: event.queuePosition
                        ? `Queued (position ${event.queuePosition})...`
                        : 'Queued for processing...',
                    }
                  : prev,
              );
            }
          };

          const onJobCompleted = (event: any) => {
            if (abortController.signal.aborted) return;

            const imageUrl = event.resultUrl || event.previewUrl;
            if (imageUrl && !event.isPreview) {
              setGenerationProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      status: 'generating',
                      progress: 90,
                      message: 'Job completed, finalizing...',
                      previewUrl: imageUrl,
                    }
                  : prev,
              );
            } else if (imageUrl && event.isPreview) {
              setGenerationProgress((prev) =>
                prev
                  ? { ...prev, previewUrl: imageUrl }
                  : prev,
              );
            }
          };

          const onFailed = (error: any) => {
            if (abortController.signal.aborted) return;
            let msg = 'Generation failed';
            if (typeof error === 'string') {
              msg = error;
            } else if (error instanceof Error) {
              msg = error.message;
            } else if (error && typeof error === 'object' && typeof error.message === 'string') {
              msg = error.message;
            }
            setGenerationProgress({
              projectId,
              status: 'error',
              progress: 0,
              message: msg,
            });
          };

          // Register listeners
          abortController.signal.addEventListener('abort', onAbort);
          project.on('job', onJob);
          project.on('jobCompleted', onJobCompleted);
          project.on('failed', onFailed);
          project.on('error', onFailed);

          try {
            // Wait for project completion
            await project.waitForCompletion();
          } finally {
            // Clean up all listeners
            abortController.signal.removeEventListener('abort', onAbort);
            project.off('job', onJob);
            project.off('jobCompleted', onJobCompleted);
            project.off('failed', onFailed);
            project.off('error', onFailed);
          }

          if (abortController.signal.aborted) return;

          // Extract the result image URL from completed jobs
          const jobs = project.jobs || [];
          const completedJob = jobs.find((j: any) => j.resultUrl) || jobs[0];
          const resultImageUrl = completedJob?.resultUrl || '';

          const duration = Date.now() - startTime;

          const result: GenerationResult = {
            projectId,
            imageUrl: resultImageUrl,
            thumbnailUrl: undefined,
            timestamp: Date.now(),
            transformation,
            duration,
          };

          setCurrentResult(result);
          setGenerationProgress({
            projectId,
            status: 'completed',
            progress: 100,
            message: 'Makeover complete!',
          });

          // Push to edit stack and start base64 pre-fetch
          editStack.pushStep({
            transformation,
            resultImageUrl: resultImageUrl,
            resultImageBase64: '',
            timestamp: Date.now(),
          });

          fetchImageAsBase64(resultImageUrl).then(base64 => {
            editStack.updateLatestBase64(base64);
          }).catch(() => {
            // Non-critical — will be fetched on-demand if needed
          });

          // Build history item
          const historyItem: HistoryItem = {
            id: `${projectId}-${Date.now()}`,
            originalImage: originalImageUrl ?? '',
            resultImage: result.imageUrl,
            transformation,
            timestamp: Date.now(),
            duration,
          };

          setHistory((prev) => [historyItem, ...prev].slice(0, 50));
          saveTransformationHistory({
            id: historyItem.id,
            timestamp: historyItem.timestamp,
            prompt: transformation.prompt,
            sourceImageUrl: historyItem.originalImage,
            resultImageUrl: historyItem.resultImage,
            modelId: settings.defaultModel,
            width: settings.defaultWidth,
            height: settings.defaultHeight,
            category: transformation.category,
          });

        } else {
          // ---------------------------------------------------------------
          // Path B: Backend proxy via SSE (demo / unauthenticated)
          // ---------------------------------------------------------------
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
            const errorMessage =
              (errorData as Record<string, string>).error || `Server error: ${response.status}`;
            throw new Error(errorMessage);
          }

          const data = (await response.json()) as {
            projectId: string;
            clientAppId?: string;
          };

          const { projectId } = data;

          setGenerationProgress({
            projectId,
            status: 'queued',
            progress: 5,
            message: 'Queued for processing...',
          });

          // 4. Listen for SSE progress
          const clientAppId = data.clientAppId ?? '';
          const sseUrl = `${urls.apiUrl}/api/sogni/progress/${projectId}?clientAppId=${encodeURIComponent(clientAppId)}`;

          await new Promise<void>((resolve, reject) => {
            const eventSource = new EventSource(sseUrl, { withCredentials: true });

            const cleanup = () => {
              eventSource.close();
            };

            abortController.signal.addEventListener('abort', () => {
              cleanup();
              reject(new DOMException('Aborted', 'AbortError'));
            });

            eventSource.addEventListener('connected', () => {
              setGenerationProgress((prev) =>
                prev ? { ...prev, status: 'queued', progress: 10, message: 'Connected to worker...' } : prev,
              );
            });

            eventSource.addEventListener('queued', (event) => {
              try {
                const queuedData = JSON.parse(event.data) as { queuePosition?: number };
                setGenerationProgress((prev) =>
                  prev
                    ? {
                        ...prev,
                        status: 'queued',
                        progress: 10,
                        message: queuedData.queuePosition
                          ? `Queued (position ${queuedData.queuePosition})...`
                          : 'Queued for processing...',
                      }
                    : prev,
                );
              } catch {
                // Ignore parse errors
              }
            });

            eventSource.addEventListener('progress', (event) => {
              try {
                const progressData = JSON.parse(event.data) as {
                  progress?: number;
                  message?: string;
                  eta?: number;
                  previewUrl?: string;
                  workerName?: string;
                };
                // Backend sends progress as 0-1 float, scale to 0-100
                const scaledProgress =
                  typeof progressData.progress === 'number'
                    ? Math.min(95, Math.round(progressData.progress * 100))
                    : undefined;
                setGenerationProgress((prev) =>
                  prev
                    ? {
                        ...prev,
                        status: 'generating',
                        progress: scaledProgress ?? prev.progress,
                        message: progressData.message ?? 'Generating...',
                        eta: progressData.eta,
                        previewUrl: progressData.previewUrl ?? prev.previewUrl,
                        workerName: progressData.workerName,
                      }
                    : prev,
                );
              } catch {
                // Ignore parse errors for progress events
              }
            });

            eventSource.addEventListener('preview', (event) => {
              try {
                const previewData = JSON.parse(event.data) as {
                  previewUrl?: string;
                  resultUrl?: string;
                };
                const imageUrl = previewData.previewUrl || previewData.resultUrl;
                if (imageUrl) {
                  setGenerationProgress((prev) =>
                    prev ? { ...prev, previewUrl: imageUrl } : prev,
                  );
                }
              } catch {
                // Ignore parse errors
              }
            });

            eventSource.addEventListener('jobCompleted', (event) => {
              try {
                const jobData = JSON.parse(event.data) as {
                  imageUrl?: string;
                  thumbnailUrl?: string;
                };
                if (jobData.imageUrl) {
                  setGenerationProgress((prev) =>
                    prev
                      ? {
                          ...prev,
                          status: 'generating',
                          progress: 90,
                          message: 'Job completed, finalizing...',
                          previewUrl: jobData.imageUrl,
                        }
                      : prev,
                  );
                }
              } catch {
                // Ignore parse errors
              }
            });

            eventSource.addEventListener('complete', (event) => {
              cleanup();
              try {
                const completeData = JSON.parse(event.data) as {
                  imageUrl?: string;
                  thumbnailUrl?: string;
                  cost?: number;
                };

                const duration = Date.now() - startTime;

                const result: GenerationResult = {
                  projectId,
                  imageUrl: completeData.imageUrl ?? '',
                  thumbnailUrl: completeData.thumbnailUrl,
                  timestamp: Date.now(),
                  transformation,
                  duration,
                  cost: completeData.cost,
                };

                setCurrentResult(result);
                setGenerationProgress({
                  projectId,
                  status: 'completed',
                  progress: 100,
                  message: 'Makeover complete!',
                });

                // Push to edit stack and start base64 pre-fetch
                editStack.pushStep({
                  transformation,
                  resultImageUrl: result.imageUrl,
                  resultImageBase64: '',
                  timestamp: Date.now(),
                });

                fetchImageAsBase64(result.imageUrl).then(base64 => {
                  editStack.updateLatestBase64(base64);
                }).catch(() => {
                  // Non-critical
                });

                // Build history item
                const historyItem: HistoryItem = {
                  id: `${projectId}-${Date.now()}`,
                  originalImage: originalImageUrl ?? '',
                  resultImage: result.imageUrl,
                  transformation,
                  timestamp: Date.now(),
                  duration,
                  cost: completeData.cost,
                };

                // Add to history
                setHistory((prev) => [historyItem, ...prev].slice(0, 50));
                saveTransformationHistory({
                  id: historyItem.id,
                  timestamp: historyItem.timestamp,
                  prompt: transformation.prompt,
                  sourceImageUrl: historyItem.originalImage,
                  resultImageUrl: historyItem.resultImage,
                  modelId: settings.defaultModel,
                  width: settings.defaultWidth,
                  height: settings.defaultHeight,
                  category: transformation.category,
                });

                // Consume demo generation if in demo mode
                if (!authState.isAuthenticated) {
                  const newCount = incrementDemoGenerationCount();
                  const remaining = Math.max(
                    0,
                    DEMO_MODE_LIMITS.maxFreeGenerations - newCount,
                  );
                  setDemoGenerationsRemaining(remaining);
                }

                resolve();
              } catch {
                reject(new Error('Failed to parse completion data'));
              }
            });

            eventSource.addEventListener('error', (event) => {
              cleanup();
              let errorMessage = 'Generation failed';
              try {
                if ('data' in event && typeof (event as MessageEvent).data === 'string') {
                  const errorData = JSON.parse((event as MessageEvent).data) as {
                    message?: string;
                  };
                  errorMessage = errorData.message ?? errorMessage;
                }
              } catch {
                // Use default error message
              }
              reject(new Error(errorMessage));
            });

            eventSource.onerror = () => {
              cleanup();
              reject(new Error('Connection to generation server lost'));
            };
          });
        }
        /* eslint-enable @typescript-eslint/no-explicit-any */
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // User cancelled - already handled
          return;
        }

        let errorMessage = 'An unexpected error occurred';
        if (err instanceof Error) {
          errorMessage = err.message;
        } else if (err && typeof err === 'object' && 'message' in err && typeof (err as Record<string, unknown>).message === 'string') {
          errorMessage = (err as Record<string, string>).message;
        } else if (typeof err === 'string') {
          errorMessage = err;
        }
        setGenerationProgress({
          projectId: '',
          status: 'error',
          progress: 0,
          message: errorMessage,
        });
      } finally {
        abortControllerRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editStack methods are stable callbacks; editStackInputRef is used via ref
    [
      authState.isAuthenticated,
      originalImageBase64,
      originalImageUrl,
      sogniClient,
      settings.defaultModel,
      settings.defaultWidth,
      settings.defaultHeight,
      settings.defaultGuidance,
      settings.defaultSteps,
      settings.defaultSampler,
      settings.defaultScheduler,
      settings.outputFormat,
    ],
  );

  /**
   * Simplified generation interface for chat tools.
   * Constructs a synthetic Transformation and delegates to generateMakeover.
   */
  const generateFromPrompt = useCallback(
    async (params: {
      prompt: string;
      intensity?: number;
      negativePrompt?: string;
      useStackedInput?: boolean;
    }): Promise<{ resultUrl: string; projectId: string }> => {
      // Temporarily switch edit stack mode if needed
      const prevMode = editStack.mode;
      if (params.useStackedInput) {
        editStack.setMode('stacked');
      } else {
        editStack.setMode('original');
      }

      const syntheticTransformation: Transformation = {
        id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: params.prompt.slice(0, 30) + (params.prompt.length > 30 ? '...' : ''),
        category: 'ai-generated' as TransformationCategory,
        subcategory: 'chat',
        prompt: params.prompt,
        icon: '\uD83E\uDD16',
        intensity: params.intensity,
        negativePrompt: params.negativePrompt,
      };

      await generateMakeover(syntheticTransformation);

      // Restore edit stack mode
      if (prevMode !== editStack.mode) {
        editStack.setMode(prevMode);
      }

      // Extract result from current state
      // The result is set by generateMakeover via setCurrentResult
      const stack = editStack.steps;
      const latestStep = stack[stack.length - 1];

      return {
        resultUrl: latestStep?.resultImageUrl || '',
        projectId: '',
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editStack methods are stable callbacks
    [generateMakeover],
  );

  // -----------------------------------------------------------------------
  // Context value
  // -----------------------------------------------------------------------

  return (
    <AppContext.Provider
      value={{
        currentView,
        setCurrentView,
        selectedGender,
        setSelectedGender,
        authState,
        setAuthState,
        originalImage,
        setOriginalImage,
        originalImageUrl,
        originalImageBase64,
        currentTransformation,
        setCurrentTransformation,
        generationProgress,
        setGenerationProgress,
        isGenerating,
        currentResult,
        editStack,
        history,
        addToHistory,
        clearHistory,
        settings,
        updateSetting,
        sogniClient,
        initializeSogniClient,
        generateMakeover,
        generateFromPrompt,
        cancelGeneration,
        resetPhoto,
        logout,
        resetSettings,
        enhancePhoto,
        enhanceProgress,
        isEnhancing,
        cancelEnhancement,
        demoGenerationsRemaining,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export default AppContext;
