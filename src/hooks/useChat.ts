import { useState, useCallback, useRef } from 'react';
import type {
  ChatMessage,
  PhotoAnalysis,
  GeneratedCategory,
  ToolCall,
  ToolResult,
  ToolProgress,
  MakeoverToolContext,
  GeneratedTransformation,
} from '@/types/chat';
import type { EditStep } from '@/types';
import { sendChatMessage } from '@/services/chatService';
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
  currentToolProgress: ToolProgress | null;
  generatedCategories: GeneratedCategory[];
  photoAnalysis: PhotoAnalysis | null;

  sendMessage: (text: string) => Promise<void>;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  notifyTransformationSelected: (transformation: GeneratedTransformation) => void;
  notifyGenerationComplete: (transformation: { name: string; prompt: string }, resultUrl: string) => Promise<void>;
  initWithPhoto: (imageUrl: string) => Promise<void>;
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
  const [currentToolProgress, setCurrentToolProgress] = useState<ToolProgress | null>(null);
  const [generatedCategories, setGeneratedCategories] = useState<GeneratedCategory[]>([]);
  const [photoAnalysis, setPhotoAnalysis] = useState<PhotoAnalysis | null>(null);

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      const updatedHistory = await sendChatMessage(
        text,
        messagesRef.current,
        photoAnalysisRef.current,
        toolContext,
        {
          onToken: (token) => {
            enqueueToken(token);
          },
          onToolCallStart: (toolCall) => {
            setCurrentToolProgress({
              toolName: toolCall.name,
              status: 'running',
              message: getToolMessage(toolCall.name),
            });
          },
          onToolCallComplete: (toolCall: ToolCall, result: ToolResult) => {
            setCurrentToolProgress({
              toolName: toolCall.name,
              status: result.success ? 'completed' : 'failed',
              message: result.success ? 'Done!' : (result.error || 'Failed'),
            });

            // If generate_transformations succeeded, update the grid
            if (toolCall.name === 'generate_transformations' && result.success && result.data) {
              const categories = result.data.categories as GeneratedCategory[];
              if (categories) {
                setGeneratedCategories(categories);
              }
              // Preselect recommended category
              const recommended = result.data.recommendedCategory as string;
              if (recommended) {
                onCategoryRecommended?.(recommended);
              }
            }

            // Clear progress after a delay
            setTimeout(() => setCurrentToolProgress(null), 2000);
          },
          onComplete: (finalHistory) => {
            flushTokenQueue();
            const cleaned = finalHistory.map((m) => ({ ...m, isStreaming: false }));
            setMessages(cleaned);
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

      // Final update
      setMessages(updatedHistory.map((m) => ({ ...m, isStreaming: false })));
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
    }
  }, [isStreaming, buildToolContext, sogniClient, enqueueToken, flushTokenQueue]);

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
          onToolCallComplete: () => {},
          onComplete: (finalHistory) => {
            flushTokenQueue();
            setMessages(finalHistory.map((m) => ({ ...m, isStreaming: false })));
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

      // Don't include the synthetic "I just sat down" user message in displayed history
      const filteredHistory = updatedHistory
        .filter((m) => !(m.role === 'user' && m.content === 'I just sat down. What do you think?'))
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
  }, [sogniClient, buildToolContext, enqueueToken, flushTokenQueue]);

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const notifyGenerationComplete = useCallback(async (transformation: { name: string; prompt: string }, _resultUrl: string) => {
    if (isStreaming) return;
    setIsStreaming(true);

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
      const updatedHistory = await sendChatMessage(
        syntheticMessage,
        messagesRef.current,
        photoAnalysisRef.current,
        toolContext,
        {
          onToken: (token) => {
            enqueueToken(token);
          },
          onToolCallStart: (toolCall) => {
            setCurrentToolProgress({
              toolName: toolCall.name,
              status: 'running',
              message: getToolMessage(toolCall.name),
            });
          },
          onToolCallComplete: (toolCall: ToolCall, result: ToolResult) => {
            setCurrentToolProgress({
              toolName: toolCall.name,
              status: result.success ? 'completed' : 'failed',
              message: result.success ? 'Done!' : (result.error || 'Failed'),
            });

            // If generate_transformations succeeded, update the grid
            if (toolCall.name === 'generate_transformations' && result.success && result.data) {
              const categories = result.data.categories as GeneratedCategory[];
              if (categories) {
                setGeneratedCategories(categories);
              }
              // Preselect recommended category
              const recommended = result.data.recommendedCategory as string;
              if (recommended) {
                onCategoryRecommended?.(recommended);
              }
            }

            // Clear progress after a delay
            setTimeout(() => setCurrentToolProgress(null), 2000);
          },
          onComplete: (finalHistory) => {
            flushTokenQueue();
            // Filter out the synthetic trigger message from displayed history
            const filtered = finalHistory
              .filter((m) => !(m.role === 'user' && m.content.startsWith('[Generation complete:')))
              .map((m) => ({ ...m, isStreaming: false }));
            setMessages(filtered);
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
        sogniClient
      );

      // Final update — filter synthetic message
      const filtered = updatedHistory
        .filter((m) => !(m.role === 'user' && m.content.startsWith('[Generation complete:')))
        .map((m) => ({ ...m, isStreaming: false }));
      setMessages(filtered);
    } catch (error) {
      console.error('[useChat] Auto-analysis error:', error);
    } finally {
      setIsStreaming(false);
    }
  }, [isStreaming, buildToolContext, sogniClient, enqueueToken, flushTokenQueue, onCategoryRecommended]);

  const openChat = useCallback(() => setIsChatOpen(true), []);
  const closeChat = useCallback(() => setIsChatOpen(false), []);
  const toggleChat = useCallback(() => setIsChatOpen((prev) => !prev), []);

  return {
    messages,
    isStreaming,
    isChatOpen,
    currentToolProgress,
    generatedCategories,
    photoAnalysis,
    sendMessage,
    openChat,
    closeChat,
    toggleChat,
    notifyTransformationSelected,
    notifyGenerationComplete,
    initWithPhoto,
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
