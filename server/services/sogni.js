import { v4 as uuidv4 } from 'uuid';
import process from 'process';

// Import SogniClient dynamically to avoid issues
let SogniClient;

// Connection tracking
export const activeConnections = new Map();
const connectionLastActivity = new Map();
export const sessionClients = new Map();

// Single global Sogni client and session management
let globalSogniClient = null;
let clientCreationPromise = null;
let sogniUsername = null;
let sogniEnv = null;
let sogniUrls = null;
let password = null;

// Token refresh cooldown to prevent excessive refresh attempts
const lastRefreshAttempt = { timestamp: 0 };
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Sogni environment configuration (shared infrastructure with photobooth)
const SOGNI_HOSTS = {
  local: {
    api: 'https://api.sogni.ai',
    socket: 'wss://socket.sogni.ai',
    rest: 'https://api.sogni.ai'
  },
  staging: {
    api: 'https://api-staging.sogni.ai',
    socket: 'wss://socket-staging.sogni.ai',
    rest: 'https://api-staging.sogni.ai'
  },
  production: {
    api: 'https://api.sogni.ai',
    socket: 'wss://socket.sogni.ai',
    rest: 'https://api.sogni.ai'
  }
};

const getSogniUrls = (env) => {
  if (!SOGNI_HOSTS[env]) {
    console.warn(`Unknown Sogni environment: ${env}, falling back to production`);
    return SOGNI_HOSTS.production;
  }
  return SOGNI_HOSTS[env];
};

// Activity tracking
export function getActiveConnectionsCount() {
  return activeConnections.size;
}

export function logConnectionStatus(operation, clientId) {
  const count = getActiveConnectionsCount();
  if (count > 0 || operation === 'Created') {
    console.log(`[CONNECTION] ${operation} client ${clientId}. Active connections: ${count}`);
  }
  return activeConnections.size;
}

// Helper to record activity on a client
function recordClientActivity(clientId) {
  if (clientId) {
    connectionLastActivity.set(clientId, Date.now());
  }
}

// Validate if an error is truly auth-related by making an additional authenticated call
export async function validateAuthError(error) {
  console.log(`[AUTH] Validating error to determine if it's truly an auth issue: ${error.message}`);

  // If we're in cooldown, assume it's auth-related to avoid spam
  const now = Date.now();
  if (now - lastRefreshAttempt.timestamp < REFRESH_COOLDOWN_MS) {
    console.log(`[AUTH] Within refresh cooldown period, treating as auth error`);
    return true;
  }

  try {
    // Try to make a simple authenticated API call to test if tokens are actually invalid
    const client = await getOrCreateGlobalSogniClient();
    await client.account.refreshBalance();

    console.log(`[AUTH] Error doesn't appear to be auth-related, treating as transient: ${error.message}`);
    return false;
  } catch (validationError) {
    if (validationError.status === 401 ||
        (validationError.payload && validationError.payload.errorCode === 107) ||
        validationError.message?.includes('Invalid token')) {
      console.log(`[AUTH] Validation confirmed this is a real auth error: ${validationError.message}`);
      lastRefreshAttempt.timestamp = now;
      return true;
    }

    console.log(`[AUTH] Validation call failed with non-auth error, treating original error as transient: ${validationError.message}`);
    return false;
  }
}

