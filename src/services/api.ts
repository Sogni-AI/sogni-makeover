/**
 * API service for communicating with the Sogni Makeover backend
 *
 * Simplified from the photobooth API service to support image-only generation
 * using the Qwen model. No controlNet, no enhancement, no video, no audio.
 */
import urls from '@/config/urls';
import { getOrCreateAppId as getAppId } from '@/utils/appId';

// --- Network connectivity detection ---

let isOnline = navigator.onLine;
let lastConnectionCheck = 0;
let connectivityCheckInProgress = false;

// Connection state management for UI feedback
type ConnectionState = 'online' | 'offline' | 'connecting' | 'timeout';
let currentConnectionState: ConnectionState = navigator.onLine ? 'online' : 'offline';
const connectionStateListeners: Array<(state: ConnectionState) => void> = [];

/**
 * Subscribe to connection state changes
 */
export function subscribeToConnectionState(listener: (state: ConnectionState) => void): () => void {
  connectionStateListeners.push(listener);
  return () => {
    const index = connectionStateListeners.indexOf(listener);
    if (index > -1) {
      connectionStateListeners.splice(index, 1);
    }
  };
}

/**
 * Notify all listeners of connection state change
 */
function notifyConnectionStateChange(newState: ConnectionState): void {
  if (currentConnectionState !== newState) {
    currentConnectionState = newState;
    console.log(`Connection state changed to: ${newState}`);
    connectionStateListeners.forEach(listener => {
      try {
        listener(newState);
      } catch (error) {
        console.warn('Error in connection state listener:', error);
      }
    });
  }
}

/**
 * Get current connection state
 */
export function getCurrentConnectionState(): ConnectionState {
  return currentConnectionState;
}

/**
 * Check if the device is currently online by testing connectivity
 */
async function checkConnectivity(): Promise<boolean> {
  const now = Date.now();
  if (connectivityCheckInProgress || (now - lastConnectionCheck < 2000)) {
    return isOnline;
  }

  connectivityCheckInProgress = true;
  lastConnectionCheck = now;

  try {
    const response = await fetch(`${API_BASE_URL}/sogni/status`, {
      method: 'HEAD',
      cache: 'no-cache',
      signal: AbortSignal.timeout(3000),
    });
    isOnline = response.ok;
    console.log(`Connectivity check: ${isOnline ? 'online' : 'offline'}`);
  } catch (error) {
    console.warn('Connectivity check failed:', error);
    isOnline = false;
  } finally {
    connectivityCheckInProgress = false;
  }

  return isOnline;
}

/**
 * Network error with additional context for better user feedback
 */
