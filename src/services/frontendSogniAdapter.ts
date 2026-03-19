/**
 * Frontend Sogni Adapter
 *
 * Wraps the real Sogni Client SDK so that it emits the same events as
 * BackendSogniClient / BackendProject, keeping the Makeover UI code
 * agnostic of the underlying transport (backend proxy vs direct SDK).
 *
 * Simplified from the photobooth adapter: image-only, no video/audio/enhancement.
 */

import { SogniClient } from '@sogni-ai/sogni-client';
import { BrowserEventEmitter } from '@/services/sogniBackend';
import type { CancelProjectResult } from '@/services/api';
import { DEFAULT_MODEL } from '@/constants/settings';

// --- FrontendProjectAdapter ---

/**
 * Wraps a real SDK Project to emit BackendProject-compatible events.
 *
 * Mapped events:
 *  - jobStarted  -> job { type: 'started', ... }
 *  - jobCompleted -> jobCompleted { id, resultUrl, ... }
 *  - progress    -> job { type: 'progress', ... }
 *  - preview     -> jobCompleted { ... isPreview: true }
 *  - queued      -> job { type: 'queued', ... }
 *  - jobETA      -> job { type: 'eta', ... }
 *  - completed   -> completed
 *  - failed      -> failed
 */
export class FrontendProjectAdapter extends BrowserEventEmitter {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  private realProject: any;
  private realClient: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  private jobIndexMap: Map<string, number> = new Map();
  private nextJobIndex: number = 0;
  private isCompleted: boolean = false;
  private uploadProgressEmitted: boolean = false;
  private jobPrompts: Map<string, string> = new Map();
  private workerNameCache: Map<string, string> = new Map();
  private failedJobs: Map<string, string> = new Map();

  private completionTracker = {
    expectedJobs: 0,
    sentJobCompletions: 0,
    projectCompletionReceived: false,
    jobCompletionTimeouts: new Map<string, ReturnType<typeof setTimeout>>(),
  };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  constructor(realProject: any, realClient: any) {
    super();
    this.realProject = realProject;
    this.realClient = realClient;
    this.completionTracker.expectedJobs = realProject.params?.numberOfMedia || 1;
    this.setupEventMapping();
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Expose real project properties
  get id(): string { return this.realProject.id; }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  get jobs(): any[] {
    if (!this.realProject.jobs) return [];
    return this.realProject.jobs.map((job: any) => {
      const failedError = this.failedJobs.get(job.id);
      return failedError ? { ...job, error: failedError } : job;
    });
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  get status(): string { return this.realProject.status; }

  async cancel(): Promise<void> { return this.realProject.cancel(); }

  waitForCompletion(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onComplete = () => { this.off('completed', onComplete); this.off('failed', onFail); resolve(); };
      const onFail = (err: unknown) => {
        this.off('completed', onComplete);
        this.off('failed', onFail);
        if (err instanceof Error) {
          reject(err);
        } else if (err && typeof err === 'object' && 'message' in err) {
          reject(new Error((err as { message: string }).message));
        } else if (typeof err === 'string') {
          reject(new Error(err));
        } else {
          reject(new Error('Generation failed'));
        }
      };
      this.on('completed', onComplete);
      this.on('failed', onFail);
    });
  }

  // --- Private setup ---