// Create or get the global Sogni client with proper session management
async function getOrCreateGlobalSogniClient() {
  // If we already have a valid global client, return it
  if (globalSogniClient && globalSogniClient.account.currentAccount.isAuthenicated) {
    console.log(`[GLOBAL] Reusing existing authenticated global client: ${globalSogniClient.appId}`);
    recordClientActivity(globalSogniClient.appId);

    const hasToken = !!globalSogniClient.account.currentAccount.token;
    const hasRefreshToken = !!globalSogniClient.account.currentAccount.refreshToken;
    console.log(`[GLOBAL] Token status - Access: ${hasToken ? 'present' : 'missing'}, Refresh: ${hasRefreshToken ? 'present' : 'missing'}`);

    return globalSogniClient;
  }

  // If client creation is already in progress, wait for it
  if (clientCreationPromise) {
    console.log(`[GLOBAL] Client creation already in progress, waiting...`);
    return await clientCreationPromise;
  }

  // Create the client creation promise to prevent race conditions
  clientCreationPromise = (async () => {
    try {
      // Initialize environment and credentials
      if (!sogniUsername || !password) {
        sogniEnv = process.env.SOGNI_ENV || 'production';
        sogniUsername = process.env.SOGNI_USERNAME;
        password = process.env.SOGNI_PASSWORD;
        sogniUrls = getSogniUrls(sogniEnv);

        if (!sogniUsername || !password) {
          throw new Error('Sogni credentials not configured - check SOGNI_USERNAME and SOGNI_PASSWORD');
        }
      }

      // Generate a unique app ID for this instance
      const clientAppId = `makeover-${uuidv4()}`;

      console.log(`[GLOBAL] Creating new global Sogni client with app ID: ${clientAppId}`);

      // Import SogniClient if not already imported
      if (!SogniClient) {
        const sogniModule = await import('@sogni-ai/sogni-client');
        SogniClient = sogniModule.SogniClient;
      }

      // Create new global client
      const client = await SogniClient.createInstance({
        appId: clientAppId,
        network: 'fast',
        restEndpoint: sogniUrls.rest,
        socketEndpoint: sogniUrls.socket,
        testnet: sogniEnv === 'staging'
      });

      // Authenticate the client
      // Note: The Sogni SDK automatically manages token refresh:
      // - Access tokens are valid for 24 hours
      // - Refresh tokens are valid for 30 days
      // - SDK handles automatic renewal without requiring socket reconnection
      try {
        console.log(`[GLOBAL] Authenticating global client...`);
        await client.account.login(sogniUsername, password, false);
        console.log(`[GLOBAL] Successfully authenticated global client: ${clientAppId}`);
        console.log(`[GLOBAL] Auth state:`, {
          isAuthenticated: client.account.currentAccount.isAuthenicated,
          hasToken: !!client.account.currentAccount.token,
          hasRefreshToken: !!client.account.currentAccount.refreshToken
        });
        console.log(`[GLOBAL] SDK will automatically refresh access tokens (24h lifespan) using refresh tokens (30d lifespan)`);
      } catch (error) {
        console.error(`[GLOBAL] Authentication failed for global client:`, error);
        throw error;
      }

      // Set up event listeners for connection monitoring
      if (client.apiClient && client.apiClient.on) {
        client.apiClient.on('connected', () => {
          recordClientActivity(clientAppId);
          console.log(`[GLOBAL] Global client connected to Sogni`);
        });

        client.apiClient.on('disconnected', () => {
          recordClientActivity(clientAppId);
          console.log(`[GLOBAL] Global client disconnected from Sogni`);
        });

        client.apiClient.on('error', (error) => {
          recordClientActivity(clientAppId);
          console.log(`[GLOBAL] Global client socket error:`, error.message);
        });
      }

      globalSogniClient = client;
      activeConnections.set(clientAppId, client);
      recordClientActivity(clientAppId);
      logConnectionStatus('Created', clientAppId);

      return globalSogniClient;
    } catch (error) {
      console.error(`[GLOBAL] Failed to create global client:`, error);
      throw error;
    } finally {
      clientCreationPromise = null;
    }
  })();

  return await clientCreationPromise;
}

// Enhanced wrapper for Sogni operations with proper error handling
async function withSogniClient(operation, operationName = 'operation') {
  let client;
  let retryCount = 0;
  const maxRetries = 2;

  while (retryCount <= maxRetries) {
    try {
      client = await getOrCreateGlobalSogniClient();

      // Execute the operation
      const result = await operation(client);
      recordClientActivity(client.appId);
      return result;

    } catch (error) {
      console.log(`[SOGNI] Error during ${operationName} (attempt ${retryCount + 1}/${maxRetries + 1}):`, error.message);

      // Validate if this is truly an auth error
      if (await validateAuthError(error)) {
        console.log(`[SOGNI] Confirmed auth error - clearing global client and retrying`);

        // Clear the global client to force re-authentication
        if (globalSogniClient) {
          try {
            await globalSogniClient.account.logout();
          } catch (logoutError) {
            // Ignore logout errors
          }
          if (activeConnections.has(globalSogniClient.appId)) {
            activeConnections.delete(globalSogniClient.appId);
            connectionLastActivity.delete(globalSogniClient.appId);
          }
          globalSogniClient = null;
          clientCreationPromise = null;
        }

        retryCount++;
        if (retryCount <= maxRetries) {
          console.log(`[SOGNI] Retrying ${operationName} after auth error (attempt ${retryCount + 1})`);
          continue;
        }
      } else {
        console.log(`[SOGNI] Error is not auth-related, not retrying:`, error.message);
      }

      // Re-throw the error if we can't retry or have exhausted retries
      throw error;
    }
  }
}

// Helper functions for backwards compatibility
export function clearInvalidTokens() {
  console.log('[AUTH] Clearing global client due to invalid tokens');
  if (globalSogniClient) {
    try {
      globalSogniClient.account.logout().catch(() => {
        // Ignore logout errors during cleanup
      });
    } catch (error) {
      // Ignore errors during logout
    }

    if (activeConnections.has(globalSogniClient.appId)) {
      activeConnections.delete(globalSogniClient.appId);
      connectionLastActivity.delete(globalSogniClient.appId);
    }
    globalSogniClient = null;
    clientCreationPromise = null;
  }
}

