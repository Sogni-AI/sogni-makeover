import { useState, useCallback, useRef } from 'react';
import type {
  ChatMessage,
  PhotoAnalysis,
  GeneratedCategory,
  ToolCall,
  ToolResult,
  MakeoverToolContext,
  GeneratedTransformation,
} from '@/types/chat';
import type { EditStep } from '@/types';
import { sendChatMessage, type AutoPilotConfig } from '@/services/chatService';
import { analyzePhotoSubject, FALLBACK_ANALYSIS } from '@/services/photoAnalysisService';

interface UseChatOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sogniClient: any;
  originalImageUrl: string | null;
  originalImageBase64: string | null;
  getCurrentResultUrl: () => string | null;
  getEditStack: () => EditStep[];
  getEditStackDepth: () => number;
  isGenerating: () => boolean;
  generateFromPrompt: (params: {
    prompt: string;
    intensity?: number;
    negativePrompt?: string;
    useStackedInput?: boolean;
  }) => Promise<{ resultUrl: string; projectId: string }>;
  onCategoryRecommended?: (categoryName: string) => void;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  isChatOpen: boolean;
  unreadCount: number;
  generatedCategories: GeneratedCategory[];
  photoAnalysis: PhotoAnalysis | null;
  isAutoPilot: boolean;

  sendMessage: (text: string) => Promise<void>;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  toggleAutoPilot: () => void;
  notifyTransformationSelected: (transformation: GeneratedTransformation) => void;
  notifyGenerationComplete: (transformation: { name: string; prompt: string }, resultUrl: string) => Promise<void>;
  initWithPhoto: (imageUrl: string) => Promise<void>;
  restoreSession: (data: {
    messages: ChatMessage[];
    photoAnalysis: PhotoAnalysis | null;
    generatedCategories: GeneratedCategory[];
  }) => Promise<void>;
}