  private setupEventMapping(): void {
    this.simulateUploadProgress();
    this.setupGlobalProgressHandler();

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const captureJobPrompt = (event: any) => {
      const jid = event.jobId || event.id;
      if (jid && event.positivePrompt) {
        this.jobPrompts.set(jid, event.positivePrompt);
      }
    };

    // Capture prompts from various project events
    this.realProject.on('jobStarted', captureJobPrompt);
    this.realProject.on('progress', captureJobPrompt);
    this.realProject.on('jobCompleted', captureJobPrompt);

    // Also capture from global client events
    if (this.realClient?.projects && typeof this.realClient.projects.on === 'function') {
      this.realClient.projects.on('job', (event: any) => {
        if (event.projectId === this.realProject.id) {
          captureJobPrompt(event);
        }
      });
    }

    // --- jobStarted ---
    this.realProject.on('jobStarted', (job: any) => {
      if (job.id) {
        const prompt = job.positivePrompt || job.params?.positivePrompt || '';
        if (prompt) this.jobPrompts.set(job.id, prompt);
        if (job.workerName) this.workerNameCache.set(job.id, job.workerName);
      }

      if (!this.jobIndexMap.has(job.id)) {
        this.jobIndexMap.set(job.id, this.nextJobIndex++);
      }
      const jobIndex = this.jobIndexMap.get(job.id);

      this.emit('jobStarted', job);

      const individualPrompt = this.jobPrompts.get(job.id) || this.realProject.params?.positivePrompt || '';
      const workerName = job.workerName || this.workerNameCache.get(job.id) || 'Worker';

      this.emit('job', {
        type: 'started',
        jobId: job.id,
        projectId: this.realProject.id,
        workerName,
        jobIndex,
        positivePrompt: individualPrompt,
      });
    });

    // --- jobCompleted ---
    this.realProject.on('jobCompleted', (job: any) => {
      let individualPrompt = '';
      if (this.jobPrompts.has(job.id)) {
        individualPrompt = this.jobPrompts.get(job.id)!;
      } else if (job.positivePrompt) {
        individualPrompt = job.positivePrompt;
        this.jobPrompts.set(job.id, individualPrompt);
      } else if (job.params?.positivePrompt) {
        individualPrompt = job.params.positivePrompt;
        this.jobPrompts.set(job.id, individualPrompt);
      } else {
        individualPrompt = this.realProject.params?.positivePrompt || '';
      }

      let resultUrl = job.resultUrl;
      if (!resultUrl && !job.fallback && this.realProject.jobs) {
        const found = this.realProject.jobs.find((j: any) => j.id === job.id);
        if (found?.resultUrl) resultUrl = found.resultUrl;
      }

      const workerName = job.workerName || this.workerNameCache.get(job.id) || 'Worker';
      if (job.workerName && job.id) this.workerNameCache.set(job.id, job.workerName);

      // NSFW-filtered or missing result -> fail
      if ((job.isNSFW && !resultUrl) || (!resultUrl && !job.fallback)) {
        const errorMessage = job.isNSFW ? 'CONTENT FILTERED: NSFW detected' : 'No result URL provided';
        this.failedJobs.set(job.id, errorMessage);

        this.emit('jobFailed', {
          id: job.id,
          error: errorMessage,
          isNSFW: !!job.isNSFW,
          positivePrompt: individualPrompt,
          workerName,
        });

        this.completionTracker.sentJobCompletions++;
        const tid = this.completionTracker.jobCompletionTimeouts.get(job.id);
        if (tid) { clearTimeout(tid); this.completionTracker.jobCompletionTimeouts.delete(job.id); }
        this.checkAndSendProjectCompletion();
        return;
      }

      this.emit('jobCompleted', {
        id: job.id,
        resultUrl,
        previewUrl: job.previewUrl,
        isPreview: job.isPreview || false,
        positivePrompt: individualPrompt,
        workerName,
        isNSFW: job.isNSFW || false,
        seed: job.seed,
        steps: job.steps,
      });

      this.completionTracker.sentJobCompletions++;
      const tid = this.completionTracker.jobCompletionTimeouts.get(job.id);
      if (tid) { clearTimeout(tid); this.completionTracker.jobCompletionTimeouts.delete(job.id); }
      this.checkAndSendProjectCompletion();
    });

    // --- project completed ---
    this.realProject.on('completed', () => {
      if (!this.completionTracker.projectCompletionReceived) {
        this.completionTracker.projectCompletionReceived = true;
        this.emit('uploadComplete');
        this.checkAndSendProjectCompletion();
      }
    });

    // --- project failed ---
    this.realProject.on('failed', (error: any) => this.emit('failed', error));
    this.realProject.on('error', (error: any) => this.emit('error', error));
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  private setupGlobalProgressHandler(): void {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const handler = (event: any) => {
      try {
        if (event.projectId !== this.realProject.id) return;

        switch (event.type) {
          case 'queued': {
            if (event.queuePosition !== undefined) {
              this.emit('job', {
                type: 'queued',
                jobId: event.jobId,
                projectId: this.realProject.id,
                queuePosition: event.queuePosition,
              });
            }
            break;
          }

          case 'preview': {
            const previewUrl = event.url;
            if (previewUrl && event.jobId) {
              const wn = event.workerName || this.workerNameCache.get(event.jobId) || 'Worker';
              this.emit('jobCompleted', {
                id: event.jobId,
                resultUrl: previewUrl,
                previewUrl,
                isPreview: true,
                positivePrompt: this.jobPrompts.get(event.jobId) || this.realProject.params?.positivePrompt || '',
                workerName: wn,
              });
            }
            break;
          }

          case 'jobETA': {
            if (event.jobId && typeof event.etaSeconds === 'number') {
              const wn = this.workerNameCache.get(event.jobId) || 'Worker';
              this.emit('job', {
                type: 'eta',
                eta: event.etaSeconds,
                jobId: event.jobId,
                projectId: this.realProject.id,
                workerName: wn,
              });
            }
            break;
          }

          case 'progress': {
            if (event.step && event.stepCount) {
              if (event.workerName && event.jobId) this.workerNameCache.set(event.jobId, event.workerName);

              const wn = event.workerName || (event.jobId ? this.workerNameCache.get(event.jobId) : null) || 'Worker';
              const normalised = Math.min(1, event.step / event.stepCount);

              this.emit('job', {
                type: 'progress',
                progress: normalised,
                step: event.step,
                stepCount: event.stepCount,
                jobId: event.jobId,
                projectId: this.realProject.id,
                workerName: wn,
              });

              // Fallback completion detection
              if (event.jobId && normalised >= 0.85) {
                if (!this.completionTracker.jobCompletionTimeouts.has(event.jobId)) {
                  const timeoutId = setTimeout(() => {
                    const cachedWn = this.workerNameCache.get(event.jobId) || 'Worker';
                    this.emit('jobCompleted', {
                      id: event.jobId,
                      resultUrl: null,
                      previewUrl: null,
                      isPreview: false,
                      positivePrompt: this.jobPrompts.get(event.jobId) || this.realProject.params?.positivePrompt || '',
                      workerName: cachedWn,
                      fallback: true,
                    });
                    this.completionTracker.sentJobCompletions++;
                    this.completionTracker.jobCompletionTimeouts.delete(event.jobId);
                    this.checkAndSendProjectCompletion();
                  }, 20000);
                  this.completionTracker.jobCompletionTimeouts.set(event.jobId, timeoutId);
                }
              }
            }
            break;
          }

          case 'initiating':
          case 'started': {
            if (event.jobId) {
              if (event.workerName) this.workerNameCache.set(event.jobId, event.workerName);
              const wn = event.workerName || this.workerNameCache.get(event.jobId) || 'Worker';
              const idx = this.jobIndexMap.get(event.jobId) ?? 0;
              this.emit('job', {
                type: event.type,
                jobId: event.jobId,
                projectId: this.realProject.id,
                workerName: wn,
                positivePrompt: this.jobPrompts.get(event.jobId) || this.realProject.params?.positivePrompt || '',
                jobIndex: idx,
              });
            }
            break;
          }
        }
      } catch (error) {
        console.error('[FrontendAdapter] Error in global progress handler:', error);
      }
    };

    try {
      if (this.realClient.projects && typeof this.realClient.projects.on === 'function') {
        this.realClient.projects.on('job', handler);
      }
    } catch (error) {
      console.error('[FrontendAdapter] Error registering global progress handler:', error);
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  private checkAndSendProjectCompletion(): void {
    if (
      this.completionTracker.projectCompletionReceived &&
      this.completionTracker.sentJobCompletions >= this.completionTracker.expectedJobs
    ) {
      if (!this.isCompleted) {
        this.isCompleted = true;
        this.completionTracker.jobCompletionTimeouts.forEach(tid => clearTimeout(tid));
        this.completionTracker.jobCompletionTimeouts.clear();
        this.emit('completed');
      }
    }
  }

  private simulateUploadProgress(): void {
    let progress = 0;
    const interval = setInterval(() => {
      if (progress < 100 && !this.uploadProgressEmitted) {
        progress += Math.random() * 20 + 5;
        progress = Math.min(progress, 100);
        this.emit('uploadProgress', progress);
        if (progress >= 100) {
          this.uploadProgressEmitted = true;
          clearInterval(interval);
        }
      } else {
        clearInterval(interval);
      }
    }, 200);

    setTimeout(() => {
      clearInterval(interval);
      if (!this.uploadProgressEmitted) {
        this.emit('uploadProgress', 100);
        this.uploadProgressEmitted = true;
      }
    }, 5000);
  }
}

// --- FrontendSogniClientAdapter ---

export class FrontendSogniClientAdapter {
  private realClient: SogniClient;

  constructor(realClient: SogniClient) {
    this.realClient = realClient;
  }

  get projects() {
    return {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      create: async (params: any) => {
        console.log('[FrontendAdapter] Creating image project', {
          modelId: params.modelId,
          hasContextImages: !!(params.contextImages?.length),
        });

        const sdkParams = { ...params };

        // Ensure type is set to image
        if (!sdkParams.type) {
          sdkParams.type = 'image';
        }

        // Default model
        if (!sdkParams.modelId) {
          sdkParams.modelId = DEFAULT_MODEL;
        }

        // Convert sensitiveContentFilter to disableNSFWFilter for SDK compatibility
        if ('sensitiveContentFilter' in params) {
          sdkParams.disableNSFWFilter = !params.sensitiveContentFilter;
          delete sdkParams.sensitiveContentFilter;
        }

        // Convert base64 string contextImages to Blobs for SDK compatibility.
        // The SDK expects File | Buffer | Blob, not base64 strings.
        if (sdkParams.contextImages && Array.isArray(sdkParams.contextImages)) {
          sdkParams.contextImages = sdkParams.contextImages.map((img: any) => {
            if (typeof img === 'string') {
              const byteCharacters = atob(img);
              const byteArray = new Uint8Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteArray[i] = byteCharacters.charCodeAt(i);
              }
              return new Blob([byteArray], { type: 'image/jpeg' });
            }
            return img;
          });
        }

        const realProject = await this.realClient.projects.create(sdkParams);
        console.log(`[FrontendAdapter] Project created with ID: ${realProject.id}`);

        return new FrontendProjectAdapter(realProject, this.realClient);
      },

      estimateCost: async (params: any) => {
        if (this.realClient.projects && typeof (this.realClient.projects as any).estimateCost === 'function') {
          return (this.realClient.projects as any).estimateCost(params);
        }
        throw new Error('Cost estimation not available on this client');
      },

      on: (event: string, callback: (...args: any[]) => void) => {
        if (this.realClient.projects && typeof (this.realClient.projects as any).on === 'function') {
          (this.realClient.projects as any).on(event, callback);
        }
      },

      off: (event: string, callback: (...args: any[]) => void) => {
        if (this.realClient.projects && typeof (this.realClient.projects as any).off === 'function') {
          (this.realClient.projects as any).off(event, callback);
        }
      },
      /* eslint-enable @typescript-eslint/no-explicit-any */
    };
  }

  get account() { return this.realClient.account; }
  get apiClient() { return this.realClient.apiClient; }

  async disconnect(): Promise<void> {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    if ((this.realClient as any).disconnect) {
      return (this.realClient as any).disconnect();
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  /**
   * Expose the raw SogniClient for direct chat API access.
   * The chat API doesn't need the adapter's project-event normalization.
   */
  getChatClient(): SogniClient {
    return this.realClient;
  }

  /**
   * Cancel a project by ID.
   * Returns a result compatible with BackendSogniClient's cancelProject.
   */
  async cancelProject(projectId: string): Promise<CancelProjectResult> {
    console.log(`[FrontendAdapter] Cancelling project: ${projectId}`);

    try {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const projectsApi = this.realClient.projects as any;

      if (projectsApi && typeof projectsApi.cancel === 'function') {
        await projectsApi.cancel(projectId);
        return { success: true, didCancel: true, projectId };
      }

      if (projectsApi && typeof projectsApi.get === 'function') {
        const project = await projectsApi.get(projectId);
        if (project && typeof project.cancel === 'function') {
          await project.cancel();
          return { success: true, didCancel: true, projectId };
        }
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */

      return {
        success: false,
        didCancel: false,
        projectId,
        errorMessage: 'Cancel method not available',
      };
    } catch (error) {
      console.error(`[FrontendAdapter] Error cancelling project ${projectId}:`, error);
      return {
        success: false,
        didCancel: false,
        projectId,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// --- Factory ---

/**
 * Create a real SogniClient, authenticate with the provided token,
 * and return it wrapped in a FrontendSogniClientAdapter.
 */
export async function initializeFrontendSogniClient(
  authToken: string
): Promise<FrontendSogniClientAdapter> {
  const { getOrCreateAppId } = await import('@/utils/appId');
  const appId = getOrCreateAppId();

  const hostname = window.location.hostname;
  const isStaging = hostname.includes('staging');

  let restEndpoint: string;
  let socketEndpoint: string;

  if (isStaging) {
    restEndpoint = 'https://api-staging.sogni.ai';
    socketEndpoint = 'wss://socket-staging.sogni.ai';
  } else {
    restEndpoint = 'https://api.sogni.ai';
    socketEndpoint = 'wss://socket.sogni.ai';
  }

  const client = await SogniClient.createInstance({
    appId,
    network: 'fast',
    restEndpoint,
    socketEndpoint,
    testnet: isStaging,
    authType: 'cookies',
  });

  // If an auth token was provided, it is assumed the cookie-based auth
  // is already established (e.g. via sogniAuth). The token parameter is
  // kept in the signature for symmetry with the auth flow.
  void authToken; // used by callers to signal authenticated context

  return new FrontendSogniClientAdapter(client);
}