export async function forceAuthReset() {
  console.log('[AUTH] Force clearing global client and re-authenticating');

  if (globalSogniClient) {
    try {
      await globalSogniClient.account.logout();
    } catch (error) {
      console.log('[AUTH] Logout error during force reset (expected):', error.message);
    }

    if (activeConnections.has(globalSogniClient.appId)) {
      activeConnections.delete(globalSogniClient.appId);
      connectionLastActivity.delete(globalSogniClient.appId);
    }
    globalSogniClient = null;
    clientCreationPromise = null;
  }

  sessionClients.clear();

  console.log('[AUTH] Force auth reset completed - next request will re-authenticate');
}

// Simplified session client management - all sessions use the same global authenticated client
export async function getSessionClient(sessionId, clientAppId) {
  console.log(`[SESSION] Getting client for session ${sessionId}${clientAppId ? ` appId ${clientAppId}` : ''}`);
  try {
    const client = await getOrCreateGlobalSogniClient();
    sessionClients.set(sessionId, client.appId);
    console.log(`[SESSION] Successfully provided global client to session ${sessionId}`);
    return client;
  } catch (error) {
    console.error(`[SESSION] Failed to get client for session ${sessionId}:`, error);
    throw error;
  }
}

export async function disconnectSessionClient(sessionId) {
  console.log(`[SESSION] Disconnecting session client for session ${sessionId}`);

  // Just remove the session mapping - don't disconnect the global client
  sessionClients.delete(sessionId);

  console.log(`[SESSION] Session ${sessionId} disconnected (global client remains active)`);
  return true;
}