export class NetworkError extends Error {
  constructor(
    message: string,
    public isTimeout: boolean = false,
    public isOffline: boolean = false,
    public retryable: boolean = true
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

// Listen for online/offline events
window.addEventListener('online', () => {
  console.log('Device came online');
  isOnline = true;
});

window.addEventListener('offline', () => {
  console.log('Device went offline');
  isOnline = false;
});

// --- Module-level constants ---

const API_BASE_URL = urls.apiUrl;

// Get the app ID on module load
export const clientAppId = typeof window !== 'undefined' ? getAppId() : '';

// Throttle status checks
let lastStatusCheckTime = 0;
const STATUS_CHECK_THROTTLE_MS = 2000;
let hasConnectedToSogni = false;
let pendingStatusCheck: Promise<unknown> | null = null;

// Utility type guard
function isObjectRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

// --- Public API functions ---

/**
 * Notify the server of disconnect (explicit cleanup)
 */
export async function disconnectSession(): Promise<boolean> {
  try {
    if (!hasConnectedToSogni) {
      return true;
    }

    const response = await fetch(`${API_BASE_URL}/sogni/disconnect`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Client-App-ID': clientAppId
      },
      body: JSON.stringify({ clientAppId })
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check Sogni connection status (throttled)
 */
export async function checkSogniStatus(): Promise<unknown> {
  const now = Date.now();

  if (pendingStatusCheck) {
    console.log('Using existing pending status check');
    return pendingStatusCheck;
  }

  if (now - lastStatusCheckTime < STATUS_CHECK_THROTTLE_MS) {
    console.log(`Status check throttled - last check was ${Math.floor((now - lastStatusCheckTime) / 1000)}s ago`);
    return Promise.reject(new Error('Status check throttled'));
  }

  lastStatusCheckTime = now;

  pendingStatusCheck = (async () => {
    try {
      console.log('Checking Sogni status...');
      const response = await fetch(`${API_BASE_URL}/sogni/status`, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'X-Client-App-ID': clientAppId,
        }
      });

      if (!response.ok) {
        let errorDetails = '';
        try {
          const errorData: unknown = await response.json();
          if (isObjectRecord(errorData)) {
            errorDetails = (errorData as { message?: string }).message || (errorData as { error?: string }).error || 'Unknown error';
          } else {
            errorDetails = response.statusText;
          }
          console.error('Status check failed:', errorData);
        } catch {
          errorDetails = response.statusText;
        }
        throw new Error(`${response.status} ${String(errorDetails)}`);
      }

      const dataRaw: unknown = await response.json();
      const data: Record<string, unknown> = isObjectRecord(dataRaw) ? dataRaw : {};
      console.log('Sogni status check successful:', data);
      hasConnectedToSogni = true;
      return data;
    } catch (error) {
      console.error('Error checking Sogni status:', error);
      throw error;
    } finally {
      setTimeout(() => {
        pendingStatusCheck = null;
      }, 500);
    }
  })();

  return pendingStatusCheck;
}

// --- Project creation and image generation ---

/**
 * Parameters accepted by createProject for the Qwen image edit model
 */
export interface CreateProjectParams {
  modelId: string;
  positivePrompt: string;
  negativePrompt: string;
  contextImages: File | string; // File object or base64 string
  width: number;
  height: number;
  guidance: number;
  steps: number;
  sampler: string;
  scheduler: string;
  outputFormat: string;
  numberOfMedia: number;
  denoisingStrength: number;
}

/**
 * Create a project through the backend service.
 * Simplified for the Makeover app -- context-image based generation only.
 */
export async function createProject(
  params: CreateProjectParams,
  progressCallback?: (data: unknown) => void
): Promise<unknown> {
  try {
    // Process the context image into the format the backend expects
    let imageData: number[];

    if (params.contextImages instanceof File) {
      const arrayBuffer = await params.contextImages.arrayBuffer();
      imageData = Array.from(new Uint8Array(arrayBuffer));
      const sizeMB = (arrayBuffer.byteLength / 1024 / 1024).toFixed(2);
      console.log(`Context image transmitting to Sogni API: ${sizeMB}MB`);
    } else if (typeof params.contextImages === 'string') {
      // base64 string -- strip data URL prefix if present
      let raw = params.contextImages;
      const prefixMatch = raw.match(/^data:[^;]+;base64,(.+)$/);
      if (prefixMatch) {
        raw = prefixMatch[1];
      }
      const binaryStr = atob(raw);
      imageData = new Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        imageData[i] = binaryStr.charCodeAt(i);
      }
      const sizeMB = (imageData.length / 1024 / 1024).toFixed(2);
      console.log(`Context image (base64) transmitting to Sogni API: ${sizeMB}MB`);
    } else {
      throw new Error('contextImages must be a File or base64 string');
    }

    const projectParams: Record<string, unknown> = {
      selectedModel: params.modelId,
      positivePrompt: params.positivePrompt,
      negativePrompt: params.negativePrompt,
      width: params.width,
      height: params.height,
      promptGuidance: params.guidance,
      numberImages: params.numberOfMedia,
      inferenceSteps: params.steps,
      sampler: params.sampler,
      scheduler: params.scheduler,
      outputFormat: params.outputFormat,
      denoisingStrength: params.denoisingStrength,
      contextImages: [imageData],
    };

    return generateImage(projectParams, progressCallback);
  } catch (error: unknown) {
    console.error('Error creating project:', error);
    throw error;
  }
}

/**
 * Cancellation result with rate limit info
 */
export interface CancelProjectResult {
  success: boolean;
  didCancel: boolean;
  projectId: string;
  rateLimited?: boolean;
  cooldownRemaining?: number;
  errorMessage?: string;
  completedJobs?: number;
  totalJobs?: number;
}

/**
 * Cancel an ongoing project
 */
export async function cancelProject(projectId: string): Promise<CancelProjectResult> {
  try {
    const response = await fetch(`${API_BASE_URL}/sogni/cancel/${projectId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Client-App-ID': clientAppId,
      },
      credentials: 'include',
    });

    const resultRaw: unknown = await response.json();
    const result: Record<string, unknown> = isObjectRecord(resultRaw) ? resultRaw : {};
    console.log('Project cancellation result:', result);

    if (response.status === 429 || result.rateLimited === true) {
      const cooldownRemaining = typeof result.cooldownRemaining === 'number'
        ? result.cooldownRemaining
        : 20;

      return {
        success: false,
        didCancel: false,
        projectId,
        rateLimited: true,
        cooldownRemaining,
        errorMessage: typeof result.message === 'string'
          ? result.message
          : 'Cancelled too recently. Please wait before trying again.'
      };
    }

    if (!response.ok) {
      return {
        success: false,
        didCancel: false,
        projectId,
        errorMessage: typeof result.message === 'string'
          ? result.message
          : `Cancellation failed: ${response.status}`
      };
    }

    return {
      success: true,
      didCancel: result.didCancel !== false,
      projectId,
      completedJobs: typeof result.completedJobs === 'number' ? result.completedJobs : undefined,
      totalJobs: typeof result.totalJobs === 'number' ? result.totalJobs : undefined,
      errorMessage: typeof result.message === 'string' ? result.message : undefined
    };
  } catch (error: unknown) {
    console.error('Error cancelling project:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      didCancel: false,
      projectId,
      errorMessage: errorMsg
    };
  }
}

/**
 * Estimate the cost of a generation before creating it
 */
export async function estimateCost(params: Record<string, unknown>): Promise<{ token: number } | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/sogni/estimate-cost`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-App-ID': clientAppId
      },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      throw new Error(`Cost estimation failed: ${response.statusText}`);
    }

    const result: unknown = await response.json();
    return result as { token: number };
  } catch (error) {
    console.warn('Cost estimation failed:', error);
    return null;
  }
}

