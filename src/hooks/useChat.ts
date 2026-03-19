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
  notifyGenerationComplete: (resultUrl: string) => void;
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
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) content += delta;
        }
        return content;
      }
      return 'Analysis not available in demo mode.';
    },
    getSogniClient: () => sogniClient,
    getPhotoAnalysis: () => photoAnalysisRef.current,
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
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.isStreaming) {
                return [...prev.slice(0, -1), { ...last, content: last.content + token }];
              }
              return prev;
            });
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
            }

            // Clear progress after a delay
            setTimeout(() => setCurrentToolProgress(null), 2000);
          },
          onComplete: (finalHistory) => {
            // Replace messages with the authoritative history from chat service
            // But preserve streaming state cleanup
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
  }, [isStreaming, buildToolContext, sogniClient]);

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
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.isStreaming) {
                return [...prev.slice(0, -1), { ...last, content: last.content + token }];
              }
              return prev;
            });
          },
          onToolCallStart: () => {},
          onToolCallComplete: () => {},
          onComplete: (finalHistory) => {
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
  }, [sogniClient, buildToolContext]);

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
  const notifyGenerationComplete = useCallback((_resultUrl: string) => {
    // The chat service handles this via tool result callbacks
  }, []);

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