// Image generation with comprehensive error handling and streaming
export async function generateImage(client, params, progressCallback, localProjectId = null) {
  const runGeneration = async (sogniClient) => {
    console.log('[IMAGE] Starting image generation with params:', {
      model: params.modelId || params.selectedModel,
      outputFormat: params.outputFormat,
      width: params.width,
      height: params.height
    });

    // Prepare project options for the Sogni SDK
    const modelId = params.modelId || params.selectedModel || 'qwen_image_edit_2511_fp8_lightning';
    const inferenceSteps = params.steps || 4;

    // Calculate numberOfPreviews based on steps
    let numberOfPreviews = 10;
    if (inferenceSteps <= 4) {
      numberOfPreviews = Math.max(1, inferenceSteps - 1);
    } else if (inferenceSteps < 10) {
      numberOfPreviews = inferenceSteps - 1;
    }

    console.log(`[IMAGE] Model: ${modelId}, Steps: ${inferenceSteps}, Previews: ${numberOfPreviews}`);

    const projectOptions = {
      type: 'image',
      modelId: modelId,
      positivePrompt: params.positivePrompt || '',
      negativePrompt: params.negativePrompt || '',
      sizePreset: 'custom',
      width: params.width || 1024,
      height: params.height || 1536,
      steps: inferenceSteps,
      guidance: params.guidance || 1,
      numberOfMedia: params.numberOfMedia || 1,
      numberOfPreviews: numberOfPreviews,
      sampler: params.sampler || 'euler',
      scheduler: params.scheduler || 'simple',
      disableNSFWFilter: true,
      outputFormat: params.outputFormat || 'jpg',
      tokenType: params.tokenType || 'spark',
      ...(params.denoisingStrength !== undefined ? { denoisingStrength: params.denoisingStrength } : {}),
      ...(params.seed !== undefined ? { seed: params.seed } : {})
    };

    // Handle context images (for Qwen Image Edit model)
    if (params.contextImages && Array.isArray(params.contextImages)) {
      const contextImagesData = params.contextImages.map(img => {
        return img instanceof Uint8Array ? img : new Uint8Array(img);
      });
      projectOptions.contextImages = contextImagesData;
    }

    // Project completion tracking (must be set up BEFORE creating project)
    const projectCompletionTracker = {
      expectedJobs: params.numberOfMedia || 1,
      sentJobCompletions: 0,
      jobProgress: new Map(),
      jobCompletionTimeouts: new Map(),
      projectCompletionReceived: false,
      projectCompletionEvent: null,
      jobIndexMap: new Map(),
      workerNameCache: new Map()
    };

    // Store project details for event enrichment
    const projectDetails = {
      localProjectId: localProjectId,
      positivePrompt: params.positivePrompt || '',
      negativePrompt: params.negativePrompt || ''
    };

    // Job index counter for proper job assignment
    let nextJobIndex = 0;

    // Create project
    const project = await sogniClient.projects.create(projectOptions);

    console.log('[IMAGE] Project created:', project.id);
    console.log('[IMAGE][MAP]', {
      sdkProjectId: project.id,
      localProjectId
    });

    // Send initial queued event
    if (progressCallback) {
      progressCallback({
        type: 'queued',
        projectId: localProjectId || project.id,
        queuePosition: 1
      });
    }

    // CRITICAL: Capture localProjectId in closure to prevent sharing between concurrent projects
    const capturedLocalProjectId = projectDetails.localProjectId;

    // Return promise that resolves when project is complete but streams individual jobs
    return new Promise((resolve, reject) => {
      let projectFinished = false;

      // Set up cleanup function
      let cleanup = () => {};

      // Per-project event de-duplication
      const emittedKeys = new Set();
      const emitToProgressCallback = (evt) => {
        if (!progressCallback) return;
        const key = `${evt.type}:${evt.jobId || 'na'}:${evt.step || 'na'}:${evt.projectId}`;
        if (emittedKeys.has(key)) {
          return;
        }
        emittedKeys.add(key);
        progressCallback(evt);
      };

      if (progressCallback) {
        // Create job event handler for this project
        const jobHandler = (event) => {
          try {
            // Only process events for this specific project
            if (event.projectId !== project.id) {
              return;
            }

            let progressEvent = null;

            switch (event.type) {
              case 'preview':
                if (!event.jobId || !event.url) break;

                // Cancel fallback completion timeout since we received a preview
                if (projectCompletionTracker.jobCompletionTimeouts.has(event.jobId)) {
                  clearTimeout(projectCompletionTracker.jobCompletionTimeouts.get(event.jobId));
                  projectCompletionTracker.jobCompletionTimeouts.delete(event.jobId);
                }

                progressEvent = {
                  type: 'preview',
                  jobId: event.jobId,
                  projectId: capturedLocalProjectId || event.projectId,
                  previewUrl: event.url,
                  resultUrl: event.url,
                  positivePrompt: event.positivePrompt || projectDetails.positivePrompt,
                  jobIndex: event.jobIndex,
                  imgID: event.imgID
                };
                break;

              case 'initiating':
              case 'started':
                if (!event.jobId) break;

                // Cache worker name if provided
                if (event.workerName && event.jobId) {
                  projectCompletionTracker.workerNameCache.set(event.jobId, event.workerName);
                }

                {
                  const jobIndex = projectCompletionTracker.jobIndexMap.get(event.jobId);
                  progressEvent = {
                    type: event.type,
                    jobId: event.jobId,
                    projectId: capturedLocalProjectId || event.projectId,
                    workerName: event.workerName || 'Worker',
                    positivePrompt: event.positivePrompt || projectDetails.positivePrompt,
                    jobIndex: jobIndex !== undefined ? jobIndex : 0
                  };
                }
                break;

              case 'progress': {
                if (event.step && event.stepCount) {
                  const adjustedProgress = Math.floor(event.step / event.stepCount * 100);

                  const cachedWorkerName = event.jobId ? projectCompletionTracker.workerNameCache.get(event.jobId) : null;
                  const workerName = event.workerName || cachedWorkerName || 'Worker';

                  progressEvent = {
                    type: 'progress',
                    progress: adjustedProgress / 100,
                    step: event.step,
                    stepCount: event.stepCount,
                    jobId: event.jobId,
                    projectId: capturedLocalProjectId || event.projectId,
                    workerName: workerName
                  };

                  // Track job progress and set up fallback completion detection
                  if (event.jobId) {
                    projectCompletionTracker.jobProgress.set(event.jobId, adjustedProgress);

                    if (adjustedProgress >= 85 && !projectCompletionTracker.jobCompletionTimeouts.has(event.jobId)) {
                      console.log(`[IMAGE] Job ${event.jobId} reached ${adjustedProgress}%, setting up fallback completion timeout`);

                      const timeoutId = setTimeout(() => {
                        console.log(`[IMAGE] Fallback completion timeout triggered for job ${event.jobId}`);

                        const jobIndex = projectCompletionTracker.jobIndexMap.get(event.jobId) || 0;

                        const fallbackProgressEvent = {
                          type: 'jobCompleted',
                          jobId: event.jobId,
                          projectId: capturedLocalProjectId || event.projectId,
                          resultUrl: null,
                          positivePrompt: event.positivePrompt || projectDetails.positivePrompt,
                          jobIndex: jobIndex,
                          isNSFW: false,
                          seed: null,
                          steps: null,
                          fallback: true
                        };

                        progressCallback(fallbackProgressEvent);
                        projectCompletionTracker.sentJobCompletions++;
                        console.log(`[IMAGE] Fallback job completion sent for ${event.jobId} (${projectCompletionTracker.sentJobCompletions}/${projectCompletionTracker.expectedJobs})`);

                        projectCompletionTracker.jobCompletionTimeouts.delete(event.jobId);

                        if (projectCompletionTracker.projectCompletionReceived &&
                            projectCompletionTracker.sentJobCompletions >= projectCompletionTracker.expectedJobs) {
                          console.log(`[IMAGE] All jobs completed via fallback, triggering project completion`);
                          if (!projectFinished) {
                            projectFinished = true;
                            cleanup();

                            if (progressCallback && projectCompletionTracker.projectCompletionEvent) {
                              progressCallback(projectCompletionTracker.projectCompletionEvent);
                            }

                            resolve([]);
                          }
                        }
                      }, 20000);

                      projectCompletionTracker.jobCompletionTimeouts.set(event.jobId, timeoutId);
                    }
                  }
                } else {
                  if (!event.jobId) {
                    console.log(`[IMAGE] Skipping project-level progress event without jobId`);
                    break;
                  }

                  {
                    const cachedWorkerName = event.jobId ? projectCompletionTracker.workerNameCache.get(event.jobId) : null;
                    const workerName = event.workerName || cachedWorkerName || 'Worker';

                    progressEvent = {
                      type: 'progress',
                      progress: event.progress || 0,
                      jobId: event.jobId,
                      projectId: capturedLocalProjectId || event.projectId,
                      workerName: workerName
                    };
                  }
                }
                break;
              }

              case 'completed':
              case 'jobCompleted': {
                if (!event.jobId) {
                  console.log(`[IMAGE] Skipping jobCompleted event without jobId`);
                  break;
                }

                let resultUrl = event.resultUrl;

                if (!resultUrl && !event.fallback) {
                  console.error(`[IMAGE] Job ${event.jobId} completed but resultUrl is null`);
                }

                const jobIndex = projectCompletionTracker.jobIndexMap.get(event.jobId) || 0;

                progressEvent = {
                  type: 'jobCompleted',
                  jobId: event.jobId,
                  projectId: capturedLocalProjectId || event.projectId,
                  resultUrl: resultUrl,
                  positivePrompt: event.positivePrompt || projectDetails.positivePrompt,
                  jobIndex: jobIndex,
                  isNSFW: event.isNSFW,
                  seed: event.seed,
                  steps: event.steps
                };

                if (event.isNSFW && !resultUrl) {
                  console.warn(`[IMAGE] Job ${event.jobId} flagged as NSFW, resultUrl is null`);
                  progressEvent.nsfwFiltered = true;
                }

                projectCompletionTracker.sentJobCompletions++;
                console.log(`[IMAGE] Job completion sent for ${event.jobId} (${projectCompletionTracker.sentJobCompletions}/${projectCompletionTracker.expectedJobs})`);

                if (projectCompletionTracker.jobCompletionTimeouts.has(event.jobId)) {
                  clearTimeout(projectCompletionTracker.jobCompletionTimeouts.get(event.jobId));
                  projectCompletionTracker.jobCompletionTimeouts.delete(event.jobId);
                }

                if (projectCompletionTracker.projectCompletionReceived &&
                    projectCompletionTracker.sentJobCompletions >= projectCompletionTracker.expectedJobs) {
                  console.log(`[IMAGE] All job completions sent, triggering project completion`);
                  if (!projectFinished) {
                    projectFinished = true;
                    cleanup();

                    if (progressCallback && projectCompletionTracker.projectCompletionEvent) {
                      progressCallback(projectCompletionTracker.projectCompletionEvent);
                    }

                    resolve([]);
                  }
                }

                break;
              }
            }

            // Send the event to frontend
            if (progressEvent && progressCallback) {
              emitToProgressCallback(progressEvent);
            }

          } catch (jobHandlerError) {
            console.error(`[IMAGE] Error in job event handler:`, jobHandlerError);
          }
        };

        // Register the global job event handler
        try {
          sogniClient.projects.on('job', jobHandler);
          console.log('[IMAGE][GLOBAL] attached job handler for sdkProjectId', project.id);
        } catch (eventRegistrationError) {
          console.error(`[IMAGE] Error registering job event handler:`, eventRegistrationError);
        }

        // Set up cleanup function when project completes
        cleanup = () => {
          try {
            sogniClient.projects.off('job', jobHandler);
            console.log('[IMAGE][GLOBAL] detached job handler for sdkProjectId', project.id);
          } catch (err) {
            console.error(`[IMAGE] Error removing job event handler:`, err);
          }
        };

        // Handle job started events to assign job indices
        project.on('jobStarted', (job) => {
          const jobIndex = nextJobIndex++;
          projectCompletionTracker.jobIndexMap.set(job.id, jobIndex);
        });
      }

      // Handle project completion (all jobs done)
      project.on('completed', (imageUrls) => {
        if (projectFinished || projectCompletionTracker.projectCompletionReceived) {
          console.log('[IMAGE] Project completion already processed, ignoring duplicate');
          return;
        }

        console.log('[IMAGE] Project completed, all jobs finished. Total images:', imageUrls.length);

        const completionEvent = {
          type: 'completed',
          projectId: projectDetails.localProjectId || project.id,
          imageUrls: imageUrls,
          missingJobs: {
            expected: projectCompletionTracker.expectedJobs,
            completed: projectCompletionTracker.sentJobCompletions
          }
        };

        projectCompletionTracker.projectCompletionReceived = true;
        projectCompletionTracker.projectCompletionEvent = completionEvent;

        console.log(`[IMAGE] Project completion received: ${projectCompletionTracker.sentJobCompletions}/${projectCompletionTracker.expectedJobs} job completions sent`);

        if (projectCompletionTracker.sentJobCompletions >= projectCompletionTracker.expectedJobs) {
          console.log(`[IMAGE] All job completions already sent, sending project completion immediately`);
          if (!projectFinished) {
            projectFinished = true;
            cleanup();

            if (progressCallback) {
              emitToProgressCallback(completionEvent);
            }

            resolve(imageUrls);
          }
        } else {
          console.log(`[IMAGE] Waiting for ${projectCompletionTracker.expectedJobs - projectCompletionTracker.sentJobCompletions} more job completions`);

          // Set a failsafe timeout
          const failsafeTimeout = 3000;
          setTimeout(() => {
            console.log(`[IMAGE] Failsafe timeout reached, sending project completion`);
            if (!projectFinished) {
              // Send missing job completion events
              const missingJobCount = projectCompletionTracker.expectedJobs - projectCompletionTracker.sentJobCompletions;
              if (missingJobCount > 0 && project.jobs) {
                console.log(`[IMAGE] Failsafe: Sending ${missingJobCount} missing job completion events`);

                const completedJobs = project.jobs.filter(job => job.resultUrl || job.error);
                const sentJobIds = new Set();

                for (const [jobId] of projectCompletionTracker.jobIndexMap) {
                  if (projectCompletionTracker.sentJobCompletions > 0) {
                    sentJobIds.add(jobId);
                  }
                }

                for (const job of completedJobs) {
                  if (!sentJobIds.has(job.id) && projectCompletionTracker.sentJobCompletions < projectCompletionTracker.expectedJobs) {
                    const jobIndex = projectCompletionTracker.jobIndexMap.get(job.id) || 0;
                    const jobCompletionEvent = {
                      type: 'jobCompleted',
                      jobId: job.id,
                      projectId: projectDetails.localProjectId || project.id,
                      resultUrl: job.resultUrl,
                      positivePrompt: projectDetails.positivePrompt,
                      jobIndex: jobIndex,
                      isNSFW: job.isNSFW || false,
                      seed: job.seed,
                      steps: job.steps,
                      fallback: true
                    };

                    console.log(`[IMAGE] Failsafe: Sending missing job completion for ${job.id}`);
                    if (progressCallback) {
                      progressCallback(jobCompletionEvent);
                    }

                    projectCompletionTracker.sentJobCompletions++;
                    sentJobIds.add(job.id);
                  }
                }
              }

              projectFinished = true;
              cleanup();

              if (progressCallback) {
                emitToProgressCallback(completionEvent);
              }

              resolve(imageUrls);
            }
          }, failsafeTimeout);
        }
      });

      // Handle project failure
      project.on('failed', (error) => {
        console.error('[IMAGE] Project failed:', error);

        // Clear any remaining timeouts
        for (const timeoutId of projectCompletionTracker.jobCompletionTimeouts.values()) {
          clearTimeout(timeoutId);
        }
        projectCompletionTracker.jobCompletionTimeouts.clear();

        if (!projectFinished) {
          projectFinished = true;

          if (progressCallback) {
            cleanup();
          }

          const isAuthError = error.status === 401 ||
                             (error.payload && error.payload.errorCode === 107) ||
                             error.message?.includes('Invalid token');

          const isInsufficientFundsError = error.payload?.errorCode === 4024 ||
                                         error.message?.includes('Insufficient funds') ||
                                         error.message?.includes('Debit Error');

          let errorMessage = error.message || 'Image generation failed';
          if (isInsufficientFundsError) {
            errorMessage = 'Insufficient Sogni credits to generate images. Please add more credits to your account.';
          }

          if (progressCallback) {
            progressCallback({
              type: 'error',
              projectId: projectDetails.localProjectId || project.id,
              message: errorMessage,
              details: error.toString(),
              errorCode: isAuthError ? 'auth_error' :
                       isInsufficientFundsError ? 'insufficient_funds' :
                       (error.payload?.errorCode ? `api_error_${error.payload.errorCode}` : 'unknown_error'),
              status: error.status || 500,
              isAuthError: isAuthError,
              isInsufficientFunds: isInsufficientFundsError
            });
          }

          reject(new Error(errorMessage));
        }
      });

      // Timeout after 10 minutes (image-only, no video)
      setTimeout(() => {
        if (!projectFinished) {
          console.warn(`[IMAGE] Project ${project.id} timeout after 10 minutes`);

          for (const timeoutId of projectCompletionTracker.jobCompletionTimeouts.values()) {
            clearTimeout(timeoutId);
          }
          projectCompletionTracker.jobCompletionTimeouts.clear();

          if (progressCallback) {
            cleanup();
          }

          projectFinished = true;
          reject(new Error('Project timeout after 10 minutes'));
        }
      }, 10 * 60 * 1000);
    });
  };

  if (client) {
    return await runGeneration(client);
  }
  return await withSogniClient(runGeneration, 'image generation');
}

