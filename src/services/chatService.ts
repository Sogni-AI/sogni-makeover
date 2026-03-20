import type {
  ChatMessage,
  ChatStreamCallbacks,
  PhotoAnalysis,
  ToolCall,
  MakeoverToolContext,
} from '@/types/chat';
import { toolRegistry } from '@/services/toolRegistry';
import { getURLs } from '@/config/urls';

// Import tools to register them
import '@/tools';

const CHAT_MODEL = 'qwen3.5-35b-a3b-gguf-q4km';
const MAX_TOOL_ROUNDS = 5;

export interface AutoPilotConfig {
  enabled: boolean;
  remainingIterations: number;
}

function buildSystemPrompt(photoAnalysis: PhotoAnalysis, autoPilot?: AutoPilotConfig): string {
  const autoPilotRule = autoPilot?.enabled && autoPilot.remainingIterations > 0
    ? `- AUTO-PILOT MODE is ON with ${autoPilot.remainingIterations} iterations remaining. After analyzing the result and refreshing the grid, you SHOULD call generate_makeover to apply the transformation you're most excited about. Pick bold, complementary changes that build on the current look. Keep the momentum going!`
    : `- NEVER call generate_makeover during post-generation analysis. The client picks their next look from the grid — you suggest, they choose. Do NOT auto-apply transformations.`;

  return `You are an eccentric legendary Hollywood stylist to the stars. A new client just sat down in your chair and you've studied their look. You're playful, a bit cheeky, and confidently opinionated — but always gassing up your client. You live for a good transformation.

Your job:
1. Greet the client with your read on their look (use your stylist notes)
2. Ask what kind of vibe they're going for today
3. Based on their answer, call generate_transformations to create personalized options
4. Guide them through trying looks, stacking edits, and refining results

Rules:
- One tool call per response, always with a brief friendly message
- When uncertain about gender or preferences, ask — don't assume
- After a makeover generates, analyze the result and suggest what to try next
- Suggest stacking edits when it makes sense ("Now let's layer some bold eye makeup on top of that new hair!")
- Keep it fun. This is a glow-up, not a doctor's appointment.
- Keep responses short and punchy — 2-3 sentences max unless the client asks for detail.

Your role and how makeovers work:
- You DO NOT directly modify the client's image. You curate categories and options for the client to browse and choose from.
- The client picks which transformation to apply by tapping/clicking an option from the grid — not by telling you to apply it.
- The ONLY exception is when AUTO-PILOT MODE is enabled — then you may call generate_makeover to apply transformations automatically.
- If the client seems confused about how to apply a look or asks you to "do it" / "apply it", remind them to pick an option from the grid. On mobile, let them know they can close the chat to see and tap the makeover buttons.
- If the client seems stuck or unsure how to proceed, gently remind them they can browse the categories and tap any option that catches their eye. On mobile, suggest closing the chat panel to see the full makeover grid.

Post-generation behavior (MANDATORY every time a makeover completes):
1. ALWAYS call compare_before_after first to visually analyze the result
2. Give your honest, enthusiastic reaction: what worked, what's different from what was requested, rate it
3. ALWAYS call generate_transformations with mode "refresh" to update the grid with new options that complement the current look
4. In your final response, reference the new categories and options using bracket syntax: [category:Category Name] and [option:Option Name]
5. Tell the client which category you're most excited about and suggest a specific next step
6. When the client asks for "more options", call generate_transformations with mode "expand" to add to the existing grid
${autoPilotRule}

Client analysis:
${JSON.stringify(photoAnalysis, null, 2)}`;
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Send a message through the chat, handling streaming and tool calling.
 * Authenticated users go through the SDK directly; demo users use the backend proxy.
 */
export async function sendChatMessage(
  userMessage: string,
  conversationHistory: ChatMessage[],
  photoAnalysis: PhotoAnalysis,
  toolContext: MakeoverToolContext,
  callbacks: ChatStreamCallbacks,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sogniClient?: any,
  autoPilot?: AutoPilotConfig
): Promise<ChatMessage[]> {
  const systemMessage = {
    role: 'system' as const,
    content: buildSystemPrompt(photoAnalysis, autoPilot),
  };

  // Build messages for LLM (strip UI-only fields)
  const llmMessages = [
    systemMessage,
    ...conversationHistory.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.toolCalls ? { tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })) } : {}),
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
    })),
    { role: 'user' as const, content: userMessage },
  ];

  // Add user message to history
  const updatedHistory: ChatMessage[] = [
    ...conversationHistory,
    {
      id: generateId(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    },
  ];

  let tools = toolRegistry.getDefinitions();

  // When auto-pilot is off, don't give the LLM the generate_makeover tool during
  // post-generation analysis — prevents the LLM from ignoring the "NEVER" instruction
  if (autoPilot && !autoPilot.enabled) {
    tools = tools.filter((t) => t.function.name !== 'generate_makeover');
  }

  let roundCount = 0;
  let currentMessages = llmMessages;

  while (roundCount < MAX_TOOL_ROUNDS) {
    roundCount++;

    // Signal the UI to create a new streaming bubble for each round after the first
    if (roundCount > 1) {
      callbacks.onNewAssistantMessage?.();
    }

    let assistantContent = '';
    let toolCalls: ToolCall[] = [];

    if (sogniClient?.getChatClient) {
      // Authenticated: direct SDK streaming
      const rawClient = sogniClient.getChatClient();
      const stream = await rawClient.chat.completions.create({
        model: CHAT_MODEL,
        messages: currentMessages,
        stream: true,
        tokenType: 'spark',
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 500,
        think: false,
        tools: tools.length > 0 ? tools : undefined,
      });

      const pendingToolCalls: Record<number, { id: string; name: string; arguments: string }> = {};

      // SDK ChatStream yields { content, tool_calls, finishReason } directly (not OpenAI choices format)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const chunk of stream as AsyncIterable<{ content?: string; tool_calls?: any[] }>) {
        if (chunk.content) {
          assistantContent += chunk.content;
          callbacks.onToken(chunk.content);
        }

        if (chunk.tool_calls) {
          for (const tc of chunk.tool_calls) {
            const idx = tc.index ?? 0;
            if (!pendingToolCalls[idx]) {
              pendingToolCalls[idx] = { id: tc.id || '', name: '', arguments: '' };
            }
            if (tc.id) pendingToolCalls[idx].id = tc.id;
            if (tc.function?.name) pendingToolCalls[idx].name = tc.function.name;
            if (tc.function?.arguments) pendingToolCalls[idx].arguments += tc.function.arguments;
          }
        }
      }

      // Also check stream.toolCalls for accumulated tool calls (SDK accumulates them)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const streamObj = stream as any;
      if (Object.keys(pendingToolCalls).length === 0 && streamObj.toolCalls?.length > 0) {
        for (const tc of streamObj.toolCalls) {
          pendingToolCalls[Object.keys(pendingToolCalls).length] = {
            id: tc.id || '',
            name: tc.function?.name || '',
            arguments: tc.function?.arguments || '{}',
          };
        }
      }

      toolCalls = Object.values(pendingToolCalls);
    } else {
      // Demo: backend proxy via fetch + ReadableStream
      const urls = getURLs();
      const response = await fetch(`${urls.apiUrl}/api/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: currentMessages,
          tools: tools.length > 0 ? tools : undefined,
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Chat request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            // Next line should be data
            continue;
          }
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                assistantContent += data.content;
                callbacks.onToken(data.content);
              }
              if (data.id && data.name) {
                // tool_call event
                toolCalls.push({
                  id: data.id,
                  name: data.name,
                  arguments: data.arguments || '{}',
                });
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    }

    // Add assistant message to history
    const assistantMsg: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: assistantContent,
      timestamp: Date.now(),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
    updatedHistory.push(assistantMsg);

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      callbacks.onComplete(updatedHistory);
      return updatedHistory;
    }

    // Build assistant message for LLM context (once, before tool execution loop)
    const assistantLlmMsg = {
      role: 'assistant' as const,
      content: assistantContent,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };

    // Execute tool calls and collect results
    const toolResultMsgs: { role: 'tool'; content: string; tool_call_id: string }[] = [];

    for (const toolCall of toolCalls) {
      callbacks.onToolCallStart(toolCall);

      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(toolCall.arguments);
      } catch {
        parsedArgs = {};
      }

      const result = await toolRegistry.execute(toolCall.name, parsedArgs, toolContext);

      callbacks.onToolCallComplete(toolCall, result);

      // Add tool result to UI history
      const toolMsg: ChatMessage = {
        id: generateId(),
        role: 'tool',
        content: JSON.stringify(result),
        timestamp: Date.now(),
        toolCallId: toolCall.id,
      };
      updatedHistory.push(toolMsg);

      // Collect for LLM messages
      toolResultMsgs.push({
        role: 'tool' as const,
        content: JSON.stringify(result),
        tool_call_id: toolCall.id,
      });
    }

    // Build LLM messages for next round: assistant message once, then all tool results
    currentMessages = [
      ...currentMessages,
      assistantLlmMsg,
      ...toolResultMsgs,
    ];

    // Reset for next round
    assistantContent = '';
  }

  // Max rounds reached
  callbacks.onComplete(updatedHistory);
  return updatedHistory;
}
