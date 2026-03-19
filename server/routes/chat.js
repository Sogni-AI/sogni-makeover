import express from 'express';
import { chatCompletion } from '../services/sogni.js';

const router = express.Router();

// Origin validation: only allow *.sogni.ai
function validateOrigin(req, res, next) {
  const origin = req.get('origin') || '';
  if (origin && !origin.match(/\.sogni\.ai(:\d+)?$/)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

router.use(validateOrigin);

// SSE streaming chat completion for demo users
router.post('/completions', async (req, res) => {
  const { messages, tools } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = await chatCompletion(messages, tools || []);

    let toolCalls = [];

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;

      // Stream text content
      if (delta?.content) {
        res.write(`event: token\ndata: ${JSON.stringify({ content: delta.content })}\n\n`);
      }

      // Accumulate tool calls
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
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
      if (choice.finish_reason) {
        if (toolCalls.length > 0) {
          for (const tc of toolCalls) {
            res.write(`event: tool_call\ndata: ${JSON.stringify(tc)}\n\n`);
          }
        }
        res.write(`event: complete\ndata: ${JSON.stringify({
          finishReason: choice.finish_reason,
          usage: chunk.usage || null,
        })}\n\n`);
      }
    }
  } catch (error) {
    console.error('[Chat] Error:', error);
    res.write(`event: error\ndata: ${JSON.stringify({
      message: error.message || 'Chat completion failed',
      code: 'chat_error',
    })}\n\n`);
  } finally {
    res.end();
  }
});

export default router;