// ---------------------------------------------------------------------------
// Photo subject analysis via LLM vision
// ---------------------------------------------------------------------------

const SUBJECT_ANALYSIS_MODEL = 'qwen3.5-35b-a3b-gguf-q4km';

const SUBJECT_ANALYSIS_SYSTEM_PROMPT = `You are an eccentric legendary Hollywood stylist to the stars. Analyze the portrait photo as if the subject is the client sitting in your studio chair, ready to upgrade their look.

Return JSON with your professional assessment:
{
  "subjectCount": 1,
  "subjectDescription": "a young woman with long dark curly hair",
  "perceivedGender": "female",
  "genderConfidence": "high",
  "estimatedAgeRange": "25-30",
  "features": {
    "hairColor": "dark brown",
    "hairStyle": "long, curly",
    "hairLength": "long",
    "skinTone": "medium warm",
    "facialHair": null,
    "glasses": false,
    "distinctiveFeatures": ["killer cheekbones", "full lips"]
  },
  "stylistNotes": "That bone structure is begging for a dramatic side part. The warm skin tone opens up the whole copper-to-auburn palette."
}

Focus on: apparent gender, age range, hair (color/length/style), skin tone, facial hair, glasses, distinctive visible features. Do NOT mention clothing or background. The stylistNotes should be your candid professional read — what excites you about this client's potential.`;

