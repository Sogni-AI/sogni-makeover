import express from 'express';
import { getClientInfo, generateImage, cleanupSogniClient, getSessionClient, disconnectSessionClient, getActiveConnectionsCount, checkIdleConnections, activeConnections, sessionClients, clearInvalidTokens, validateAuthError } from '../services/sogni.js';
import { v4 as uuidv4 } from 'uuid';
import { redactProjectResult } from '../utils/logRedaction.js';
import process from 'process';
import { Buffer } from 'buffer';

const router = express.Router();

// Map to store active project SSE connections (legacy)
const activeProjects = new Map();

// Map to store active client SSE connections (for multiple concurrent projects)
const activeClients = new Map();

// Map to store pending events for projects that don't have SSE clients yet
const pendingProjectEvents = new Map();

// Track cleanup timers for pending events (one per project)
const pendingCleanupTimers = new Map();

// Timer for delayed Sogni cleanup
let sogniCleanupTimer = null;
const SOGNI_CLEANUP_DELAY_MS = 30 * 1000; // 30 seconds

// Track recent disconnect requests to prevent duplicates
const recentDisconnectRequests = new Map();
const DISCONNECT_CACHE_TTL = 3000; // 3 seconds

// Middleware to ensure session ID cookie exists
const ensureSessionId = (req, res, next) => {
  const sessionCookieName = 'sogni_session_id';
  let sessionId = req.cookies?.[sessionCookieName];

  console.log(`[SESSION] Cookie check for ${sessionCookieName}: ${sessionId || 'not found'}`);

  if (!sessionId) {
    sessionId = `sid-${uuidv4()}`;

    const isSecureContext = req.secure ||
                            req.headers['x-forwarded-proto'] === 'https' ||
                            process.env.NODE_ENV === 'production' ||
                            req.headers.origin?.startsWith('https:');

    const origin = req.headers.origin;

    const sameSiteSetting = (origin && origin.startsWith('https:')) ? 'none' : 'lax';
    const secure = isSecureContext || sameSiteSetting === 'none';

    console.log(`[SESSION] Creating new session ID: ${sessionId}, Secure: ${secure}, SameSite: ${sameSiteSetting}`);

    res.cookie(sessionCookieName, sessionId, {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: secure,
      sameSite: sameSiteSetting,
      path: '/'
    });
  } else {
    console.log(`[SESSION] Using existing session ID: ${sessionId}`);
  }

  req.sessionId = sessionId;
  next();
};

// Helper function to forward events to SSE connections
function forwardEventToSSE(localProjectId, clientAppId, sseEvent, sessionId) {
  let totalClients = 0;

  // Send to project-based connections (legacy)
  if (activeProjects.has(localProjectId)) {
    const projectClients = activeProjects.get(localProjectId);
    projectClients.forEach(client => {
      sendSSEMessage(client, sseEvent);
    });
    totalClients += projectClients.size;
  }

  // Send to client-based connections
  if (clientAppId && activeClients.has(clientAppId)) {
    const clientConnections = activeClients.get(clientAppId);
    clientConnections.forEach(client => {
      sendSSEMessage(client, sseEvent);
    });
    totalClients += clientConnections.size;
  }

  if (totalClients > 0) {
    console.log(`[${localProjectId}] Forwarded '${sseEvent.type}' event to ${totalClients} SSE client(s)`);
  } else {
    console.log(`[${localProjectId}] No SSE clients found - storing event for later pickup`);
    if (!pendingProjectEvents.has(localProjectId)) {
      pendingProjectEvents.set(localProjectId, []);
    }
    const eventWithClient = { ...sseEvent, clientAppId, sessionId };
    pendingProjectEvents.get(localProjectId).push(eventWithClient);

    // Set a single cleanup timer per project (2 minutes)
    if (!pendingCleanupTimers.has(localProjectId)) {
      const timer = setTimeout(() => {
        pendingProjectEvents.delete(localProjectId);
        pendingCleanupTimers.delete(localProjectId);
      }, 2 * 60 * 1000);
      pendingCleanupTimers.set(localProjectId, timer);
    }
  }
}

