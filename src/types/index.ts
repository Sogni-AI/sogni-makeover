// Transformation system
export type TransformationCategory =
  | 'hairstyles'
  | 'makeup'
  | 'clothing'
  | 'accessories'
  | 'facial'
  | 'expression'
  | 'body'
  | 'age-fantasy'
  | 'lighting'
  | 'ai-generated';

export interface TransformationSubcategory {
  id: string;
  name: string;
  icon: string;
  gender?: 'male' | 'female';
}

export interface Transformation {
  id: string;
  name: string;
  category: TransformationCategory;
  subcategory: string;
  prompt: string;
  icon: string;
  thumbnail?: string;
  intensity?: number; // Default denoise strength 0.5-0.95
  negativePrompt?: string;
  gender?: 'male' | 'female'; // absent = neutral, shows for both
}

// Generation
export interface GenerationParams {
  modelId: string;
  positivePrompt: string;
  negativePrompt: string;
  contextImages: string[]; // base64 encoded
  width: number;
  height: number;
  guidance: number;
  steps: number;
  sampler: string;
  scheduler: string;
  outputFormat: string;
  numberOfMedia: number;
  denoisingStrength?: number;
  tokenType?: string;
}

export interface GenerationResult {
  projectId: string;
  imageUrl: string;
  thumbnailUrl?: string;
  timestamp: number;
  transformation: Transformation;
  duration: number;
  cost?: number;
}

// Edit stack
export interface EditStep {
  transformation: Transformation;
  resultImageUrl: string;
  resultImageBase64: string;
  timestamp: number;
}

export type EditMode = 'stacked' | 'original';

export interface GenerationProgress {
  projectId: string;
  status: 'uploading' | 'queued' | 'generating' | 'completed' | 'error' | 'cancelled';
  progress: number; // 0-100
  message?: string;
  previewUrl?: string;
  eta?: number;
  workerName?: string;
}

// User & Auth
export interface SogniUser {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
  credits?: number;
}

export type AuthMode = 'frontend' | 'demo';

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: SogniUser | null;
  authMode: AuthMode;
  error: string | null;
  sessionTransferred?: boolean;
}

// App State
export type Gender = 'female' | 'male';

export type AppView = 'landing' | 'capture' | 'studio' | 'results' | 'history';

export interface AppSettings {
  defaultModel: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultGuidance: number;
  defaultSteps: number;
  defaultSampler: string;
  defaultScheduler: string;
  outputFormat: string;
  autoEnhanceWebcam: boolean;
}

export interface HistoryItem {
  id: string;
  originalImage: string; // base64 or URL
  resultImage: string; // URL
  transformation: Transformation;
  timestamp: number;
  duration: number;
  cost?: number;
}

// SSE Events
export interface SSEEvent {
  type: 'connected' | 'queued' | 'progress' | 'preview' | 'jobCompleted' | 'complete' | 'error';
  data: Record<string, unknown>;
}

// Cost estimation (SDK returns { token: number })
export interface CostEstimate {
  token: number;
  credits?: number;
  usdEquivalent?: number;
}

// Toast notifications
export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}