export async function analyzePhotoSubject(imageBase64DataUri) {
  return withSogniClient(async (client) => {
    const messages = [
      { role: 'system', content: SUBJECT_ANALYSIS_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageBase64DataUri } },
          { type: 'text', text: 'Describe the main subject of this portrait.' },
        ],
      },
    ];

    let fullContent = '';
    const stream = await client.chat.completions.create({
      model: SUBJECT_ANALYSIS_MODEL,
      messages,
      stream: true,
      tokenType: 'spark',
      temperature: 0.1,
      top_p: 0.9,
      max_tokens: 300,
      think: false,
    });

    // SDK ChatStream yields { content, ... } directly
    for await (const chunk of stream) {
      if (chunk.content) fullContent += chunk.content;
    }

    // Parse JSON, handling markdown code fences
    let cleaned = fullContent.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();

    try {
      const parsed = JSON.parse(cleaned);
      return {
        subjectCount: typeof parsed.subjectCount === 'number' ? parsed.subjectCount : 1,
        subjectDescription: typeof parsed.subjectDescription === 'string' ? parsed.subjectDescription : 'the person',
        perceivedGender: ['male', 'female'].includes(parsed.perceivedGender) ? parsed.perceivedGender : null,
        genderConfidence: ['high', 'medium', 'low'].includes(parsed.genderConfidence) ? parsed.genderConfidence : 'low',
        estimatedAgeRange: typeof parsed.estimatedAgeRange === 'string' ? parsed.estimatedAgeRange : null,
        features: parsed.features || {},
        stylistNotes: typeof parsed.stylistNotes === 'string' ? parsed.stylistNotes : '',
      };
    } catch {
      return {
        subjectCount: 1,
        subjectDescription: 'the person',
        perceivedGender: null,
        genderConfidence: 'low',
        estimatedAgeRange: null,
        features: {},
        stylistNotes: '',
      };
    }
  }, 'photo subject analysis');
}