export function useChat(options: UseChatOptions): UseChatReturn {
  const {
    sogniClient,
    originalImageUrl,
    originalImageBase64,
    getCurrentResultUrl,
    getEditStack,
    getEditStackDepth,
    isGenerating,
    generateFromPrompt,
    onCategoryRecommended,
  } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  // Tool progress is now stored as permanent messages — no ephemeral state needed
  const [generatedCategories, setGeneratedCategories] = useState<GeneratedCategory[]>([]);
  const [photoAnalysis, setPhotoAnalysis] = useState<PhotoAnalysis | null>(null);
  const [isAutoPilot, setIsAutoPilot] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const isChatOpenRef = useRef(false);
  isChatOpenRef.current = isChatOpen;
  const autoPilotIterationsRef = useRef(0);
  const MAX_AUTO_PILOT_ITERATIONS = 6;

  const photoAnalysisRef = useRef<PhotoAnalysis>(FALLBACK_ANALYSIS);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const generatedCategoriesRef = useRef<GeneratedCategory[]>([]);
  generatedCategoriesRef.current = generatedCategories;
  const tokenQueueRef = useRef<string[]>([]);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const drainTokenQueue = useCallback(() => {
    if (tokenQueueRef.current.length === 0) {
      drainTimerRef.current = null;
      return;
    }
    const token = tokenQueueRef.current.shift()!;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.isStreaming) {
        return [...prev.slice(0, -1), { ...last, content: last.content + token }];
      }
      return prev;
    });
    drainTimerRef.current = setTimeout(drainTokenQueue, 30);
  }, []);

  const enqueueToken = useCallback((token: string) => {
    tokenQueueRef.current.push(token);
    if (!drainTimerRef.current) {
      drainTimerRef.current = setTimeout(drainTokenQueue, 30);
    }
  }, [drainTokenQueue]);

  const flushTokenQueue = useCallback(() => {
    if (drainTimerRef.current) {
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    if (tokenQueueRef.current.length > 0) {
      const remaining = tokenQueueRef.current.join('');
      tokenQueueRef.current = [];
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.isStreaming) {
          return [...prev.slice(0, -1), { ...last, content: last.content + remaining }];
        }
        return prev;
      });
    }
  }, []);

  // Handle generate_transformations tool results — merge for expand, replace for refresh
  const handleTransformationResult = useCallback((result: ToolResult) => {
    if (!result.success || !result.data) return;
    const newCategories = result.data.categories as GeneratedCategory[];
    const mode = result.data.mode as string;
    if (!newCategories) return;

    if (mode === 'expand') {
      // Merge: keep existing, add new categories/options
      setGeneratedCategories((prev) => {
        const merged = [...prev];
        for (const newCat of newCategories) {
          const existing = merged.find((c) => c.name === newCat.name);
          if (existing) {
            // Add new transformations that don't already exist
            for (const t of newCat.transformations) {
              if (!existing.transformations.some((et) => et.id === t.id)) {
                existing.transformations.push(t);
              }
            }
          } else {
            merged.push(newCat);
          }
        }
        return merged;
      });
    } else {
      setGeneratedCategories(newCategories);
    }

    const recommended = result.data.recommendedCategory as string;
    if (recommended) {
      onCategoryRecommended?.(recommended);
    }
  }, [onCategoryRecommended]);

  const buildToolContext = useCallback((): MakeoverToolContext => ({
    generateFromPrompt,
    getOriginalImageBase64: () => originalImageBase64,
    getOriginalImageUrl: () => originalImageUrl,
    getCurrentResultUrl,
    getEditStack,
    getEditStackDepth,
    isGenerating,
    analyzeImage: async (imageUrl: string, systemPrompt: string): Promise<string> => {
      // Use SDK for vision analysis
      if (sogniClient?.getChatClient) {
        const rawClient = sogniClient.getChatClient();
        // Resize image first
        const dataUri = await resizeForVision(imageUrl);
        let content = '';
        const stream = await rawClient.chat.completions.create({
          model: 'qwen3.5-35b-a3b-gguf-q4km',
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: dataUri } },
                { type: 'text', text: 'Analyze this image.' },
              ],
            },
          ],
          stream: true,
          tokenType: 'spark',
          temperature: 0.3,
          max_tokens: 300,
          think: false,
        });
        // SDK ChatStream yields { content, ... } directly (not OpenAI choices format)
        for await (const chunk of stream as AsyncIterable<{ content?: string }>) {
          if (chunk.content) content += chunk.content;
        }
        return content;
      }
      return 'Analysis not available in demo mode.';
    },
    getSogniClient: () => sogniClient,
    getPhotoAnalysis: () => photoAnalysisRef.current,
    getCurrentCategories: () => generatedCategoriesRef.current,
  }), [sogniClient, originalImageBase64, originalImageUrl, getCurrentResultUrl, getEditStack, getEditStackDepth, isGenerating, generateFromPrompt]);

  // Refs + drain logic for queuing auto-analysis that arrives while streaming
  const pendingAnalysisRef = useRef<{ transformation: { name: string; prompt: string }; resultUrl: string } | null>(null);
  const isAutoAnalyzingRef = useRef(false); // Prevents re-triggering analysis loop
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  const drainPendingAnalysis = useCallback(() => {
    if (!isStreamingRef.current && pendingAnalysisRef.current) {
      const pending = pendingAnalysisRef.current;
      pendingAnalysisRef.current = null;
      // Deferred call — notifyGenerationComplete is defined below, accessed via ref
      notifyGenerationCompleteRef.current?.(pending.transformation, pending.resultUrl);
    }
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notifyGenerationCompleteRef = useRef<any>(null);

  const sendMessage = useCallback(async (text: string) => {
    if (isStreaming) return;
    setIsStreaming(true);

    // Create a streaming assistant message placeholder
    const assistantPlaceholderId = `msg-${Date.now()}-streaming`;

    setMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}-user`,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      },
      {
        id: assistantPlaceholderId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    try {
      const toolContext = buildToolContext();

      await sendChatMessage(
        text,
        messagesRef.current,
        photoAnalysisRef.current,
        toolContext,
        {
          onToken: (token) => {
            enqueueToken(token);
          },
          onNewAssistantMessage: () => {
            // Flush current tokens, finalize current bubble, start a new one
            flushTokenQueue();
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              const finalized = last?.isStreaming
                ? [...prev.slice(0, -1), { ...last, isStreaming: false }]
                : prev;
              return [
                ...finalized,
                {
                  id: `msg-${Date.now()}-round`,
                  role: 'assistant' as const,
                  content: '',
                  timestamp: Date.now(),
                  isStreaming: true,
                },
              ];
            });
          },
          onToolCallStart: (toolCall) => {
            flushTokenQueue();
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              let base;
              if (last?.isStreaming && !last.content.trim()) {
                // Remove empty streaming placeholder (the "..." bubble)
                base = prev.slice(0, -1);
              } else if (last?.isStreaming) {
                // Finalize streaming message that has content
                base = [...prev.slice(0, -1), { ...last, isStreaming: false }];
              } else {
                base = prev;
              }
              return [
                ...base,
                {
                  id: `tp-${Date.now()}-start`,
                  role: 'assistant' as const,
                  content: getToolMessage(toolCall.name),
                  timestamp: Date.now(),
                  isStreaming: false,
                  isToolProgress: true,
                },
              ];
            });
          },
          onToolCallComplete: (toolCall: ToolCall, result: ToolResult) => {
            setMessages((prev) => [
              ...prev,
              {
                id: `tp-${Date.now()}-done`,
                role: 'assistant' as const,
                content: result.success ? 'Done!' : (result.error || 'Failed'),
                timestamp: Date.now(),
                isStreaming: false,
                isToolProgress: true,
              },
            ]);

            if (toolCall.name === 'generate_transformations') {
              handleTransformationResult(result);
            }
          },
          onComplete: (finalHistory) => {
            flushTokenQueue();
            // Collect tool progress messages from current state
            const toolProgressMsgs = messagesRef.current.filter((m) => m.isToolProgress);
            const cleaned = finalHistory
              .filter((m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length))
              .map((m) => ({ ...m, isStreaming: false }));
            // Merge tool progress messages back in chronologically
            const merged = [...cleaned, ...toolProgressMsgs].sort((a, b) => a.timestamp - b.timestamp);
            setMessages(merged);
            if (!isChatOpenRef.current) setUnreadCount((prev) => prev + 1);
          },
          onError: (error) => {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.isStreaming) {
                return [
                  ...prev.slice(0, -1),
                  { ...last, content: `Sorry, something went wrong: ${error.message}`, isStreaming: false },
                ];
              }
              return prev;
            });
          },
        },
        sogniClient
      );

    } catch (error) {
      console.error('[useChat] Error:', error);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.isStreaming) {
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              content: 'Hmm, I hit a snag. Try again?',
              isStreaming: false,
            },
          ];
        }
        return prev;
      });
    } finally {
      setIsStreaming(false);
      // Process any queued auto-analysis that arrived while streaming
      setTimeout(() => drainPendingAnalysis(), 0);
    }
  }, [isStreaming, buildToolContext, sogniClient, enqueueToken, flushTokenQueue, drainPendingAnalysis, handleTransformationResult]);

  const initWithPhoto = useCallback(async (imageUrl: string) => {
    // Run photo analysis
    const analysis = await analyzePhotoSubject(imageUrl, sogniClient);
    photoAnalysisRef.current = analysis;
    setPhotoAnalysis(analysis);

    // Open chat and trigger AI greeting
    setIsChatOpen(true);

    // Send empty init message to trigger greeting
    setIsStreaming(true);
    const assistantPlaceholderId = `msg-${Date.now()}-greeting`;
    setMessages([{
      id: assistantPlaceholderId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    }]);

    try {
      const toolContext = buildToolContext();
      const updatedHistory = await sendChatMessage(
        'I just sat down. What do you think?',
        [],
        analysis,
        toolContext,
        {
          onToken: (token) => {
            enqueueToken(token);
          },
          onToolCallStart: () => {},
          onToolCallComplete: (toolCall: ToolCall, result: ToolResult) => {
            if (toolCall.name === 'generate_transformations') {
              handleTransformationResult(result);
            }
          },
          onComplete: (finalHistory) => {
            flushTokenQueue();
            setMessages(
              finalHistory
                .filter((m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length))
                .map((m) => ({ ...m, isStreaming: false })),
            );
            if (!isChatOpenRef.current) setUnreadCount((prev) => prev + 1);
          },
          onError: () => {
            setMessages([{
              id: assistantPlaceholderId,
              role: 'assistant',
              content: 'Hey there! Ready for a makeover? Tell me what kind of look you\'re going for!',
              timestamp: Date.now(),
              isStreaming: false,
            }]);
          },
        },
        sogniClient
      );

      // Don't include the synthetic "I just sat down" user message or empty assistant messages
      const filteredHistory = updatedHistory
        .filter((m) => !(m.role === 'user' && m.content === 'I just sat down. What do you think?'))
        .filter((m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length))
        .map((m) => ({ ...m, isStreaming: false }));
      setMessages(filteredHistory);
    } catch {
      setMessages([{
        id: assistantPlaceholderId,
        role: 'assistant',
        content: 'Hey there! Ready for a makeover? Tell me what kind of look you\'re going for!',
        timestamp: Date.now(),
        isStreaming: false,
      }]);
    } finally {
      setIsStreaming(false);
    }
  }, [sogniClient, buildToolContext, enqueueToken, flushTokenQueue, handleTransformationResult]);

  const restoreSession = useCallback(async (data: {
    messages: ChatMessage[];
    photoAnalysis: PhotoAnalysis | null;
    generatedCategories: GeneratedCategory[];
  }) => {
    const restoredMessages = data.messages.filter(
      (m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length),
    );
    setMessages(restoredMessages);
    if (data.photoAnalysis) {
      photoAnalysisRef.current = data.photoAnalysis;
      setPhotoAnalysis(data.photoAnalysis);
    }
    setGeneratedCategories(data.generatedCategories);
    setIsChatOpen(true);

    // Generate a welcome-back message from the AI stylist
    setIsStreaming(true);
    const welcomePlaceholderId = `msg-${Date.now()}-welcome-back`;
    setMessages((prev) => [
      ...prev,
      {
        id: welcomePlaceholderId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    try {
      const toolContext = buildToolContext();
      const welcomeHistory = await sendChatMessage(
        '[Session resumed — the client just came back to continue their makeover. Welcome them back warmly, remind them where you left off based on the conversation history, and encourage them to pick one of the options from the grid to continue their makeover. If the client might be on a mobile device, let them know they can close the chat to see and tap the makeover options. Keep it short and fun.]',
        restoredMessages,
        photoAnalysisRef.current,
        toolContext,
        {
          onToken: (token) => {
            enqueueToken(token);
          },
          onToolCallStart: (toolCall) => {
            flushTokenQueue();
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              let base;
              if (last?.isStreaming && !last.content.trim()) {
                base = prev.slice(0, -1);
              } else if (last?.isStreaming) {
                base = [...prev.slice(0, -1), { ...last, isStreaming: false }];
              } else {
                base = prev;
              }
              return [
                ...base,
                {
                  id: `tp-${Date.now()}-start`,
                  role: 'assistant' as const,
                  content: getToolMessage(toolCall.name),
                  timestamp: Date.now(),
                  isStreaming: false,
                  isToolProgress: true,
                },
              ];
            });
          },
          onToolCallComplete: (toolCall: ToolCall, result: ToolResult) => {
            setMessages((prev) => [
              ...prev,
              {
                id: `tp-${Date.now()}-done`,
                role: 'assistant' as const,
                content: result.success ? 'Done!' : (result.error || 'Failed'),
                timestamp: Date.now(),
                isStreaming: false,
                isToolProgress: true,
              },
            ]);
            if (toolCall.name === 'generate_transformations') {
              handleTransformationResult(result);
            }
          },
          onComplete: (finalHistory) => {
            flushTokenQueue();
            const toolProgressMsgs = messagesRef.current.filter((m) => m.isToolProgress);
            // Filter out the synthetic resume trigger and empty assistant messages
            const filtered = finalHistory
              .filter((m) => !(m.role === 'user' && m.content.startsWith('[Session resumed')))
              .filter((m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length))
              .map((m) => ({ ...m, isStreaming: false }));
            const merged = [...filtered, ...toolProgressMsgs].sort((a, b) => a.timestamp - b.timestamp);
            setMessages(merged);
            if (!isChatOpenRef.current) setUnreadCount((prev) => prev + 1);
          },
          onError: () => {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.isStreaming) {
                return [
                  ...prev.slice(0, -1),
                  { ...last, content: 'Welcome back! Ready to pick up where we left off?', isStreaming: false },
                ];
              }
              return prev;
            });
          },
        },
        sogniClient
      );

      // Filter out synthetic trigger from final state
      const finalMessages = welcomeHistory
        .filter((m) => !(m.role === 'user' && m.content.startsWith('[Session resumed')))
        .filter((m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length))
        .map((m) => ({ ...m, isStreaming: false }));
      const toolProgressMsgs = messagesRef.current.filter((m) => m.isToolProgress);
      const merged = [...finalMessages, ...toolProgressMsgs].sort((a, b) => a.timestamp - b.timestamp);
      setMessages(merged);
    } catch {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.isStreaming) {
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              content: 'Welcome back! Ready to pick up where we left off?',
              isStreaming: false,
            },
          ];
        }
        return prev;
      });
    } finally {
      setIsStreaming(false);
    }
  }, [sogniClient, buildToolContext, enqueueToken, flushTokenQueue, handleTransformationResult]);

  const notifyTransformationSelected = useCallback((transformation: GeneratedTransformation) => {
    // Add an informational message to chat history (no LLM invocation).
    // The grid click triggers generateMakeover directly — this just keeps the chat in context.
    setMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}-grid`,
        role: 'user' as const,
        content: `I want to try "${transformation.name}"`,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const notifyGenerationComplete = useCallback(async (transformation: { name: string; prompt: string }, resultUrl: string) => {
    if (isStreamingRef.current) {
      // Queue the notification to process when streaming finishes
      pendingAnalysisRef.current = { transformation, resultUrl };
      return;
    }
    // Prevent re-triggering if a generation happens during analysis (e.g. LLM calls generate_makeover)
    if (isAutoAnalyzingRef.current) return;

    // Track auto-pilot iterations — stop if limit reached
    let autoPilotActive = isAutoPilot;
    if (isAutoPilot) {
      autoPilotIterationsRef.current++;
      if (autoPilotIterationsRef.current > MAX_AUTO_PILOT_ITERATIONS) {
        setIsAutoPilot(false);
        autoPilotIterationsRef.current = 0;
        autoPilotActive = false;
      }
    }

    isAutoAnalyzingRef.current = true;
    setIsStreaming(true);

    const remaining = MAX_AUTO_PILOT_ITERATIONS - autoPilotIterationsRef.current;
    const autoPilotConfig: AutoPilotConfig = {
      enabled: autoPilotActive && remaining > 0,
      remainingIterations: remaining,
    };

    const syntheticMessage = `[Generation complete: "${transformation.name}" was just applied. The result is ready for you to analyze. Give me your take on how it turned out and refresh my options.]`;

    // Create streaming assistant placeholder (no user message shown)
    const assistantPlaceholderId = `msg-${Date.now()}-analysis`;
    setMessages((prev) => [
      ...prev,
      {
        id: assistantPlaceholderId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    try {
      const toolContext = buildToolContext();
      await sendChatMessage(
        syntheticMessage,
        messagesRef.current,
        photoAnalysisRef.current,
        toolContext,
        {
          onToken: (token) => {
            enqueueToken(token);
          },
          onNewAssistantMessage: () => {
            flushTokenQueue();
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              const finalized = last?.isStreaming
                ? [...prev.slice(0, -1), { ...last, isStreaming: false }]
                : prev;
              return [
                ...finalized,
                {
                  id: `msg-${Date.now()}-round`,
                  role: 'assistant' as const,
                  content: '',
                  timestamp: Date.now(),
                  isStreaming: true,
                },
              ];
            });
          },
          onToolCallStart: (toolCall) => {
            flushTokenQueue();
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              let base;
              if (last?.isStreaming && !last.content.trim()) {
                base = prev.slice(0, -1);
              } else if (last?.isStreaming) {
                base = [...prev.slice(0, -1), { ...last, isStreaming: false }];
              } else {
                base = prev;
              }
              return [
                ...base,
                {
                  id: `tp-${Date.now()}-start`,
                  role: 'assistant' as const,
                  content: getToolMessage(toolCall.name),
                  timestamp: Date.now(),
                  isStreaming: false,
                  isToolProgress: true,
                },
              ];
            });
          },
          onToolCallComplete: (toolCall: ToolCall, result: ToolResult) => {
            setMessages((prev) => [
              ...prev,
              {
                id: `tp-${Date.now()}-done`,
                role: 'assistant' as const,
                content: result.success ? 'Done!' : (result.error || 'Failed'),
                timestamp: Date.now(),
                isStreaming: false,
                isToolProgress: true,
              },
            ]);

            if (toolCall.name === 'generate_transformations') {
              handleTransformationResult(result);
            }
          },
          onComplete: (finalHistory) => {
            flushTokenQueue();
            const toolProgressMsgs = messagesRef.current.filter((m) => m.isToolProgress);
            // Filter out the synthetic trigger message and empty assistant messages
            const filtered = finalHistory
              .filter((m) => !(m.role === 'user' && m.content.startsWith('[Generation complete:')))
              .filter((m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length))
              .map((m) => ({ ...m, isStreaming: false }));
            const merged = [...filtered, ...toolProgressMsgs].sort((a, b) => a.timestamp - b.timestamp);
            setMessages(merged);
            if (!isChatOpenRef.current) setUnreadCount((prev) => prev + 1);
          },
          onError: (error) => {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.isStreaming) {
                return [
                  ...prev.slice(0, -1),
                  { ...last, content: `Hmm, had trouble analyzing that one. ${error.message}`, isStreaming: false },
                ];
              }
              return prev;
            });
          },
        },
        sogniClient,
        autoPilotConfig
      );

    } catch (error) {
      console.error('[useChat] Auto-analysis error:', error);
    } finally {
      isAutoAnalyzingRef.current = false;
      setIsStreaming(false);
      // Drain any pending analysis queued during this run (continues auto-pilot loop)
      setTimeout(() => drainPendingAnalysis(), 0);
    }
  }, [isAutoPilot, buildToolContext, sogniClient, enqueueToken, flushTokenQueue, handleTransformationResult, drainPendingAnalysis]);

  // Keep notifyGenerationComplete ref current for deferred drain calls
  notifyGenerationCompleteRef.current = notifyGenerationComplete;

  const openChat = useCallback(() => { setIsChatOpen(true); setUnreadCount(0); }, []);
  const closeChat = useCallback(() => setIsChatOpen(false), []);
  const toggleChat = useCallback(() => setIsChatOpen((prev) => {
    if (!prev) setUnreadCount(0);
    return !prev;
  }), []);
  const autoPilotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const kickOffAutoPilot = useCallback(async () => {
    if (isStreamingRef.current || isAutoAnalyzingRef.current || !generatedCategoriesRef.current.length) return;
    setIsStreaming(true);

    autoPilotIterationsRef.current = 1;
    const remaining = MAX_AUTO_PILOT_ITERATIONS - 1;
    const autoPilotConfig: AutoPilotConfig = { enabled: true, remainingIterations: remaining };

    const syntheticMessage = '[Auto-Pilot activated. Pick the transformation you are most excited about from the current grid and apply it with generate_makeover. Go!]';

    const assistantPlaceholderId = `msg-${Date.now()}-autopilot`;
    setMessages((prev) => [
      ...prev,
      {
        id: assistantPlaceholderId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      },
    ]);

    try {
      isAutoAnalyzingRef.current = true;
      const toolContext = buildToolContext();
      await sendChatMessage(
        syntheticMessage,
        messagesRef.current,
        photoAnalysisRef.current,
        toolContext,
        {
          onToken: (token) => { enqueueToken(token); },
          onNewAssistantMessage: () => {
            flushTokenQueue();
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              const finalized = last?.isStreaming
                ? [...prev.slice(0, -1), { ...last, isStreaming: false }]
                : prev;
              return [...finalized, {
                id: `msg-${Date.now()}-round`,
                role: 'assistant' as const,
                content: '',
                timestamp: Date.now(),
                isStreaming: true,
              }];
            });
          },
          onToolCallStart: (toolCall) => {
            flushTokenQueue();
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              let base;
              if (last?.isStreaming && !last.content.trim()) {
                base = prev.slice(0, -1);
              } else if (last?.isStreaming) {
                base = [...prev.slice(0, -1), { ...last, isStreaming: false }];
              } else {
                base = prev;
              }
              return [
                ...base,
                {
                  id: `tp-${Date.now()}-start`,
                  role: 'assistant' as const,
                  content: getToolMessage(toolCall.name),
                  timestamp: Date.now(),
                  isStreaming: false,
                  isToolProgress: true,
                },
              ];
            });
          },
          onToolCallComplete: (toolCall: ToolCall, result: ToolResult) => {
            setMessages((prev) => [
              ...prev,
              {
                id: `tp-${Date.now()}-done`,
                role: 'assistant' as const,
                content: result.success ? 'Done!' : (result.error || 'Failed'),
                timestamp: Date.now(),
                isStreaming: false,
                isToolProgress: true,
              },
            ]);
            if (toolCall.name === 'generate_transformations') {
              handleTransformationResult(result);
            }
          },
          onComplete: (finalHistory) => {
            flushTokenQueue();
            const toolProgressMsgs = messagesRef.current.filter((m) => m.isToolProgress);
            const filtered = finalHistory
              .filter((m) => !(m.role === 'user' && m.content.startsWith('[Auto-Pilot activated')))
              .filter((m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length))
              .map((m) => ({ ...m, isStreaming: false }));
            const merged = [...filtered, ...toolProgressMsgs].sort((a, b) => a.timestamp - b.timestamp);
            setMessages(merged);
            if (!isChatOpenRef.current) setUnreadCount((prev) => prev + 1);
          },
          onError: (error) => {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.isStreaming) {
                return [...prev.slice(0, -1), { ...last, content: `Auto-pilot hit a snag: ${error.message}`, isStreaming: false }];
              }
              return prev;
            });
          },
        },
        sogniClient,
        autoPilotConfig
      );
    } catch (error) {
      console.error('[useChat] Auto-pilot kickoff error:', error);
    } finally {
      isAutoAnalyzingRef.current = false;
      setIsStreaming(false);
      // Drain any pending analysis queued during this run (continues auto-pilot loop)
      setTimeout(() => drainPendingAnalysis(), 0);
    }
  }, [buildToolContext, sogniClient, enqueueToken, flushTokenQueue, handleTransformationResult, drainPendingAnalysis]);

  const toggleAutoPilot = useCallback(() => {
    setIsAutoPilot((prev) => {
      const next = !prev;
      if (next) {
        // Delay kickoff by 2 seconds to let user confirm intent
        autoPilotTimerRef.current = setTimeout(() => {
          autoPilotTimerRef.current = null;
          kickOffAutoPilot();
        }, 2000);
      } else {
        // Turning off — cancel pending kickoff if any
        if (autoPilotTimerRef.current) {
          clearTimeout(autoPilotTimerRef.current);
          autoPilotTimerRef.current = null;
        }
        autoPilotIterationsRef.current = 0;
      }
      return next;
    });
  }, [kickOffAutoPilot]);

  return {
    messages,
    isStreaming,
    isChatOpen,
    unreadCount,
    generatedCategories,
    photoAnalysis,
    isAutoPilot,
    sendMessage,
    openChat,
    closeChat,
    toggleChat,
    toggleAutoPilot,
    notifyTransformationSelected,
    notifyGenerationComplete,
    initWithPhoto,
    restoreSession,
  };
}

// Helper: resize image for vision analysis
async function resizeForVision(imageUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const maxDim = 512;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('No canvas context'));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });
}

function getToolMessage(toolName: string): string {
  switch (toolName) {
    case 'generate_makeover': return 'Creating your makeover...';
    case 'analyze_result': return 'Studying the result...';
    case 'compare_before_after': return 'Comparing before and after...';
    case 'adjust_intensity': return 'Adjusting intensity...';
    case 'stack_transformation': return 'Layering another look...';
    case 'generate_transformations': return 'Curating your looks...';
    default: return 'Working on it...';
  }
}
