export interface PhotoAnalysis {
  subjectCount: number;
  subjectDescription: string;
  perceivedGender: 'male' | 'female' | null;
  genderConfidence: 'high' | 'medium' | 'low';
  estimatedAgeRange: string | null;
  features: {
    hairColor?: string | null;
    hairStyle?: string | null;
    hairLength?: string | null;
    skinTone?: string | null;
    facialHair?: string | null;
    glasses?: boolean;
    distinctiveFeatures?: string[];
  };
  stylistNotes: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  imageResults?: string[];
  toolProgress?: ToolProgress | null;
  isStreaming?: boolean;
  isToolProgress?: boolean;
  suggestions?: string[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ToolProgress {
  toolName: string;
  status: 'running' | 'completed' | 'failed';
  progress?: number;
  message?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatStreamCallbacks {
  onToken: (token: string) => void;
  onToolCallStart: (toolCall: ToolCall) => void;
  onToolCallComplete: (toolCall: ToolCall, result: ToolResult) => void;
  onNewAssistantMessage?: () => void;
  onComplete: (messages: ChatMessage[]) => void;
  onError: (error: Error) => void;
}

export interface GeneratedTransformation {
  id: string;
  name: string;
  prompt: string;
  pitch: string;
  intensity: number;
  negativePrompt: string;
  icon: string;
}

export interface GeneratedCategory {
  name: string;
  icon: string;
  transformations: GeneratedTransformation[];
}

export interface MakeoverToolContext {
  generateFromPrompt: (params: {
    name?: string;
    prompt: string;
    intensity?: number;
    negativePrompt?: string;
    useStackedInput?: boolean;
  }) => Promise<{ resultUrl: string; projectId: string }>;

  getOriginalImageBase64: () => string | null;
  getOriginalImageUrl: () => string | null;
  getCurrentResultUrl: () => string | null;
  getEditStack: () => import('./index').EditStep[];
  getEditStackDepth: () => number;
  isGenerating: () => boolean;

  analyzeImage: (imageUrl: string, systemPrompt: string) => Promise<string>;

  getSogniClient: () => unknown;
  getPhotoAnalysis: () => PhotoAnalysis;
  getCurrentCategories: () => GeneratedCategory[];
}
