import express from 'express';
import { chatCompletion } from '../services/sogni.js';

const router = express.Router();

// Origin validation: only allow *.sogni.ai (block missing origin)
function validateOrigin(req, res, next) {
  const origin = req.get('origin') || req.get('referer') || '';
  if (!origin || !origin.match(/^https?:\/\/[^/]*\.sogni\.ai(:\d+)?(\/|$)/)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

router.use(validateOrigin);

// SSE streaming chat completion for demo users
router.post('/completions', async (req, res) => {
  const { messages, tools } = req.body;
  const max_tokens = typeof req.body.max_tokens === 'number' ? Math.max(1, Math.min(16000, req.body.max_tokens)) : undefined;
  const temperature = typeof req.body.temperature === 'number' ? Math.max(0, Math.min(2, req.body.temperature)) : undefined;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  if (tools && !Array.isArray(tools)) {
    return res.status(400).json({ error: 'tools must be an array' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Guard against writing to a closed response (e.g. after timeout)
  let responseClosed = false;
  const safeWrite = (data) => {
    if (!responseClosed) res.write(data);
  };

  // Heartbeat to prevent proxy/Nginx idle-connection timeouts
  const heartbeat = setInterval(() => {
    safeWrite(':\n\n');
  }, 15000);

  // Safety timeout (2 minutes)
  const timeout = setTimeout(() => {
    responseClosed = true;
    safeWrite(`event: error\ndata: ${JSON.stringify({ message: 'Request timeout', code: 'timeout' })}\n\n`);
    res.end();
  }, 120000);

  try {
    const stream = await chatCompletion(messages, tools || [], { max_tokens, temperature });

    let toolCalls = [];
    let completeSent = false;

    // SDK ChatStream yields { content, tool_calls, finishReason } directly
    for await (const chunk of stream) {
      if (responseClosed) break;

      // Stream text content
      if (chunk.content) {
        safeWrite(`event: token\ndata: ${JSON.stringify({ content: chunk.content })}\n\n`);
      }

      // Accumulate tool calls from streamed chunks
      if (chunk.tool_calls) {
        for (const tc of chunk.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls[idx]) {
            toolCalls[idx] = { id: tc.id || '', name: '', arguments: '' };
          }
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.function?.name) toolCalls[idx].name = tc.function.name;
          if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
        }
      }

      // Send finish reason
      if (chunk.finishReason) {
        if (toolCalls.length > 0) {
          for (const tc of toolCalls) {
            safeWrite(`event: tool_call\ndata: ${JSON.stringify(tc)}\n\n`);
          }
        }
        safeWrite(`event: complete\ndata: ${JSON.stringify({
          finishReason: chunk.finishReason,
          usage: chunk.usage || null,
        })}\n\n`);
        completeSent = true;
      }
    }

    // Check stream.toolCalls as fallback — only when no tool calls arrived during streaming
    if (!responseClosed && toolCalls.length === 0 && stream.toolCalls?.length > 0) {
      for (const tc of stream.toolCalls) {
        toolCalls.push({
          id: tc.id || '',
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '{}',
        });
      }
      for (const tc of toolCalls) {
        safeWrite(`event: tool_call\ndata: ${JSON.stringify(tc)}\n\n`);
      }
    }

    // Send synthetic complete if stream ended without finish_reason
    if (!completeSent) {
      safeWrite(`event: complete\ndata: ${JSON.stringify({ finishReason: 'stop', usage: null })}\n\n`);
    }
  } catch (error) {
    console.error('[Chat] Error:', error);
    safeWrite(`event: error\ndata: ${JSON.stringify({
      message: error.message || 'Chat completion failed',
      code: 'chat_error',
    })}\n\n`);
  } finally {
    clearInterval(heartbeat);
    clearTimeout(timeout);
    if (!responseClosed) res.end();
    responseClosed = true;
  }
});

export default router;