const sendSSEMessage = (client, data) => {
  if (!client || !client.writable) {
    return false;
  }

  try {
    // Map backend event types to frontend SSE event names
    let eventName = data.type || 'message';
    const eventData = { ...data };

    // Map 'completed' -> 'complete' and normalize data for frontend
    if (eventName === 'completed') {
      eventName = 'complete';
      if (eventData.imageUrls && !eventData.imageUrl) {
        eventData.imageUrl = eventData.imageUrls[0] || '';
      }
    }

    // Map resultUrl -> imageUrl for jobCompleted events
    if (eventName === 'jobCompleted' && eventData.resultUrl && !eventData.imageUrl) {
      eventData.imageUrl = eventData.resultUrl;
    }

    const message = `event: ${eventName}\ndata: ${JSON.stringify(eventData)}\n\n`;
    return client.write(message);
  } catch (error) {
    console.error('Error sending SSE message:', error);
    return false;
  }
};

// OPTIONS handler for /status endpoint
router.options('/status', (req, res) => {
  res.status(204).end();
});

// Test connection to Sogni - get SDK connection status
router.get('/status', ensureSessionId, async (req, res) => {
  try {
    const clientAppId = req.headers['x-client-app-id'] || req.query.clientAppId;
    const status = await getClientInfo(req.sessionId, clientAppId);

    res.json({
      ...status,
      sessionId: req.sessionId
    });
  } catch (error) {
    console.error('Error getting Sogni client status:', error);

    if (error.code === 'ECONNREFUSED') {
      res.status(502).json({
        error: 'Backend unavailable',
        message: 'Could not connect to Sogni API. Connection refused.',
        details: 'This is likely due to network connectivity issues to the Sogni API.'
      });
    } else if (error.message && error.message.includes('Invalid credentials')) {
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid Sogni credentials. Please check your .env file.',
        details: 'This error occurs when the Sogni API rejects the username and password combination.'
      });
    } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      res.status(504).json({
        error: 'Gateway timeout',
        message: 'Connection to Sogni API timed out',
        details: 'The request took too long to complete. Check your network connection or try again later.'
      });
    } else {
      res.status(500).json({
        error: 'Failed to connect to Sogni services',
        message: error.message,
        details: JSON.stringify(error)
      });
    }
  }
});

// OPTIONS handler for /progress/:projectId endpoint
router.options('/progress/:projectId', (req, res) => {
  res.status(204).end();
});

