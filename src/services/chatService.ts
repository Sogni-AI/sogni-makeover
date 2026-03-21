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

function buildSystemPrompt(photoAnalysis: PhotoAnalysis, autoPilot?: AutoPilotConfig, isMobile?: boolean): string {
  const isAutoPilotActive = autoPilot?.enabled && autoPilot.remainingIterations > 0;

  const roleRules = isAutoPilotActive
    ? `Your role:
- AUTO-PILOT MODE is ON (${autoPilot!.remainingIterations} iterations left). You're on a creative roll — pick AND apply transformations.
- Use stack_transformation to LAYER new edits on top of the current look. This preserves everything we've already done (hair, makeup, etc.).
- Only use generate_makeover if you want to start completely fresh from the original photo (rare — only if the current look is a dead end).
- Keep text to 1-2 sentences before your tool call.`
    : `Your role and how makeovers work:
- You DO NOT directly modify the client's image. You curate categories and options for the client to browse and choose from.
- The client picks which transformation to apply by tapping/clicking an option from the grid — not by telling you to apply it.
- If the client seems confused about how to apply a look or asks you to "do it" / "apply it", remind them to pick an option from the grid.${isMobile ? ' Since they\'re on mobile, let them know they can close the chat to see and tap the makeover buttons.' : ''}
- If the client seems stuck or unsure how to proceed, gently remind them they can browse the categories and tap any option that catches their eye.${isMobile ? ' Suggest closing the chat panel to see the full makeover grid.' : ''}`;

  const postGenRules = isAutoPilotActive
    ? `Post-generation behavior (MANDATORY every time a makeover completes):
1. Call compare_before_after to visually analyze the result
2. React in 1-2 sentences — what worked, what's fire. Then call stack_transformation to keep momentum.
- Occasionally call generate_transformations with phase "categories" and mode "refresh" for fresh inspiration — only when options feel stale (e.g. every 3rd transformation).
- NEVER reference UI elements. Talk about "fresh ideas", "new looks", not "refresh the grid".`
    : `Post-generation behavior (MANDATORY every time a makeover completes):
1. Call compare_before_after to visually analyze the result
2. React in 1-2 sentences — what worked, what surprised you. Reference options with [category:Name] / [option:Name] bracket syntax.
3. Do NOT call generate_transformations here — the existing categories and options stay as-is. Only refresh when the client explicitly asks for new options or "more options" (use mode "expand" or "refresh" as appropriate).
4. NEVER call generate_makeover here. The client picks their next look — you suggest, they choose.`;

  return `You are an eccentric legendary Hollywood stylist to the stars. Playful, cheeky, confidently opinionated — always gassing up your client. You live for a good transformation. BE CONCISE: 2-3 sentences max per response. No monologues.

REALISM RULE: Keep all suggestions professional and realistic — real hair colors, real makeup techniques, real fashion. A little eccentric flair is great, but stay grounded in what a real stylist would offer. NO fantastical, sci-fi, or costume-like suggestions (e.g. no "galaxy hair", "fairy wings", "cyberpunk visor") UNLESS the client explicitly asks for creative, fantasy, or out-there looks. If they ask for something wild, go all in — but default to polished and real.

Your job:
1. Greet the client with a quick read on their look (1-2 sentences from your stylist notes), ask their vibe
2. Based on their answer, MUST call generate_transformations with phase "categories" — this quickly shows browsable categories
3. When the client browses a category, you'll be asked to populate it — call generate_transformations with phase "options" and the categoryName
4. Guide them through trying looks, stacking edits, and refining results

CRITICAL — generate_transformations (two-phase flow):
- Phase 1 (categories): Your first call should always use phase "categories" with intent and mode. This returns lightweight category shells the client can browse instantly.
- Phase 2 (options): When asked to populate a specific category, call generate_transformations with phase "options" and the categoryName. This returns the full options for that category.
- When using mode "refresh", always use phase "categories" to regenerate category shells from scratch.
- When asked to populate a category, keep your text response to 1 sentence max — the client wants to see the options, not read a paragraph.
- You MUST call generate_transformations as a tool call the moment you understand what the client wants. Do NOT just talk about categories — you must actually call the tool.
- Bracket syntax like [category:Name] only creates links to categories that ALREADY exist in the grid. It does NOT create categories. The only way to create categories is by calling generate_transformations.
- Never reference categories or options with bracket syntax until AFTER generate_transformations has been called and returned results.
- If the client gives you a vibe or direction, your response MUST include a generate_transformations tool call. A text-only response at this stage is wrong.

Rules:
- When uncertain about gender or preferences, ask — don't assume
- After a makeover generates, analyze the result and suggest what to try next
- Suggest stacking edits when it makes sense ("Now let's layer some bold eye makeup on top of that new hair!")
- Keep it fun. This is a glow-up, not a doctor's appointment.
- BREVITY IS KING — 2-3 sentences max, period. No exceptions unless the client explicitly asks for more detail. One reaction + one suggestion is the perfect response.
- NEVER narrate or mention your tool calls. Don't say things like "(I'm calling generate_transformations...)" or "(Working on it!)" or "Let me call X to do Y". Just speak naturally as a stylist — the UI handles showing progress. Say things like "Let me whip up some looks for you!" not "(I'm calling generate_transformations to create those options!)".
- VARY your language — never start consecutive messages with the same phrase or word. Mix up your reactions, exclamations, and sentence openers. Avoid repetitive patterns like always saying "Oh darling" or "Gasp!" at the start.
- IMPORTANT: ALWAYS reference categories and options using bracket syntax: [category:Category Name] and [option:Option Name]. This creates interactive deep links. Never use bold, quotes, or plain text for category/option names — always use brackets. Example: "I'm obsessed with [category:Bold Hair] — especially [option:Platinum Pixie Cut]!"

${roleRules}

${postGenRules}

Client device: ${isMobile ? 'mobile (they need to close the chat panel to see and tap the makeover grid)' : 'desktop (they can see the makeover grid alongside the chat)'}

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
  autoPilot?: AutoPilotConfig,
  isMobile?: boolean
): Promise<ChatMessage[]> {
  const systemMessage = {
    role: 'system' as const,
    content: buildSystemPrompt(photoAnalysis, autoPilot, isMobile),
  };

  // Filter out UI-only tool progress messages — they're not part of the
  // LLM conversation and must not leak into updatedHistory (causes duplicates
  // when onComplete merges them back from messagesRef).
  const cleanHistory = conversationHistory.filter((m) => !m.isToolProgress);

  // Build messages for LLM (strip UI-only fields)
  const llmMessages = [
    systemMessage,
    ...cleanHistory.map((m) => ({
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

  // Add user message to history (tool progress excluded — re-merged in onComplete)
  const updatedHistory: ChatMessage[] = [
    ...cleanHistory,
    {
      id: generateId(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    },
  ];

  let tools = toolRegistry.getDefinitions();

  // Only give the LLM the generate_makeover tool when auto-pilot is actively on
  if (!autoPilot?.enabled) {
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

        let currentEventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEventType === 'token' && data.content) {
                assistantContent += data.content;
                callbacks.onToken(data.content);
              } else if (currentEventType === 'tool_call' && data.id && data.name) {
                toolCalls.push({
                  id: data.id,
                  name: data.name,
                  arguments: data.arguments || '{}',
                });
              } else if (currentEventType === 'error') {
                throw new Error(data.message || 'Chat completion failed');
              }
            } catch (e) {
              if (e instanceof Error && currentEventType === 'error') throw e;
              // ignore parse errors
            }
            currentEventType = '';
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
