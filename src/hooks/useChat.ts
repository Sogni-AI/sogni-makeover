import { useState, useCallback, useRef, useEffect } from 'react';
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
import { generateCategoryOptions } from '@/services/transformationService';
import { getURLs } from '@/config/urls';

interface UseChatOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sogniClient: any;
  originalImageUrl: string | null;
  originalImageBase64: string | null;
  getCurrentResultUrl: () => string | null;
  getEditStack: () => EditStep[];
  getEditStackDepth: () => number;
  isGenerating: () => boolean;
  isAuthenticated: boolean;
  demoGenerationsRemaining: number;
  generateFromPrompt: (params: {
    name?: string;
    prompt: string;
    intensity?: number;
    negativePrompt?: string;
    useStackedInput?: boolean;
  }) => Promise<{ resultUrl: string; projectId: string }>;
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
  disableAutoPilot: () => void;
  notifyTransformationSelected: (transformation: GeneratedTransformation) => void;
  notifyGenerationComplete: (transformation: { name: string; prompt: string }, resultUrl: string) => Promise<void>;
  populateCategory: (categoryName: string) => Promise<void>;
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
    isAuthenticated,
    demoGenerationsRemaining,
    generateFromPrompt,
  } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const streamingLockRef = useRef(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  // Tool progress is now stored as permanent messages — no ephemeral state needed
  const [generatedCategories, setGeneratedCategories] = useState<GeneratedCategory[]>([]);
  const [photoAnalysis, setPhotoAnalysis] = useState<PhotoAnalysis | null>(null);
  const [isAutoPilot, setIsAutoPilot] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const isChatOpenRef = useRef(false);
  isChatOpenRef.current = isChatOpen;
  const isAutoPilotRef = useRef(false);
  isAutoPilotRef.current = isAutoPilot;
  const autoPilotIterationsRef = useRef(0);
  const MAX_AUTO_PILOT_ITERATIONS = 6;

  // Disable auto-pilot when demo generation limit is reached
  useEffect(() => {
    if (!isAuthenticated && demoGenerationsRemaining <= 0 && isAutoPilot) {
      disableAutoPilot();
    }
  }, [demoGenerationsRemaining]); // eslint-disable-line react-hooks/exhaustive-deps

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  const photoAnalysisRef = useRef<PhotoAnalysis>(FALLBACK_ANALYSIS);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const generatedCategoriesRef = useRef<GeneratedCategory[]>([]);
  generatedCategoriesRef.current = generatedCategories;
  const tokenQueueRef = useRef<string[]>([]);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCompletionRef = useRef<(() => void) | null>(null);

  const drainTokenQueue = useCallback(() => {
    if (tokenQueueRef.current.length === 0) {
      drainTimerRef.current = null;
      // Execute pending completion when queue is fully drained
      if (pendingCompletionRef.current) {
        const fn = pendingCompletionRef.current;
        pendingCompletionRef.current = null;
        fn();
      }
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

  // Schedule work to run after the token queue has fully drained (typing animation completes).
  // If the queue is already empty, runs immediately.
  const deferUntilDrained = useCallback((fn: () => void) => {
    if (tokenQueueRef.current.length === 0 && !drainTimerRef.current) {
      fn();
    } else {
      pendingCompletionRef.current = fn;
      // Ensure drain timer is running
      if (!drainTimerRef.current) {
        drainTimerRef.current = setTimeout(drainTokenQueue, 30);
      }
    }
  }, [drainTokenQueue]);

  // Handle generate_transformations tool results — supports two-phase flow + legacy fallback
  const handleTransformationResult = useCallback((result: ToolResult) => {
    if (!result.success || !result.data) return;
    const phase = result.data.phase as string;

    if (phase === 'options') {
      // Phase 2: populate a specific category with options
      const categoryName = result.data.categoryName as string;
      const transformations = result.data.transformations as GeneratedTransformation[];
      if (!categoryName || !transformations) return;

      setGeneratedCategories((prev) =>
        prev.map((cat) =>
          cat.name === categoryName
            ? { ...cat, transformations, populated: true, isPopulating: false }
            : cat
        )
      );
      return;
    }

    if (phase === 'categories') {
      // Phase 1: category shells (no transformations)
      const newCategories = result.data.categories as GeneratedCategory[];
      const mode = result.data.mode as string;
      if (!newCategories) return;

      // Mark all as unpopulated shells
      const shells = newCategories.map((cat) => ({
        ...cat,
        transformations: [],
        populated: false,
        isPopulating: false,
      }));

      if (mode === 'expand') {
        setGeneratedCategories((prev) => {
          const merged = [...prev];
          for (const newCat of shells) {
            if (!merged.find((c) => c.name === newCat.name)) {
              merged.push(newCat);
            }
          }
          return merged;
        });
      } else {
        setGeneratedCategories(shells);
      }

      // Don't auto-select a recommended category — let the user choose
      // which category to explore (or give more details via chat first).
      return;
    }

    // Legacy/fallback: no phase field — existing behavior for backward compatibility
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

    // Don't auto-select a recommended category — let the user choose.
  }, []);

  const buildToolContext = useCallback((): MakeoverToolContext => ({
    generateFromPrompt,
    getOriginalImageBase64: () => originalImageBase64,
    getOriginalImageUrl: () => originalImageUrl,
    getCurrentResultUrl,
    getEditStack,
    getEditStackDepth,
    isGenerating,
    analyzeImage: async (imageUrl: string, systemPrompt: string): Promise<string> => {
      // Resize image first
      const dataUri = await resizeForVision(imageUrl);

      if (sogniClient?.getChatClient) {
        // Authenticated: direct SDK call
        const rawClient = sogniClient.getChatClient();
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

      // Demo: backend proxy
      const urls = getURLs();
      const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
      const response = await fetch(`${urls.apiUrl}/api/photo-analysis/vision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, systemPrompt }),
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`Vision analysis failed: ${response.status}`);
      const result = await response.json();
      return result.content || '';
    },
    getSogniClient: () => sogniClient,
    getPhotoAnalysis: () => photoAnalysisRef.current,
    getCurrentCategories: () => generatedCategoriesRef.current,
  }), [sogniClient, originalImageBase64, originalImageUrl, getCurrentResultUrl, getEditStack, getEditStackDepth, isGenerating, generateFromPrompt]);

  // Ref for populateCategory so handleTransformationResult can call it for auto-populating recommended category
  const populateCategoryRef = useRef<((categoryName: string) => Promise<void>) | null>(null);
  // Pending category to auto-populate once streaming ends (avoids concurrent sendChatMessage calls)
  const pendingPopulateCategoryRef = useRef<string | null>(null);

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

  const drainPendingPopulateCategory = useCallback(() => {
    if (!streamingLockRef.current && pendingPopulateCategoryRef.current) {
      const catName = pendingPopulateCategoryRef.current;
      pendingPopulateCategoryRef.current = null;
      populateCategoryRef.current?.(catName);
    }
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notifyGenerationCompleteRef = useRef<any>(null);

  const sendMessage = useCallback(async (text: string) => {
    if (streamingLockRef.current) return;
    streamingLockRef.current = true;
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
      const remaining = MAX_AUTO_PILOT_ITERATIONS - autoPilotIterationsRef.current;
      const autoPilotConfig: AutoPilotConfig = {
        enabled: isAutoPilot && remaining > 0,
        remainingIterations: remaining,
      };

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
                  isToolDone: false,
                },
              ];
            });
          },
          onToolCallComplete: (toolCall: ToolCall, result: ToolResult) => {
            setMessages((prev) => {
              // Mark the matching start message as done instead of adding a separate "Done!" message
              const startIdx = [...prev].reverse().findIndex((m) => m.isToolProgress && !m.isToolDone);
              if (startIdx !== -1) {
                const idx = prev.length - 1 - startIdx;
                const updated = [...prev];
                updated[idx] = { ...updated[idx], isToolDone: true };
                return updated;
              }
              return prev;
            });

            if (toolCall.name === 'generate_transformations') {
              handleTransformationResult(result);
            }
            // Analysis tool ran inline — the pending notification is now redundant.
            // But in auto-pilot mode, pendingAnalysisRef drives the continuation loop,
            // so only clear it when auto-pilot is off.
            if ((toolCall.name === 'compare_before_after' || toolCall.name === 'analyze_result') && !isAutoPilotRef.current) {
              pendingAnalysisRef.current = null;
            }
          },
          onComplete: (finalHistory) => {
            deferUntilDrained(() => {
              // Collect tool progress messages from current state
              const toolProgressMsgs = messagesRef.current.filter((m) => m.isToolProgress);
              const cleaned = finalHistory
                .filter((m) => !m.isToolProgress)
                .filter((m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length))
                .map((m) => ({ ...m, isStreaming: false }));
              // Merge tool progress messages back in chronologically
              const merged = [...cleaned, ...toolProgressMsgs].sort((a, b) => a.timestamp - b.timestamp);
              setMessages(merged);
              if (!isChatOpenRef.current) setUnreadCount((prev) => prev + 1);
              streamingLockRef.current = false;
              setIsStreaming(false);
              setTimeout(() => { drainPendingAnalysis(); drainPendingPopulateCategory(); }, 0);
            });
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
        sogniClient,
        autoPilotConfig,
        isMobile
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
      // Only clean up if no deferred completion is pending (it will handle cleanup)
      if (!pendingCompletionRef.current) {
        streamingLockRef.current = false;
        setIsStreaming(false);
        setTimeout(() => { drainPendingAnalysis(); drainPendingPopulateCategory(); }, 0);
      }
    }
  }, [isAutoPilot, buildToolContext, sogniClient, enqueueToken, flushTokenQueue, deferUntilDrained, drainPendingAnalysis, drainPendingPopulateCategory, handleTransformationResult]);

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
      let toolCallSeen = false;
      await sendChatMessage(
        'I just sat down. What do you think?',
        [],
        analysis,
        toolContext,
        {
          onToken: (token) => {
            // Suppress post-tool tokens — only the greeting should stream
            if (!toolCallSeen) enqueueToken(token);
          },
          onToolCallStart: () => { flushTokenQueue(); toolCallSeen = true; },
          onToolCallComplete: (toolCall: ToolCall, result: ToolResult) => {
            if (toolCall.name === 'generate_transformations') {
              handleTransformationResult(result);
            }
          },
          onComplete: (finalHistory) => {
            deferUntilDrained(() => {
              // Keep only the first assistant message (greeting) — strip the post-tool
              // commentary about categories so the chat stays clean until the user picks a chip.
              let foundGreeting = false;
              setMessages(
                finalHistory
                  .filter((m) => !(m.role === 'user' && m.content === 'I just sat down. What do you think?'))
                  .filter((m) => m.role !== 'tool')
                  .filter((m) => {
                    if (m.role === 'assistant') {
                      if (!foundGreeting) { foundGreeting = true; return true; }
                      return false; // drop post-tool assistant messages
                    }
                    return true;
                  })
                  .filter((m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length))
                  .map((m) => ({ ...m, isStreaming: false, toolCalls: undefined })),
              );
              if (!isChatOpenRef.current) setUnreadCount((prev) => prev + 1);
              setIsStreaming(false);
              // Don't auto-populate during init — let the user interact with
              // the greeting and suggestion chips first. Categories will
              // populate on demand when the user clicks one.
              pendingPopulateCategoryRef.current = null;
            });
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
        sogniClient,
        undefined,
        isMobile
      );
    } catch {
      setMessages([{
        id: assistantPlaceholderId,
        role: 'assistant',
        content: 'Hey there! Ready for a makeover? Tell me what kind of look you\'re going for!',
        timestamp: Date.now(),
        isStreaming: false,
      }]);
    } finally {
      if (!pendingCompletionRef.current) {
        setIsStreaming(false);
        pendingPopulateCategoryRef.current = null;
      }
    }
  }, [sogniClient, buildToolContext, enqueueToken, flushTokenQueue, deferUntilDrained, handleTransformationResult]);

  const restoreSession = useCallback(async (data: {
    messages: ChatMessage[];
    photoAnalysis: PhotoAnalysis | null;
    generatedCategories: GeneratedCategory[];
  }) => {
    const restoredMessages = data.messages.filter(
      (m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length),
    ).filter((m) => !m.isToolProgress);
    setMessages(restoredMessages);
    if (data.photoAnalysis) {
      photoAnalysisRef.current = data.photoAnalysis;
      setPhotoAnalysis(data.photoAnalysis);
    }
    // Normalize categories for backward compat: infer populated from transformations presence
    setGeneratedCategories(data.generatedCategories.map((cat) => ({
      ...cat,
      populated: cat.populated ?? cat.transformations.length > 0,
      isPopulating: false,
    })));
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
      await sendChatMessage(
        '[Session resumed — the client just came back to continue their makeover. Welcome them back warmly, remind them where you left off based on the conversation history, and encourage them to pick one of the options to continue their makeover. Keep it short and fun.]',
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
                  isToolDone: false,
                },
              ];
            });
          },
          onToolCallComplete: (_toolCall: ToolCall, _result: ToolResult) => {
            setMessages((prev) => {
              // Mark the matching start message as done instead of adding a separate "Done!" message
              const startIdx = [...prev].reverse().findIndex((m) => m.isToolProgress && !m.isToolDone);
              if (startIdx !== -1) {
                const idx = prev.length - 1 - startIdx;
                const updated = [...prev];
                updated[idx] = { ...updated[idx], isToolDone: true };
                return updated;
              }
              return prev;
            });
            // Don't handle generate_transformations during resume — preserved categories
            // from the saved session should not be overwritten by the AI's welcome-back call.
          },
          onComplete: (finalHistory) => {
            deferUntilDrained(() => {
              const toolProgressMsgs = messagesRef.current.filter((m) => m.isToolProgress);
              // Filter out the synthetic resume trigger, tool progress, and empty assistant messages
              const filtered = finalHistory
                .filter((m) => !m.isToolProgress)
                .filter((m) => !(m.role === 'user' && m.content.startsWith('[Session resumed')))
                .filter((m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length))
                .map((m) => ({ ...m, isStreaming: false }));
              const merged = [...filtered, ...toolProgressMsgs].sort((a, b) => a.timestamp - b.timestamp);
              setMessages(merged);
              if (!isChatOpenRef.current) setUnreadCount((prev) => prev + 1);
              setIsStreaming(false);
            });
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
        sogniClient,
        undefined,
        isMobile
      );

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
      if (!pendingCompletionRef.current) {
        setIsStreaming(false);
        setTimeout(() => drainPendingPopulateCategory(), 0);
      }
    }
  }, [sogniClient, buildToolContext, enqueueToken, flushTokenQueue, deferUntilDrained, handleTransformationResult, drainPendingPopulateCategory]);

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
    let autoPilotJustCompleted = false;
    if (isAutoPilot) {
      autoPilotIterationsRef.current++;
      if (autoPilotIterationsRef.current > MAX_AUTO_PILOT_ITERATIONS) {
        setIsAutoPilot(false);
        autoPilotIterationsRef.current = 0;
        autoPilotActive = false;
        autoPilotJustCompleted = true;
      }
    }

    isAutoAnalyzingRef.current = true;
    setIsStreaming(true);

    const remaining = MAX_AUTO_PILOT_ITERATIONS - autoPilotIterationsRef.current;
    const autoPilotConfig: AutoPilotConfig = {
      enabled: autoPilotActive && remaining > 0,
      remainingIterations: remaining,
      justCompleted: autoPilotJustCompleted,
    };

    // Build context about available categories and applied history for auto-pilot diversity
    const ngCategories = generatedCategoriesRef.current;
    const ngCategoryList = ngCategories.map(c =>
      `- ${c.name}${c.populated ? ` (${c.transformations.length} options)` : ' (unpopulated — populate first to browse)'}`
    ).join('\n');
    const ngEditStack = getEditStack();
    const ngAppliedList = ngEditStack.map(s => `- "${s.transformation.name}"`).join('\n');

    const syntheticMessage = autoPilotJustCompleted
      ? `[Generation complete: "${transformation.name}" was just applied. This was the FINAL auto-pilot transformation — the session is now complete.

All transformations applied during this session:
${ngAppliedList}

AUTO-PILOT COMPLETE: Call compare_before_after for a final look, then give a celebratory recap of the full makeover journey. Highlight a few standout transformations and hand back to the client — they're in control now.]`
      : `[Generation complete: "${transformation.name}" was just applied. The result is ready for you to analyze.

Already applied (do NOT repeat any of these):
${ngAppliedList}

Available categories:
${ngCategoryList}

Give me your take on how it turned out, then pick what to layer on next. Choose from a DIFFERENT category than recent picks. If you want something from an unpopulated category, populate it first with generate_transformations phase "options".]`;

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

      // The edit stack ref may not yet reflect the just-completed step due to
      // React batching — override getEditStack with a fallback so that
      // compare_before_after / analyze_result can still access the result.
      const originalGetEditStack = toolContext.getEditStack;
      const syntheticStep = {
        transformation: { id: 'pending', name: transformation.name, category: 'ai-generated' as const, subcategory: 'chat', prompt: transformation.prompt, icon: '' },
        resultImageUrl: resultUrl,
        resultImageBase64: '',
        timestamp: Date.now(),
      };
      toolContext.getEditStack = () => {
        const stack = originalGetEditStack();
        // If the stack already contains this step, return as-is
        if (stack.some((s) => s.resultImageUrl === resultUrl)) return stack;
        // Append the synthetic step — the real stack may have older entries
        // but not this one yet due to React batching
        return [...stack, syntheticStep];
      };

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
                  content: getToolMessage(toolCall.name, true),
                  timestamp: Date.now(),
                  isStreaming: false,
                  isToolProgress: true,
                  isToolDone: false,
                },
              ];
            });
          },
          onToolCallComplete: (toolCall: ToolCall, result: ToolResult) => {
            setMessages((prev) => {
              // Mark the matching start message as done instead of adding a separate "Done!" message
              const startIdx = [...prev].reverse().findIndex((m) => m.isToolProgress && !m.isToolDone);
              if (startIdx !== -1) {
                const idx = prev.length - 1 - startIdx;
                const updated = [...prev];
                updated[idx] = { ...updated[idx], isToolDone: true };
                return updated;
              }
              return prev;
            });

            if (toolCall.name === 'generate_transformations') {
              handleTransformationResult(result);
            }
            if (toolCall.name === 'generate_makeover' && !result.success) {
              setIsAutoPilot(false);
              autoPilotIterationsRef.current = 0;
            }
            // Analysis tool ran inline — the pending notification is now redundant.
            // But in auto-pilot mode, pendingAnalysisRef drives the continuation loop,
            // so only clear it when auto-pilot is off.
            if ((toolCall.name === 'compare_before_after' || toolCall.name === 'analyze_result') && !isAutoPilotRef.current) {
              pendingAnalysisRef.current = null;
            }
          },
          onComplete: (finalHistory) => {
            deferUntilDrained(() => {
              const toolProgressMsgs = messagesRef.current.filter((m) => m.isToolProgress);
              // Filter out the synthetic trigger message, tool progress, and empty assistant messages
              const filtered = finalHistory
                .filter((m) => !m.isToolProgress)
                .filter((m) => !(m.role === 'user' && m.content.startsWith('[Generation complete:')))
                .filter((m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length))
                .map((m) => ({ ...m, isStreaming: false }));
              const merged = [...filtered, ...toolProgressMsgs].sort((a, b) => a.timestamp - b.timestamp);
              setMessages(merged);
              if (!isChatOpenRef.current) setUnreadCount((prev) => prev + 1);
              isAutoAnalyzingRef.current = false;
              setIsStreaming(false);
              setTimeout(() => drainPendingAnalysis(), 0);
            });
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
        autoPilotConfig,
        isMobile
      );

    } catch (error) {
      console.error('[useChat] Auto-analysis error:', error);
    } finally {
      // Only clean up if no deferred completion is pending (it will handle cleanup)
      if (!pendingCompletionRef.current) {
        isAutoAnalyzingRef.current = false;
        setIsStreaming(false);
        setTimeout(() => drainPendingAnalysis(), 0);
      }
    }
  }, [isAutoPilot, buildToolContext, sogniClient, enqueueToken, flushTokenQueue, deferUntilDrained, handleTransformationResult, drainPendingAnalysis]);

  // Keep notifyGenerationComplete ref current for deferred drain calls
  notifyGenerationCompleteRef.current = notifyGenerationComplete;

  const populateCategory = useCallback(async (categoryName: string) => {
    // Don't populate if already populated or currently populating
    const cat = generatedCategoriesRef.current.find((c) => c.name === categoryName);
    if (!cat || cat.populated || cat.isPopulating) return;

    // If streaming is active, queue for when streaming ends
    if (streamingLockRef.current) {
      pendingPopulateCategoryRef.current = categoryName;
      return;
    }

    // Mark category as populating
    setGeneratedCategories((prev) =>
      prev.map((c) => c.name === categoryName ? { ...c, isPopulating: true } : c)
    );

    streamingLockRef.current = true;
    setIsStreaming(true);

    const syntheticMessage = `[Client selected the "${categoryName}" category. First respond with a brief, friendly one-sentence acknowledgment about their choice, then call generate_transformations with phase "options" and categoryName "${categoryName}".]`;

    const assistantPlaceholderId = `msg-${Date.now()}-populate`;
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
          onToken: (token) => { enqueueToken(token); },
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
                  isToolDone: false,
                },
              ];
            });
          },
          onToolCallComplete: (toolCall: ToolCall, result: ToolResult) => {
            setMessages((prev) => {
              const startIdx = [...prev].reverse().findIndex((m) => m.isToolProgress && !m.isToolDone);
              if (startIdx !== -1) {
                const idx = prev.length - 1 - startIdx;
                const updated = [...prev];
                updated[idx] = { ...updated[idx], isToolDone: true };
                return updated;
              }
              return prev;
            });
            if (toolCall.name === 'generate_transformations') {
              handleTransformationResult(result);
            }
          },
          onComplete: (finalHistory) => {
            deferUntilDrained(() => {
              const toolProgressMsgs = messagesRef.current.filter((m) => m.isToolProgress);
              const filtered = finalHistory
                .filter((m) => !m.isToolProgress)
                .filter((m) => !(m.role === 'user' && m.content.startsWith('[Client is browsing')))
                .filter((m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length))
                .map((m) => ({ ...m, isStreaming: false }));
              const merged = [...filtered, ...toolProgressMsgs].sort((a, b) => a.timestamp - b.timestamp);
              setMessages(merged);
              if (!isChatOpenRef.current) setUnreadCount((prev) => prev + 1);
              streamingLockRef.current = false;
              setIsStreaming(false);

              // Fallback: if the LLM didn't call the tool, populate directly
              const catAfter = generatedCategoriesRef.current.find((c) => c.name === categoryName);
              if (catAfter && !catAfter.populated) {
                const catDesc = catAfter.description || categoryName;
                generateCategoryOptions(photoAnalysisRef.current, categoryName, catDesc, sogniClient)
                  .then((transformations) => {
                    handleTransformationResult({
                      success: true,
                      data: { categoryName, transformations, phase: 'options' },
                    });
                  })
                  .catch(() => {
                    setGeneratedCategories((prev) =>
                      prev.map((c) => c.name === categoryName ? { ...c, isPopulating: false } : c)
                    );
                  });
              }
            });
          },
          onError: () => {
            // On error, unmark isPopulating
            setGeneratedCategories((prev) =>
              prev.map((c) => c.name === categoryName ? { ...c, isPopulating: false } : c)
            );
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.isStreaming) {
                return [...prev.slice(0, -1), { ...last, content: '', isStreaming: false }];
              }
              return prev;
            });
          },
        },
        sogniClient,
        undefined,
        isMobile
      );
    } catch (error) {
      console.error('[useChat] Category populate error:', error);
      setGeneratedCategories((prev) =>
        prev.map((c) => c.name === categoryName ? { ...c, isPopulating: false } : c)
      );
    } finally {
      if (!pendingCompletionRef.current) {
        streamingLockRef.current = false;
        setIsStreaming(false);
      }
    }
  }, [buildToolContext, sogniClient, enqueueToken, flushTokenQueue, deferUntilDrained, handleTransformationResult]);

  // Keep populateCategory ref current so handleTransformationResult can auto-populate recommended category
  populateCategoryRef.current = populateCategory;

  const openChat = useCallback(() => { setIsChatOpen(true); setUnreadCount(0); }, []);
  const closeChat = useCallback(() => setIsChatOpen(false), []);
  const toggleChat = useCallback(() => setIsChatOpen((prev) => {
    if (!prev) setUnreadCount(0);
    return !prev;
  }), []);
  const autoPilotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const kickOffAutoPilot = useCallback(async () => {
    if (streamingLockRef.current || isAutoAnalyzingRef.current || !generatedCategoriesRef.current.length) return;
    streamingLockRef.current = true;
    setIsStreaming(true);

    autoPilotIterationsRef.current = 1;
    const remaining = MAX_AUTO_PILOT_ITERATIONS - 1;
    const autoPilotConfig: AutoPilotConfig = { enabled: true, remainingIterations: remaining };

    const hasExistingResult = getEditStackDepth() > 0;

    // Build context about available categories and what's already been done
    const apCategories = generatedCategoriesRef.current;
    const apCategoryList = apCategories.map(c =>
      `- ${c.name}${c.populated ? ` (${c.transformations.length} options ready)` : ' (unpopulated — call generate_transformations with phase "options" to populate)'}`
    ).join('\n');
    const apEditStack = getEditStack();
    const apAppliedList = apEditStack.length > 0
      ? `\n\nAlready applied (do NOT repeat any of these):\n${apEditStack.map(s => `- "${s.transformation.name}"`).join('\n')}`
      : '';

    const syntheticMessage = hasExistingResult
      ? `[Auto-Pilot activated. Available categories:\n${apCategoryList}${apAppliedList}\n\nPick a transformation from a category you haven't used yet and layer it on with stack_transformation. Vary your choices across categories — don't pile on the same one! If you want something from an unpopulated category, populate it first.]`
      : `[Auto-Pilot activated. Available categories:\n${apCategoryList}\n\nPick the transformation you are most excited about and apply it with generate_makeover. Go!]`;

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
                  isToolDone: false,
                },
              ];
            });
          },
          onToolCallComplete: (toolCall: ToolCall, result: ToolResult) => {
            setMessages((prev) => {
              // Mark the matching start message as done instead of adding a separate "Done!" message
              const startIdx = [...prev].reverse().findIndex((m) => m.isToolProgress && !m.isToolDone);
              if (startIdx !== -1) {
                const idx = prev.length - 1 - startIdx;
                const updated = [...prev];
                updated[idx] = { ...updated[idx], isToolDone: true };
                return updated;
              }
              return prev;
            });
            if (toolCall.name === 'generate_transformations') {
              handleTransformationResult(result);
            }
            if (toolCall.name === 'generate_makeover' && !result.success) {
              setIsAutoPilot(false);
              autoPilotIterationsRef.current = 0;
            }
            // Analysis tool ran inline — the pending notification is now redundant.
            // In auto-pilot mode, pendingAnalysisRef drives the continuation loop,
            // so never clear it here (auto-pilot is always active in kickOffAutoPilot).
          },
          onComplete: (finalHistory) => {
            deferUntilDrained(() => {
              const toolProgressMsgs = messagesRef.current.filter((m) => m.isToolProgress);
              const filtered = finalHistory
                .filter((m) => !m.isToolProgress)
                .filter((m) => !(m.role === 'user' && m.content.startsWith('[Auto-Pilot activated')))
                .filter((m) => !(m.role === 'assistant' && m.content.trim() === '' && !m.toolCalls?.length))
                .map((m) => ({ ...m, isStreaming: false }));
              const merged = [...filtered, ...toolProgressMsgs].sort((a, b) => a.timestamp - b.timestamp);
              setMessages(merged);
              if (!isChatOpenRef.current) setUnreadCount((prev) => prev + 1);
              streamingLockRef.current = false;
              isAutoAnalyzingRef.current = false;
              setIsStreaming(false);
              setTimeout(() => drainPendingAnalysis(), 0);
            });
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
        autoPilotConfig,
        isMobile
      );
    } catch (error) {
      console.error('[useChat] Auto-pilot kickoff error:', error);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.isStreaming) {
          return [...prev.slice(0, -1), { ...last, content: 'Auto-pilot hit a snag. Try again?', isStreaming: false }];
        }
        return prev;
      });
    } finally {
      // Only clean up if no deferred completion is pending (it will handle cleanup)
      if (!pendingCompletionRef.current) {
        streamingLockRef.current = false;
        isAutoAnalyzingRef.current = false;
        setIsStreaming(false);
        setTimeout(() => drainPendingAnalysis(), 0);
      }
    }
  }, [buildToolContext, sogniClient, enqueueToken, flushTokenQueue, deferUntilDrained, handleTransformationResult, drainPendingAnalysis]);

  const disableAutoPilot = useCallback(() => {
    setIsAutoPilot(false);
    if (autoPilotTimerRef.current) {
      clearTimeout(autoPilotTimerRef.current);
      autoPilotTimerRef.current = null;
    }
    autoPilotIterationsRef.current = 0;
    // Clear any queued analysis so it doesn't fire after auto-pilot is off
    pendingAnalysisRef.current = null;
    // If streaming from an auto-pilot action, clean up the frozen state
    if (isAutoAnalyzingRef.current) {
      isAutoAnalyzingRef.current = false;
      streamingLockRef.current = false;
      setIsStreaming(false);
      // Finalize any streaming message
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.isStreaming) {
          return [...prev.slice(0, -1), { ...last, isStreaming: false }];
        }
        return prev;
      });
    }
  }, []);

  const toggleAutoPilot = useCallback(() => {
    // Prevent enabling auto-pilot when demo limit is reached
    if (!isAutoPilot && !isAuthenticated && demoGenerationsRemaining <= 0) {
      return;
    }
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
  }, [kickOffAutoPilot, isAutoPilot, isAuthenticated, demoGenerationsRemaining]);

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
    disableAutoPilot,
    notifyTransformationSelected,
    notifyGenerationComplete,
    populateCategory,
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

function getToolMessage(toolName: string, isPostGeneration?: boolean): string {
  switch (toolName) {
    case 'generate_makeover': return 'Creating your makeover...';
    case 'analyze_result': return 'Studying the result...';
    case 'compare_before_after': return 'Comparing before and after...';
    case 'adjust_intensity': return 'Adjusting intensity...';
    case 'stack_transformation': return 'Layering another look...';
    case 'generate_transformations': return isPostGeneration ? 'Refreshing your options...' : 'Curating your looks...';
    default: return 'Working on it...';
  }
}