// ---------------------------------------------------------------------------
// Vision analysis proxy for demo users
// ---------------------------------------------------------------------------

export async function analyzeImageVision(imageUrl, systemPrompt) {
  return withSogniClient(async (client) => {
    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: 'Analyze this image.' },
        ],
      },
    ];

    let fullContent = '';
    const stream = await client.chat.completions.create({
      model: SUBJECT_ANALYSIS_MODEL,
      messages,
      stream: true,
      tokenType: 'spark',
      temperature: 0.3,
      max_tokens: 300,
      think: false,
    });

    // SDK ChatStream yields { content, ... } directly
    for await (const chunk of stream) {
      if (chunk.content) fullContent += chunk.content;
    }

    return fullContent;
  }, 'vision analysis');
}

// ---------------------------------------------------------------------------
// Chat completion proxy for demo users
// ---------------------------------------------------------------------------

const CHAT_MODEL = 'qwen3.5-35b-a3b-gguf-q4km';

export async function chatCompletion(messages, tools = []) {
  return withSogniClient(async (client) => {
    const params = {
      model: CHAT_MODEL,
      messages,
      stream: true,
      tokenType: 'spark',
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 500,
      think: false,
    };

    if (tools.length > 0) {
      params.tools = tools;
    }

    return client.chat.completions.create(params);
  }, 'chat completion');
}