/**
 * Build a proxy URL for S3-hosted images
 */
export function proxyImageUrl(url: string): string {
  if (!url) return '';
  // If it is already a relative/proxied URL, return as-is
  if (url.startsWith('/')) return url;
  return `${API_BASE_URL}/api/sogni/proxy-image?url=${encodeURIComponent(url)}`;
}

/**
 * Generate image using Sogni with progress tracking via SSE.
 *
 * Uploads via XMLHttpRequest for real upload progress, then connects to an
 * SSE endpoint for generation progress.
 */
export async function generateImage(
  params: Record<string, unknown>,
  progressCallback?: (progress: unknown) => void
): Promise<unknown> {
  try {
    console.log(`Making request to: ${API_BASE_URL}/sogni/generate`);

    const isConnected = await checkConnectivity();
    if (!isConnected) {
      throw new NetworkError(
        'No internet connection. Please check your network and try again.',
        false,
        true,
        true
      );
    }

    const requestParams = {
      ...params,
      clientAppId,
    };

    // --- Upload via XMLHttpRequest for real progress ---
    const { projectId, status, responseData } = await new Promise<{
      projectId: string | undefined;
      status: string | undefined;
      responseData: Record<string, unknown>;
    }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const REQUEST_TIMEOUT = 30000;
      let requestTimer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (requestTimer) {
          clearTimeout(requestTimer);
          requestTimer = undefined;
        }
      };

      requestTimer = setTimeout(() => {
        cleanup();
        xhr.abort();
        reject(new NetworkError(
          'Request timed out. Please check your internet connection and try again.',
          true, false, true
        ));
      }, REQUEST_TIMEOUT);

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && progressCallback) {
          const uploadProgress = (event.loaded / event.total) * 100;
          progressCallback({ type: 'uploadProgress', progress: uploadProgress });
        }
      });

      xhr.upload.addEventListener('load', () => {
        console.log('Upload completed, processing on server...');
        if (progressCallback) {
          progressCallback({ type: 'uploadComplete' });
        }
      });

      xhr.addEventListener('load', () => {
        cleanup();
        try {
          if (xhr.status >= 200 && xhr.status < 300) {
            const jsonRaw: unknown = JSON.parse(xhr.responseText);
            const json: Record<string, unknown> = isObjectRecord(jsonRaw) ? jsonRaw : {};
            resolve({
              projectId: json.projectId as string | undefined,
              status: json.status as string | undefined,
              responseData: json
            });
          } else {
            const errorMessage = xhr.status === 0
              ? 'Network connection lost. Please check your internet and try again.'
              : `Server error (${xhr.status}). Please try again.`;
            reject(new NetworkError(errorMessage, false, xhr.status === 0, true));
          }
        } catch (error) {
          reject(new NetworkError(
            `Network error: ${error instanceof Error ? error.message : String(error)}`,
            false, false, true
          ));
        }
      });

      xhr.addEventListener('error', () => {
        cleanup();
        checkConnectivity().then(connected => {
          reject(new NetworkError(
            connected
              ? 'Network error during upload. Please try again.'
              : 'Internet connection lost. Please check your network and try again.',
            false, !connected, true
          ));
        }).catch(() => {
          reject(new NetworkError(
            'Network error during upload. Please check your connection and try again.',
            false, true, true
          ));
        });
      });

      xhr.addEventListener('abort', () => {
        cleanup();
        reject(new NetworkError('Request was cancelled', false, false, false));
      });

      xhr.open('POST', `${API_BASE_URL}/sogni/generate`);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('X-Client-App-ID', clientAppId);
      xhr.withCredentials = true;
      xhr.send(JSON.stringify(requestParams));
    });

    hasConnectedToSogni = true;

    if (status !== 'processing' || !projectId) {
      throw new Error('Failed to start image generation');
    }

    let responseClientAppId = clientAppId;
    if (responseData && typeof responseData.clientAppId === 'string') {
      responseClientAppId = responseData.clientAppId;
      console.log(`Using backend-provided clientAppId: ${responseClientAppId}`);
    }

    if (!progressCallback) {
      return { projectId, clientAppId: responseClientAppId };
    }

    // --- SSE for progress tracking ---
    return new Promise((_resolve, reject) => {
      let retryCount = 0;
      const maxRetries = 5;
      let eventSource: EventSource | null = null;
      let connectionTimeout: ReturnType<typeof setTimeout> | undefined;
      let overallTimeout: ReturnType<typeof setTimeout> | undefined;
      let reconnectionTimer: ReturnType<typeof setTimeout> | undefined;

      const clearAllTimers = () => {
        if (connectionTimeout !== undefined) { clearTimeout(connectionTimeout); connectionTimeout = undefined; }
        if (reconnectionTimer !== undefined) { clearTimeout(reconnectionTimer); reconnectionTimer = undefined; }
        if (overallTimeout !== undefined) { clearTimeout(overallTimeout); overallTimeout = undefined; }
      };

      const safelyCloseEventSource = () => {
        if (eventSource) {
          try { eventSource.close(); } catch (err) { console.warn('Error closing EventSource:', err); }
          eventSource = null;
        }
      };

      const connectSSE = () => {
        clearAllTimers();
        safelyCloseEventSource();

        const progressUrl = `${API_BASE_URL}/sogni/progress/${projectId}?clientAppId=${encodeURIComponent(responseClientAppId)}&_t=${Date.now()}`;
        console.log(`Connecting to progress stream: ${progressUrl} (attempt ${retryCount + 1})`);

        try {
          eventSource = new EventSource(progressUrl, { withCredentials: true });

          connectionTimeout = setTimeout(() => {
            console.error('EventSource connection timeout');
            safelyCloseEventSource();
            if (retryCount < maxRetries) {
              retryCount++;
              console.log(`Retrying connection (${retryCount}/${maxRetries})...`);
              reconnectionTimer = setTimeout(connectSSE, 1000 * Math.pow(1.5, retryCount));
            } else {
              clearAllTimers();
              reject(new NetworkError(
                'Connection timeout. Please check your internet connection and try again.',
                true, false, true
              ));
            }
          }, 7000);

          eventSource.onopen = () => {
            console.log('EventSource connection established.');
            if (connectionTimeout !== undefined) { clearTimeout(connectionTimeout); connectionTimeout = undefined; }
            retryCount = 0;
          };

          // Handle named SSE events (backend sends event: <name> field)
          const handleSSEEvent = (event: MessageEvent) => {
            try {
              const parsed: unknown = typeof event.data === 'string' ? JSON.parse(event.data) : {};
              const data: Record<string, unknown> = isObjectRecord(parsed) ? parsed : {};

              if (connectionTimeout !== undefined) { clearTimeout(connectionTimeout); connectionTimeout = undefined; }

              // Forward to the caller
              if (progressCallback) {
                progressCallback(data);
              }

              // Handle terminal events
              if (data.type === 'completed' || data.type === 'complete' || data.type === 'failed' || data.type === 'error') {
                console.log(`Terminal event received for ${projectId}: ${String(data.type)}`);
                clearAllTimers();
                safelyCloseEventSource();
              }
            } catch (error) {
              console.error('Error parsing SSE message:', error, 'Original data:', event.data);
            }
          };

          // Listen for all named SSE event types the backend sends
          const sseEventTypes = ['connected', 'queued', 'progress', 'preview', 'jobCompleted', 'complete', 'error'];
          for (const eventType of sseEventTypes) {
            eventSource.addEventListener(eventType, handleSSEEvent);
          }
          // Also listen for unnamed messages as fallback
          eventSource.onmessage = handleSSEEvent;

          eventSource.onerror = () => {
            clearAllTimers();

            if (retryCount < maxRetries) {
              safelyCloseEventSource();
              retryCount++;
              console.log(`EventSource connection error. Retrying (${retryCount}/${maxRetries})...`);

              checkConnectivity().then(connected => {
                const delay = connected ? 1000 * Math.pow(1.5, retryCount) : 5000;
                reconnectionTimer = setTimeout(connectSSE, delay);
              }).catch(() => {
                reconnectionTimer = setTimeout(connectSSE, 1000 * Math.pow(1.5, retryCount));
              });
            } else {
              console.error('EventSource connection failed permanently after retries.');
              notifyConnectionStateChange('offline');
              clearAllTimers();
              safelyCloseEventSource();

              checkConnectivity().then(connected => {
                reject(new NetworkError(
                  connected
                    ? 'Unable to connect to processing server. Please try again.'
                    : 'Internet connection lost. Please check your network and try again.',
                  false, !connected, true
                ));
              }).catch(() => {
                reject(new NetworkError(
                  'Connection failed. Please check your internet and try again.',
                  false, true, true
                ));
              });
            }
          };

          // Overall generation timeout: 5 minutes
          overallTimeout = setTimeout(() => {
            console.log(`Overall timeout reached for project ${projectId} after 5 minutes`);
            clearAllTimers();
            safelyCloseEventSource();
            reject(new NetworkError('Generation timed out. Please try again.', true, false, true));
          }, 300000);

        } catch (error) {
          console.error('Error creating EventSource:', error);
          clearAllTimers();
          safelyCloseEventSource();
          reject(new NetworkError(
            'Failed to establish connection. Please check your network and try again.',
            false, false, true
          ));
        }
      };

      connectSSE();
    });
  } catch (error: unknown) {
    console.error('Error generating image:', error);

    if (error instanceof NetworkError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new NetworkError(
      `Unexpected error: ${errorMessage}. Please try again.`,
      false, false, true
    );
  }
}

/**
 * Check if an error is a network-related error that can be retried
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

/**
 * Analyze a photo via the backend proxy (for demo users).
 */
export async function analyzePhoto(imageBase64: string): Promise<import('@/types/chat').PhotoAnalysis> {
  const response = await fetch(`${API_BASE_URL}/api/photo-analysis/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64 }),
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Photo analysis failed: ${response.status}`);
  }

  return response.json();
}