// Client-based SSE endpoint for multiple concurrent projects
router.get('/progress/client', ensureSessionId, (req, res) => {
  const clientAppId = req.query.clientAppId;

  if (!clientAppId) {
    return res.status(400).json({ error: 'clientAppId is required' });
  }

  console.log(`SSE connection request for client: ${clientAppId}`);

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Encoding', 'identity');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send immediate response
  res.write(`event: connected\ndata: ${JSON.stringify({ type: 'connected', clientId: clientAppId, timestamp: Date.now() })}\n\n`);

  try {
    res.flushHeaders();
  } catch (err) {
    console.error(`Error flushing headers: ${err.message}`);
  }

  // Set up client tracking
  if (!activeClients.has(clientAppId)) {
    activeClients.set(clientAppId, new Set());
  }
  activeClients.get(clientAppId).add(res);

  // Send any pending events for this client
  for (const [projectId, events] of pendingProjectEvents.entries()) {
    if (events.length > 0 && events[0].clientAppId === clientAppId) {
      console.log(`[${clientAppId}] Sending ${events.length} stored events for project ${projectId}`);
      try {
        for (const event of events) {
          sendSSEMessage(res, event);
        }
        pendingProjectEvents.delete(projectId);
      } catch (error) {
        console.error(`Error sending pending events for client ${clientAppId}:`, error);
      }
    }
  }

  // Heartbeat to keep connection alive through proxies
  const heartbeatInterval = setInterval(() => {
    if (res.writable) {
      try { res.write(':\n\n'); } catch { clearInterval(heartbeatInterval); }
    } else {
      clearInterval(heartbeatInterval);
    }
  }, 15000);

  // Safety timeout (5 minutes)
  const connectionTimeout = setTimeout(() => {
    clearInterval(heartbeatInterval);
    if (res.writable) {
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ type: 'timeout', message: 'Connection timed out' })}\n\n`);
        res.end();
      } catch { /* ignore */ }
    }
  }, 5 * 60 * 1000);

  const cleanupClient = () => {
    clearInterval(heartbeatInterval);
    clearTimeout(connectionTimeout);
    if (activeClients.has(clientAppId)) {
      activeClients.get(clientAppId).delete(res);
      if (activeClients.get(clientAppId).size === 0) {
        activeClients.delete(clientAppId);
      }
    }
  };

  // Handle client disconnect
  req.on('close', () => {
    console.log(`[${clientAppId}] Client disconnected from SSE stream`);
    cleanupClient();
  });

  req.on('error', (err) => {
    console.error(`[${clientAppId}] SSE connection error:`, err);
    cleanupClient();
  });
});

// SSE endpoint for getting real-time progress updates (legacy - per project)
router.get('/progress/:projectId', ensureSessionId, (req, res) => {
  const projectId = req.params.projectId;
  const clientAppId = req.headers['x-client-app-id'] || req.query.clientAppId;

  console.log(`SSE connection request for project: ${projectId}, client: ${clientAppId || 'none'}`);

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Encoding', 'identity');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send immediate response
  res.write(`event: connected\ndata: ${JSON.stringify({ type: 'connected', projectId, timestamp: Date.now() })}\n\n`);

  try {
    res.flushHeaders();
  } catch (err) {
    console.error(`Error flushing headers: ${err.message}`);
  }

  // Set up client tracking
  if (!activeProjects.has(projectId)) {
    activeProjects.set(projectId, new Set());
  }
  activeProjects.get(projectId).add(res);

  // Check for any pending events
  if (pendingProjectEvents.has(projectId)) {
    const events = pendingProjectEvents.get(projectId);
    console.log(`[${projectId}] Sending ${events.length} stored events to newly connected SSE client`);

    try {
      for (const event of events) {
        sendSSEMessage(res, event);
      }
      res.flushHeaders();
      pendingProjectEvents.delete(projectId);
    } catch (err) {
      console.error(`[${projectId}] Error sending pending events:`, err.message);
    }
  }

  // Check for pending errors
  if (globalThis.pendingProjectErrors && globalThis.pendingProjectErrors.has(projectId)) {
    const errorEvent = globalThis.pendingProjectErrors.get(projectId);
    console.log(`[${projectId}] Sending stored error event to newly connected SSE client`);

    try {
      sendSSEMessage(res, errorEvent);
      res.flushHeaders();
      globalThis.pendingProjectErrors.delete(projectId);
    } catch (err) {
      console.error(`Error sending pending error event: ${err.message}`);
    }
  }

  // Cancel any pending cleanup since a user is now connected
  if (sogniCleanupTimer) {
    clearTimeout(sogniCleanupTimer);
    sogniCleanupTimer = null;
  }

  // Heartbeat every 15 seconds
  const heartbeatInterval = setInterval(() => {
    if (res.writable) {
      try {
        res.write(":\n\n");
      } catch (err) {
        clearInterval(heartbeatInterval);
      }
    } else {
      clearInterval(heartbeatInterval);
    }
  }, 15000);

  // Safety timeout - 5 minutes max connection time
  const connectionTimeout = setTimeout(() => {
    clearInterval(heartbeatInterval);

    try {
      if (res.writable) {
        res.write(`event: error\ndata: ${JSON.stringify({ type: 'timeout', projectId, message: 'Connection timed out' })}\n\n`);
        res.end();
      }
    } catch (err) {
      // Silent catch - connection likely already closed
    }

    if (activeProjects.has(projectId)) {
      activeProjects.get(projectId).delete(res);
      if (activeProjects.get(projectId).size === 0) {
        activeProjects.delete(projectId);
      }
    }
  }, 5 * 60 * 1000);

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    clearTimeout(connectionTimeout);

    if (activeProjects.has(projectId)) {
      activeProjects.get(projectId).delete(res);
      if (activeProjects.get(projectId).size === 0) {
        activeProjects.delete(projectId);
      }
    }

    // If no active projects remain, schedule Sogni cleanup
    if (activeProjects.size === 0) {
      if (sogniCleanupTimer) clearTimeout(sogniCleanupTimer);
      sogniCleanupTimer = setTimeout(() => {
        cleanupSogniClient({ logout: false });
      }, SOGNI_CLEANUP_DELAY_MS);
    }
  });

  req.on('error', () => {
    clearInterval(heartbeatInterval);
    clearTimeout(connectionTimeout);

    if (activeProjects.has(projectId)) {
      activeProjects.get(projectId).delete(res);
      if (activeProjects.get(projectId).size === 0) {
        activeProjects.delete(projectId);
      }
    }
  });
});

// Cancel project
router.post('/cancel/:projectId', ensureSessionId, async (req, res) => {
  const projectId = req.params.projectId;

  try {
    const clientAppId = req.headers['x-client-app-id'] || req.body.clientAppId || req.query.clientAppId;
    console.log(`Request to cancel project ${projectId} for session ${req.sessionId} with app ID: ${clientAppId || 'none provided'}`);

    const client = await getSessionClient(req.sessionId, clientAppId);
    await client.projects.cancel(projectId);

    // Notify any connected clients
    if (activeProjects.has(projectId)) {
      const clients = activeProjects.get(projectId);
      clients.forEach(client => {
        if (client.writable) {
          client.write(`event: error\ndata: ${JSON.stringify({ type: 'cancelled', projectId, message: 'Generation cancelled' })}\n\n`);
        }
      });
    }

    res.json({ status: 'cancelled', projectId });
  } catch (error) {
    console.error(`Error cancelling project ${projectId}:`, error);
    res.status(500).json({ error: 'Failed to cancel project', message: error.message });
  }
});

// Cost estimation endpoint
router.post('/estimate-cost', ensureSessionId, async (req, res) => {
  try {
    const {
      network = 'fast',
      previewCount = 10,
      scheduler = 'simple',
      guidance = 2,
      contextImages = 0,
      tokenType = 'spark'
    } = req.body;

    // Accept both frontend naming (modelId, steps, numberOfMedia) and backend naming (model, stepCount, imageCount)
    const model = req.body.model || req.body.modelId;
    const imageCount = parseInt(req.body.imageCount || req.body.numberOfMedia) || 1;
    const stepCount = parseInt(req.body.stepCount || req.body.steps) || 7;

    if (!model) {
      return res.status(400).json({ error: 'Model is required for cost estimation' });
    }

    const clientAppId = req.headers['x-client-app-id'] || req.body.clientAppId || req.query.clientAppId || `user-${req.sessionId}-${Date.now()}`;
    const client = await getSessionClient(req.sessionId, clientAppId);

    const result = await client.projects.estimateCost({
      network,
      model,
      imageCount,
      previewCount,
      stepCount,
      scheduler,
      guidance,
      contextImages,
      tokenType
    });

    res.json(result);
  } catch (error) {
    console.error('Error estimating cost:', error);
    res.status(500).json({ error: 'Failed to estimate cost', message: error.message });
  }
});

// OPTIONS handler for /generate endpoint
router.options('/generate', (req, res) => {
  res.status(204).end();
});

// Generate image with project tracking
router.post('/generate', ensureSessionId, async (req, res) => {
  const localProjectId = `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[${localProjectId}] Starting image generation request for session ${req.sessionId}...`);

  try {
    let clientAppId = req.headers['x-client-app-id'] || req.body.clientAppId || req.query.clientAppId;
    if (!clientAppId) {
      clientAppId = `user-${req.sessionId}-${Date.now()}`;
      console.log(`[${localProjectId}] Generated unique client app ID for session: ${clientAppId}`);
    } else {
      console.log(`[${localProjectId}] Using provided client app ID: ${clientAppId}`);
    }

    // Server-side image generation caps
    const requestedImages = parseInt(req.body.numberOfMedia) || 1;

    if (requestedImages > 8) {
      console.log(`[${localProjectId}] REJECTED: Requested ${requestedImages} images, max allowed is 8`);
      return res.status(400).json({
        error: 'Image generation limit exceeded',
        message: `Limited to 8 images per project. Requested: ${requestedImages}`,
        maxAllowed: 8
      });
    }

    // Extract parameters from request body
    const modelId = req.body.modelId || 'qwen_image_edit_2511_fp8_lightning';
    const positivePrompt = req.body.positivePrompt || '';
    const negativePrompt = req.body.negativePrompt || '';
    const width = Math.max(256, Math.min(2048, parseInt(req.body.width) || 1024));
    const height = Math.max(256, Math.min(2048, parseInt(req.body.height) || 1536));
    const guidance = Math.max(0.6, Math.min(20, parseFloat(req.body.guidance) || 1));
    const steps = Math.max(1, Math.min(50, parseInt(req.body.steps) || 4));
    const sampler = req.body.sampler || 'euler';
    const scheduler = req.body.scheduler || 'simple';
    const outputFormat = req.body.outputFormat || 'jpg';
    const numberOfMedia = requestedImages;
    const denoisingStrength = req.body.denoisingStrength !== undefined ? Math.max(0.1, Math.min(0.99, parseFloat(req.body.denoisingStrength) || 0.65)) : undefined;
    const tokenType = req.body.tokenType || 'spark';

    // Process context images from base64
    let contextImages = null;
    if (req.body.contextImages && Array.isArray(req.body.contextImages)) {
      try {
        contextImages = req.body.contextImages.map(img => {
          if (typeof img === 'string') {
            if (img.startsWith('data:')) {
              const base64Data = img.split(',')[1];
              if (!base64Data) throw new Error('Invalid data URL format');
              return Buffer.from(base64Data, 'base64');
            }
            return Buffer.from(img, 'base64');
          }
          return img;
        });
      } catch (error) {
        return res.status(400).json({ error: 'Invalid context image format', message: error.message });
      }
      console.log(`[${localProjectId}] Processed ${contextImages.length} context image(s)`);
    }

    console.log(`[${localProjectId}] Generation params - Model: ${modelId}, Size: ${width}x${height}, Steps: ${steps}, Images: ${numberOfMedia}`);

    // Track progress events
    let hasReceivedFirstEvent = false;
    let firstEventResolve = null;
    const firstEventPromise = new Promise((resolve) => {
      firstEventResolve = resolve;
    });

    let lastProgressUpdate = Date.now();
    const progressHandler = (eventData) => {
      // Signal that we've received the first event from Sogni
      if (!hasReceivedFirstEvent && (eventData.type === 'queued' || eventData.type === 'started' || eventData.type === 'initiating')) {
        hasReceivedFirstEvent = true;
        if (firstEventResolve) {
          firstEventResolve();
          firstEventResolve = null;
        }
      }

      // Throttle SSE updates
      const now = Date.now();
      if (now - lastProgressUpdate < 500 && eventData.type === 'progress' && (eventData.progress !== 0 && eventData.progress !== 1)) {
        return;
      }
      lastProgressUpdate = now;

      // Build SSE event
      const { jobId: originalJobId, ...eventDataWithoutJobId } = eventData;
      const sseEvent = {
        ...eventDataWithoutJobId,
        projectId: localProjectId,
        workerName: eventData.workerName || 'Worker',
        progress: typeof eventData.progress === 'number' ?
                  (eventData.progress > 1 ? eventData.progress / 100 : eventData.progress) :
                  eventData.progress,
      };

      if (originalJobId !== undefined) {
        sseEvent.jobId = originalJobId;
      }

      // Handle the 'queued' event specifically
      if (eventData.type === 'queued') {
        const queuedEvent = {
          type: 'queued',
          projectId: localProjectId,
          queuePosition: eventData.queuePosition,
        };
        forwardEventToSSE(localProjectId, clientAppId, queuedEvent, req.sessionId);
        return;
      }

      // Forward all events (forwardEventToSSE stores pending events when no clients are connected)
      forwardEventToSSE(localProjectId, clientAppId, sseEvent, req.sessionId);

      // Trim pending events to prevent unbounded growth
      if (pendingProjectEvents.has(localProjectId)) {
        const events = pendingProjectEvents.get(localProjectId);
        if (events.length > 50) {
          events.splice(0, events.length - 50);
        }
      }

      // Handle error events for late-connecting clients
      if (eventData.type === 'failed' || eventData.type === 'error') {
        if (!globalThis.pendingProjectErrors) {
          globalThis.pendingProjectErrors = new Map();
        }
        const isInsufficientFundsError = (eventData.error && eventData.error.code === 4024) ||
                                         (eventData.error && eventData.error.message && eventData.error.message.includes('Insufficient funds')) ||
                                         (eventData.error && eventData.error.message && eventData.error.message.includes('Debit Error'));
        let errorMessage = (eventData.error && eventData.error.message) || eventData.message || 'Image generation failed';
        if (isInsufficientFundsError) {
          errorMessage = 'Insufficient Sogni credits to generate images. Please add more credits to your account.';
        }
        const errorEvent = {
          type: 'error',
          projectId: localProjectId,
          message: errorMessage,
          details: eventData.error ? JSON.stringify(eventData.error) : 'Unknown error',
          errorCode: isInsufficientFundsError ? 'insufficient_funds' :
                   (eventData.error && eventData.error.code ? `api_error_${eventData.error.code}` : 'unknown_error'),
          status: 500,
          isInsufficientFunds: isInsufficientFundsError
        };
        globalThis.pendingProjectErrors.set(localProjectId, errorEvent);
        setTimeout(() => {
          if (globalThis.pendingProjectErrors) {
            globalThis.pendingProjectErrors.delete(localProjectId);
          }
        }, 30000);
      }
    };

    // Get or create a client for this session
    const client = await getSessionClient(req.sessionId, clientAppId);
    const params = {
      modelId,
      positivePrompt,
      negativePrompt,
      contextImages,
      width,
      height,
      guidance,
      steps,
      sampler,
      scheduler,
      outputFormat,
      numberOfMedia,
      tokenType,
      clientAppId,
      ...(denoisingStrength !== undefined ? { denoisingStrength } : {})
    };

    // Helper function to attempt generation with retry on auth failure
    const attemptGeneration = async (clientToUse, isRetry = false) => {
      return generateImage(clientToUse, params, progressHandler, localProjectId)
        .then((sogniResult) => {
          const redactedResult = redactProjectResult(sogniResult);
          console.log(`[${localProjectId}] Sogni generation process finished.`);
        })
        .catch(async (error) => {
          console.error(`[${localProjectId}] Sogni generation failed${isRetry ? ' (retry attempt)' : ''}:`, error);

          const isAuthError = error.status === 401 ||
                             (error.payload && error.payload.errorCode === 107) ||
                             error.message?.includes('Invalid token') ||
                             error.message?.includes('Authentication required');

          const isInsufficientFundsError = error.payload?.errorCode === 4024 ||
                                         error.message?.includes('Insufficient funds') ||
                                         error.message?.includes('Debit Error');

          // If auth error and not already a retry, validate and retry
          if (isAuthError && !isRetry) {
            console.log(`[${localProjectId}] Potential auth error detected, validating...`);

            try {
              const isRealAuthError = await validateAuthError(error);

              if (isRealAuthError) {
                console.log(`[${localProjectId}] Confirmed auth error, attempting retry with fresh client`);
                clearInvalidTokens();

                const sessionId = req.sessionId;
                if (sessionId && sessionClients.has(sessionId)) {
                  sessionClients.delete(sessionId);
                }

                try {
                  const freshClient = await getSessionClient(sessionId, clientAppId);
                  return await attemptGeneration(freshClient, true);
                } catch (retryError) {
                  console.error(`[${localProjectId}] Retry attempt failed:`, retryError);
                }
              }
            } catch (validationError) {
              console.error(`[${localProjectId}] Error validation failed:`, validationError);
            }
          }

          if (isAuthError) {
            clearInvalidTokens();
            const sessionId = req.sessionId;
            if (sessionId && sessionClients.has(sessionId)) {
              sessionClients.delete(sessionId);
            }
          }

          throw error;
        });
    };

    // Start the generation process but don't wait for completion
    attemptGeneration(client)
      .catch(error => {
        const isAuthError = (error.payload && error.payload.errorCode === 107) ||
                           error.message?.includes('Invalid token') ||
                           error.message?.includes('Authentication required');

        const isInsufficientFundsError = error.payload?.errorCode === 4024 ||
                                       error.message?.includes('Insufficient funds') ||
                                       error.message?.includes('Debit Error');

        if (activeProjects.has(localProjectId)) {
          const clients = activeProjects.get(localProjectId);
          let errorMessage = error.message || 'Image generation failed';

          if (isInsufficientFundsError) {
            errorMessage = 'Insufficient Sogni credits to generate images. Please add more credits to your account.';
          }

          const errorEvent = {
            type: 'error',
            projectId: localProjectId,
            message: errorMessage,
            details: error.toString(),
            errorCode: isAuthError ? 'auth_error' :
                     isInsufficientFundsError ? 'insufficient_funds' :
                     (error.payload?.errorCode ? `api_error_${error.payload.errorCode}` : 'unknown_error'),
            status: error.status || 500,
            isAuthError: isAuthError,
            isInsufficientFunds: isInsufficientFundsError
          };
          clients.forEach((client) => {
            sendSSEMessage(client, errorEvent);
          });
        } else {
          // Store the error for later pickup
          if (!globalThis.pendingProjectErrors) {
            globalThis.pendingProjectErrors = new Map();
          }

          let errorMessage = error.message || 'Image generation failed';
          if (isInsufficientFundsError) {
            errorMessage = 'Insufficient Sogni credits to generate images. Please add more credits to your account.';
          }

          const errorEvent = {
            type: 'error',
            projectId: localProjectId,
            message: errorMessage,
            details: error.toString(),
            errorCode: isAuthError ? 'auth_error' :
                     isInsufficientFundsError ? 'insufficient_funds' :
                     (error.payload?.errorCode ? `api_error_${error.payload.errorCode}` : 'unknown_error'),
            status: error.status || 500,
            isAuthError: isAuthError,
            isInsufficientFunds: isInsufficientFundsError
          };

          globalThis.pendingProjectErrors.set(localProjectId, errorEvent);

          setTimeout(() => {
            if (globalThis.pendingProjectErrors) {
              globalThis.pendingProjectErrors.delete(localProjectId);
            }
          }, 30000);
        }

        // Signal completion of first event check even on error
        if (!hasReceivedFirstEvent && firstEventResolve) {
          firstEventResolve();
          firstEventResolve = null;
        }
      });

    // Respond immediately to allow SSE connection to establish quickly
    console.log(`[${localProjectId}] Responding immediately to allow fast SSE connection establishment`);

    res.json({
      status: 'processing',
      projectId: localProjectId,
      message: 'Image generation request received and processing started.',
      clientAppId: clientAppId
    });
  } catch (error) {
    console.error(`[${localProjectId}] Error in POST /generate handler:`, error);
    res.status(500).json({
      error: 'Failed to initiate image generation',
      message: error.message,
      errorDetails: { name: error.name, message: error.message }
    });
  }
});

// OPTIONS handler for disconnect endpoint
router.options('/disconnect', (req, res) => {
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-App-ID, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  res.status(204).end();
});

// Helper to check and cache disconnect requests
const cacheDisconnectRequest = (key) => {
  if (recentDisconnectRequests.has(key)) {
    return true;
  }

  recentDisconnectRequests.set(key, Date.now());

  setTimeout(() => {
    recentDisconnectRequests.delete(key);
  }, DISCONNECT_CACHE_TTL);

  return false;
};

// Explicit disconnect endpoint
router.post('/disconnect', ensureSessionId, async (req, res) => {
  try {
    console.log(`Explicit disconnect request for session ${req.sessionId}`);

    const clientAppId = req.headers['x-client-app-id'] || req.body?.clientAppId;
    console.log(`Disconnect request with clientAppId: ${clientAppId || 'none'}`);

    const requestKey = `${req.sessionId}:${clientAppId || 'no-client-id'}:POST`;

    if (cacheDisconnectRequest(requestKey)) {
      console.log(`Skipping duplicate POST disconnect request for session ${req.sessionId}`);
      res.setHeader('Connection', 'close');
      res.setHeader('Cache-Control', 'no-store, no-cache');
      return res.status(200).send({ success: true, cached: true });
    }

    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-App-ID');
    }

    let hasClient = false;

    if (clientAppId && activeConnections.has(clientAppId)) {
      hasClient = true;
    } else if (sessionClients.has(req.sessionId)) {
      const clientId = sessionClients.get(req.sessionId);
      if (activeConnections.has(clientId)) {
        hasClient = true;
      }
    }

    let result = false;
    if (hasClient) {
      console.log(`Found active client for session ${req.sessionId}, disconnecting...`);
      result = await disconnectSessionClient(req.sessionId, clientAppId);
    } else {
      console.log(`No active client found for session ${req.sessionId}, skipping disconnect`);
    }

    res.setHeader('Connection', 'close');
    res.setHeader('Cache-Control', 'no-store, no-cache');

    res.status(200).send({ success: true });

    console.log(`Session ${req.sessionId} disconnect attempt: ${result ? 'success' : 'no client found or no action needed'}`);
  } catch (error) {
    console.error(`Error disconnecting session ${req.sessionId}:`, error);
    res.status(500).json({ error: 'Failed to disconnect session', message: error.message });
  }
});

// Image proxy to bypass CORS for S3 image downloads
router.get('/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;

  if (!imageUrl) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  // Only allow proxying from trusted S3 domains
  const allowedDomains = [
    'complete-images-production.s3-accelerate.amazonaws.com',
    'complete-images-staging.s3-accelerate.amazonaws.com',
    'complete-images-production.s3.amazonaws.com',
    'complete-images-staging.s3.amazonaws.com',
    's3.amazonaws.com',
    's3-accelerate.amazonaws.com'
  ];

  try {
    const url = new URL(imageUrl);
    const isAllowed = allowedDomains.some(domain =>
      url.hostname === domain || url.hostname.endsWith(`.${domain}`)
    );

    if (!isAllowed) {
      console.warn(`[Image Proxy] Blocked request to untrusted domain: ${url.hostname}`);
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    console.log(`[Image Proxy] Fetching: ${imageUrl.slice(0, 100)}...`);

    const response = await fetch(imageUrl);

    if (!response.ok) {
      console.error(`[Image Proxy] Upstream error: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({
        error: 'Failed to fetch image',
        status: response.status
      });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));

  } catch (error) {
    if (error instanceof TypeError) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
    console.error('[Image Proxy] Unexpected error:', error);
    res.status(500).json({ error: 'Failed to proxy image' });
  }
});

export default router;