// Client info for debugging
export async function getClientInfo(sessionId) {
  try {
    const client = await getOrCreateGlobalSogniClient();

    return {
      appId: client.appId,
      isAuthenticated: client.account.currentAccount.isAuthenicated,
      networkStatus: client.account.currentAccount.networkStatus,
      network: client.account.currentAccount.network,
      hasToken: !!client.account.currentAccount.token,
      hasRefreshToken: !!client.account.currentAccount.refreshToken,
      walletAddress: client.account.currentAccount.walletAddress,
      username: client.account.currentAccount.username,
      balance: client.account.currentAccount.balance,
      sessionId: sessionId,
      globalClientActive: !!globalSogniClient,
      activeConnectionsCount: activeConnections.size
    };
  } catch (error) {
    console.error('[INFO] Error getting client info:', error);
    return {
      error: error.message,
      sessionId: sessionId,
      globalClientActive: !!globalSogniClient,
      activeConnectionsCount: activeConnections.size
    };
  }
}

// Backwards compatibility
export async function initializeSogniClient() {
  return getOrCreateGlobalSogniClient();
}

// Simplified cleanup - only affects global client
export async function cleanupSogniClient({ logout = false, includeSessionClients = false } = {}) {
  console.log(`[CLEANUP] Cleaning up Sogni connections (logout: ${logout})`);

  if (globalSogniClient) {
    try {
      if (logout) {
        console.log(`[CLEANUP] Logging out global client: ${globalSogniClient.appId}`);
        await globalSogniClient.account.logout();
      }

      if (activeConnections.has(globalSogniClient.appId)) {
        activeConnections.delete(globalSogniClient.appId);
        connectionLastActivity.delete(globalSogniClient.appId);
      }

      console.log(`[CLEANUP] Global client cleaned up`);
    } catch (error) {
      console.error('[CLEANUP] Error during global client cleanup:', error);
    }

    if (logout) {
      globalSogniClient = null;
      clientCreationPromise = null;
    }
  }

  if (includeSessionClients) {
    sessionClients.clear();
    console.log('[CLEANUP] Session client mappings cleared');
  }

  console.log('[CLEANUP] Sogni client cleanup completed');
  return true;
}

// Idle connection checking
export const checkIdleConnections = async () => {
  const now = Date.now();
  const idleThreshold = 2 * 60 * 60 * 1000; // 2 hours

  for (const [clientId, lastActivity] of connectionLastActivity.entries()) {
    if (now - lastActivity > idleThreshold) {
      console.log(`[IDLE] Client ${clientId} has been idle for ${Math.round((now - lastActivity) / 60000)} minutes`);

      if (clientId === globalSogniClient?.appId) {
        // Keep global client active since tokens are valid for 24h
        if (Math.round((now - lastActivity) / 60000) % 60 === 0) {
          console.log(`[IDLE] Global client idle but maintaining connection (tokens valid for 24h)`);
        }
      } else {
        // Clean up any orphaned connections
        activeConnections.delete(clientId);
        connectionLastActivity.delete(clientId);
      }
    }
  }
};

// Setup periodic idle checking
const idleCheckInterval = setInterval(checkIdleConnections, 5 * 60 * 1000);

// Export cleanup for use by index.js graceful shutdown
export async function shutdownSogniServices() {
  clearInterval(idleCheckInterval);
  console.log('Cleaning up Sogni connections before shutdown...');
  try {
    await cleanupSogniClient({ logout: true });
    console.log('Completed Sogni cleanup on shutdown');
  } catch (error) {
    console.error('Error during shutdown cleanup:', error);
  }
}
