// Stub for Stream D - full implementation in Stream C
export interface UseChatReturn {
  messages: import('@/types/chat').ChatMessage[];
  isStreaming: boolean;
  isChatOpen: boolean;
  currentToolProgress: import('@/types/chat').ToolProgress | null;
  generatedCategories: import('@/types/chat').GeneratedCategory[];
  photoAnalysis: import('@/types/chat').PhotoAnalysis | null;
  sendMessage: (text: string) => Promise<void>;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  notifyTransformationSelected: (transformation: import('@/types/chat').GeneratedTransformation) => void;
  notifyGenerationComplete: (resultUrl: string) => void;
  initWithPhoto: (imageUrl: string) => Promise<void>;
}
