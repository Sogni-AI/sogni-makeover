# AI-Powered Makeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Sogni Makeover from a static menu-driven app into an AI-powered experience with a chat assistant, dynamic transformation generation, photo analysis, and tool calling.

**Architecture:** Modular services (photo analysis, chat, transformation, tool registry) connected via a thin chat orchestrator. Chat panel alongside existing grid UI. Dual-path for auth (frontend SDK direct) and demo (backend proxy).

**Tech Stack:** React 18 + TypeScript + Vite, Node.js/Express, Sogni Client SDK (Qwen 3.5 35B vision/chat), Framer Motion, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-03-19-ai-powered-makeover-design.md`

---

## Work Stream Organization

This plan is organized into 4 independent work streams that can execute in parallel:

- **Stream A (Tasks 1-3):** Backend — server routes + services for photo analysis and chat
- **Stream B (Tasks 4-7):** Core AI Services — types, photo analysis, transformation service, tool registry + tools
- **Stream C (Tasks 8-10):** Chat System — chat service, useChat hook, AppContext integration
- **Stream D (Tasks 11-14):** UI — chat components, grid integration, studio layout, onboarding flow update

Dependencies: Stream C depends on Stream B (types + services). Stream D depends on Stream C (useChat hook). Stream A is fully independent.

---

### Task 1: Backend Photo Analysis Route

**Stream:** A (Backend)
**Files:**
- Create: `server/routes/photoAnalysis.js`
- Modify: `server/services/sogni.js` — add `analyzePhotoSubject()` function
- Modify: `server/index.js` — register new route

- [ ] **Step 1: Add `analyzePhotoSubject` to server/services/sogni.js**

Add this function after the existing `generateImage` function (around line 400):

```javascript
// ---------------------------------------------------------------------------
// Photo subject analysis via LLM vision
// ---------------------------------------------------------------------------

const SUBJECT_ANALYSIS_MODEL = 'qwen3.5-35b-a3b-gguf-q4km';

const SUBJECT_ANALYSIS_SYSTEM_PROMPT = `You are an eccentric legendary Hollywood stylist to the stars. Analyze the portrait photo as if the subject is the client sitting in your studio chair, ready to upgrade their look.

Return JSON with your professional assessment:
{
  "subjectCount": 1,
  "subjectDescription": "a young woman with long dark curly hair",
  "perceivedGender": "female",
  "genderConfidence": "high",
  "estimatedAgeRange": "25-30",
  "features": {
    "hairColor": "dark brown",
    "hairStyle": "long, curly",
    "hairLength": "long",
    "skinTone": "medium warm",
    "facialHair": null,
    "glasses": false,
    "distinctiveFeatures": ["killer cheekbones", "full lips"]
  },
  "stylistNotes": "That bone structure is begging for a dramatic side part. The warm skin tone opens up the whole copper-to-auburn palette."
}

Focus on: apparent gender, age range, hair (color/length/style), skin tone, facial hair, glasses, distinctive visible features. Do NOT mention clothing or background. The stylistNotes should be your candid professional read — what excites you about this client's potential.`;

export async function analyzePhotoSubject(imageBase64DataUri) {
  const client = await getOrCreateGlobalSogniClient();

  const messages = [
    { role: 'system', content: SUBJECT_ANALYSIS_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageBase64DataUri } },
        { type: 'text', text: 'Describe the main subject of this portrait.' },
      ],
    },
  ];

  let fullContent = '';
  const stream = await client.chat.completions.create({
    model: SUBJECT_ANALYSIS_MODEL,
    messages,
    stream: true,
    tokenType: 'spark',
    temperature: 0.1,
    top_p: 0.9,
    max_tokens: 300,
    think: false,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) fullContent += delta;
  }

  // Parse JSON, handling markdown code fences
  let cleaned = fullContent.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      subjectCount: typeof parsed.subjectCount === 'number' ? parsed.subjectCount : 1,
      subjectDescription: typeof parsed.subjectDescription === 'string' ? parsed.subjectDescription : 'the person',
      perceivedGender: ['male', 'female'].includes(parsed.perceivedGender) ? parsed.perceivedGender : null,
      genderConfidence: ['high', 'medium', 'low'].includes(parsed.genderConfidence) ? parsed.genderConfidence : 'low',
      estimatedAgeRange: typeof parsed.estimatedAgeRange === 'string' ? parsed.estimatedAgeRange : null,
      features: parsed.features || {},
      stylistNotes: typeof parsed.stylistNotes === 'string' ? parsed.stylistNotes : '',
    };
  } catch {
    return {
      subjectCount: 1,
      subjectDescription: 'the person',
      perceivedGender: null,
      genderConfidence: 'low',
      estimatedAgeRange: null,
      features: {},
      stylistNotes: '',
    };
  }
}
```

- [ ] **Step 2: Add `chatCompletion` to server/services/sogni.js**

Add this function after `analyzePhotoSubject`:

```javascript
// ---------------------------------------------------------------------------
// Chat completion proxy for demo users
// ---------------------------------------------------------------------------

const CHAT_MODEL = 'qwen3.5-35b-a3b-gguf-q4km';

export async function chatCompletion(messages, tools = []) {
  const client = await getOrCreateGlobalSogniClient();

  const params = {
    model: CHAT_MODEL,
    messages,
    stream: true,
    tokenType: 'spark',
    temperature: 0.7,
    top_p: 0.9,
    max_tokens: 500,
    think: false,
  };

  if (tools.length > 0) {
    params.tools = tools;
  }

  return client.chat.completions.create(params);
}
```

- [ ] **Step 3: Export new functions from server/services/sogni.js**

Add `analyzePhotoSubject` and `chatCompletion` to the existing exports.

- [ ] **Step 4: Create server/routes/photoAnalysis.js**

```javascript
import express from 'express';
import { analyzePhotoSubject } from '../services/sogni.js';

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

router.post('/analyze', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }

    // Ensure data URI format
    const dataUri = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    const result = await analyzePhotoSubject(dataUri);
    res.json(result);
  } catch (error) {
    console.error('[PhotoAnalysis] Error:', error);
    res.json({
      subjectCount: 1,
      subjectDescription: 'the person',
      perceivedGender: null,
      genderConfidence: 'low',
      estimatedAgeRange: null,
      features: {},
      stylistNotes: '',
    });
  }
});

export default router;
```

- [ ] **Step 5: Create server/routes/chat.js**

```javascript
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
```

- [ ] **Step 6: Register routes in server/index.js**

Add after the existing `app.use('/api/sogni', sogniRoutes);` line:

```javascript
import photoAnalysisRoutes from './routes/photoAnalysis.js';
import chatRoutes from './routes/chat.js';

// ... after sogni routes
app.use('/api/photo-analysis', photoAnalysisRoutes);
app.use('/api/chat', chatRoutes);
```

- [ ] **Step 7: Commit**

```bash
git add server/routes/photoAnalysis.js server/routes/chat.js server/services/sogni.js server/index.js
git commit -m "feat: add backend photo analysis and chat completion routes"
```

---

### Task 2: Frontend Types & Constants

**Stream:** B (Core AI Services)
**Files:**
- Modify: `src/types/index.ts` — add chat and AI types
- Create: `src/types/chat.ts` — chat-specific types

- [ ] **Step 1: Add `'ai-generated'` to TransformationCategory in src/types/index.ts**

Add `| 'ai-generated'` to the `TransformationCategory` union type.

- [ ] **Step 2: Create src/types/chat.ts**

```typescript
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
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts src/types/chat.ts
git commit -m "feat: add chat, tool, and AI type definitions"
```

---

### Task 3: Photo Analysis Service (Frontend)

**Stream:** B (Core AI Services)
**Files:**
- Create: `src/services/photoAnalysisService.ts`
- Modify: `src/services/frontendSogniAdapter.ts` — add `getChatClient()`
- Modify: `src/services/api.ts` — add `analyzePhoto()` API function

- [ ] **Step 1: Add `getChatClient()` to FrontendSogniClientAdapter**

In `src/services/frontendSogniAdapter.ts`, add this method to the `FrontendSogniClientAdapter` class after the `cancelProject` method:

```typescript
  /**
   * Expose the raw SogniClient for direct chat API access.
   * The chat API doesn't need the adapter's project-event normalization.
   */
  getChatClient(): SogniClient {
    return this.realClient;
  }
```

- [ ] **Step 2: Add `analyzePhoto()` to src/services/api.ts**

Add this function to the API service:

```typescript
export async function analyzePhoto(imageBase64: string): Promise<import('@/types/chat').PhotoAnalysis> {
  const urls = getURLs();
  const response = await fetch(`${urls.apiUrl}/api/photo-analysis/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64 }),
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Photo analysis failed: ${response.status}`);
  }

  return response.json();
}
```

- [ ] **Step 3: Create src/services/photoAnalysisService.ts**

```typescript
import type { PhotoAnalysis } from '@/types/chat';
import { analyzePhoto as analyzePhotoApi } from '@/services/api';

const analysisCache = new Map<string, PhotoAnalysis>();

const FALLBACK_ANALYSIS: PhotoAnalysis = {
  subjectCount: 1,
  subjectDescription: 'the person',
  perceivedGender: null,
  genderConfidence: 'low',
  estimatedAgeRange: null,
  features: {},
  stylistNotes: '',
};

const ANALYSIS_SYSTEM_PROMPT = `You are an eccentric legendary Hollywood stylist to the stars. Analyze the portrait photo as if the subject is the client sitting in your studio chair, ready to upgrade their look.

Return JSON with your professional assessment:
{
  "subjectCount": 1,
  "subjectDescription": "a young woman with long dark curly hair",
  "perceivedGender": "female",
  "genderConfidence": "high",
  "estimatedAgeRange": "25-30",
  "features": {
    "hairColor": "dark brown",
    "hairStyle": "long, curly",
    "hairLength": "long",
    "skinTone": "medium warm",
    "facialHair": null,
    "glasses": false,
    "distinctiveFeatures": ["killer cheekbones", "full lips"]
  },
  "stylistNotes": "That bone structure is begging for a dramatic side part. The warm skin tone opens up the whole copper-to-auburn palette."
}

Focus on: apparent gender, age range, hair (color/length/style), skin tone, facial hair, glasses, distinctive visible features. Do NOT mention clothing or background. The stylistNotes should be your candid professional read — what excites you about this client's potential.`;

/**
 * Resize an image to max 512px for efficient LLM analysis.
 */
async function resizeImageForAnalysis(imageUrl: string): Promise<string> {
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

function parseAnalysisResponse(content: string): PhotoAnalysis {
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  const parsed = JSON.parse(cleaned);
  return {
    subjectCount: typeof parsed.subjectCount === 'number' ? parsed.subjectCount : 1,
    subjectDescription: typeof parsed.subjectDescription === 'string' ? parsed.subjectDescription : 'the person',
    perceivedGender: ['male', 'female'].includes(parsed.perceivedGender) ? parsed.perceivedGender : null,
    genderConfidence: ['high', 'medium', 'low'].includes(parsed.genderConfidence) ? parsed.genderConfidence : 'low',
    estimatedAgeRange: typeof parsed.estimatedAgeRange === 'string' ? parsed.estimatedAgeRange : null,
    features: parsed.features || {},
    stylistNotes: typeof parsed.stylistNotes === 'string' ? parsed.stylistNotes : '',
  };
}

/**
 * Analyze a photo using the LLM vision model.
 * Authenticated users call the SDK directly; demo users go through the backend proxy.
 */
export async function analyzePhotoSubject(
  imageUrl: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sogniClient?: any
): Promise<PhotoAnalysis> {
  // Check cache
  const cached = analysisCache.get(imageUrl);
  if (cached) return cached;

  try {
    const dataUri = await resizeImageForAnalysis(imageUrl);

    let result: PhotoAnalysis;

    if (sogniClient?.getChatClient) {
      // Authenticated path: direct SDK call
      const rawClient = sogniClient.getChatClient();
      const messages = [
        { role: 'system' as const, content: ANALYSIS_SYSTEM_PROMPT },
        {
          role: 'user' as const,
          content: [
            { type: 'image_url' as const, image_url: { url: dataUri } },
            { type: 'text' as const, text: 'Describe the main subject of this portrait.' },
          ],
        },
      ];

      let fullContent = '';
      const stream = await rawClient.chat.completions.create({
        model: 'qwen3.5-35b-a3b-gguf-q4km',
        messages,
        stream: true,
        tokenType: 'spark',
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 300,
        think: false,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) fullContent += delta;
      }

      result = parseAnalysisResponse(fullContent);
    } else {
      // Demo path: backend proxy
      const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
      result = await analyzePhotoApi(base64);
    }

    analysisCache.set(imageUrl, result);
    return result;
  } catch (error) {
    console.error('[PhotoAnalysis] Error:', error);
    return FALLBACK_ANALYSIS;
  }
}

export { FALLBACK_ANALYSIS };
```

- [ ] **Step 4: Commit**

```bash
git add src/services/photoAnalysisService.ts src/services/frontendSogniAdapter.ts src/services/api.ts
git commit -m "feat: add photo analysis service with dual-path support"
```

---

### Task 4: Transformation Service

**Stream:** B (Core AI Services)
**Files:**
- Create: `src/services/transformationService.ts`

- [ ] **Step 1: Create src/services/transformationService.ts**

```typescript
import type { GeneratedCategory, PhotoAnalysis } from '@/types/chat';
import { getURLs } from '@/config/urls';

const TRANSFORMATION_GENERATION_PROMPT = `Based on this client's features and what they're looking for, generate 8-12 transformation options organized into 2-4 categories.

Client: {photoAnalysis}
They want: {intent}

Return JSON:
{
  "categories": [
    {
      "name": "Hair Color",
      "icon": "🎨",
      "transformations": [
        {
          "id": "unique-id",
          "name": "Copper Auburn",
          "prompt": "Change [subject description]'s hair color to rich copper auburn with warm highlights while preserving facial features and identity",
          "pitch": "Your warm skin tone would make this absolutely glow",
          "intensity": 0.7,
          "negativePrompt": "deformed, distorted, bad quality, blurry",
          "icon": "🔥"
        }
      ]
    }
  ]
}

Rules:
- Write prompts with the actual subject description baked in (not generic "the person")
- Set intensity (denoising strength) appropriate to how dramatic the change is: subtle 0.5-0.6, moderate 0.6-0.75, dramatic 0.75-0.95
- Each pitch is a one-liner the stylist would say to sell the look — cheeky, confident, fun
- Categories should be relevant to what the client asked for
- Keep negative prompts consistent: "deformed, distorted, bad quality, blurry"
- Generate unique IDs for each transformation (use descriptive slugs like "copper-auburn-hair")
- Include emoji icons that match each transformation`;

function buildGenerationPrompt(photoAnalysis: PhotoAnalysis, intent: string): string {
  return TRANSFORMATION_GENERATION_PROMPT
    .replace('{photoAnalysis}', JSON.stringify(photoAnalysis, null, 2))
    .replace('{intent}', intent);
}

function parseCategories(content: string): GeneratedCategory[] {
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  const parsed = JSON.parse(cleaned);
  const categories = parsed.categories || parsed;

  if (!Array.isArray(categories)) {
    throw new Error('Expected categories array');
  }

  return categories.map((cat: Record<string, unknown>) => ({
    name: String(cat.name || 'Looks'),
    icon: String(cat.icon || '✨'),
    transformations: (Array.isArray(cat.transformations) ? cat.transformations : []).map(
      (t: Record<string, unknown>) => ({
        id: String(t.id || `gen-${Math.random().toString(36).slice(2, 8)}`),
        name: String(t.name || 'Transformation'),
        prompt: String(t.prompt || ''),
        pitch: String(t.pitch || ''),
        intensity: typeof t.intensity === 'number' ? t.intensity : 0.65,
        negativePrompt: String(t.negativePrompt || 'deformed, distorted, bad quality, blurry'),
        icon: String(t.icon || '✨'),
      })
    ),
  }));
}

/**
 * Generate personalized transformation options via LLM.
 */
export async function generateTransformations(
  photoAnalysis: PhotoAnalysis,
  intent: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sogniClient?: any
): Promise<GeneratedCategory[]> {
  const prompt = buildGenerationPrompt(photoAnalysis, intent);

  try {
    if (sogniClient?.getChatClient) {
      // Authenticated: direct SDK
      const rawClient = sogniClient.getChatClient();
      const messages = [
        { role: 'system' as const, content: 'You are an eccentric legendary Hollywood stylist. Generate transformation options in JSON format exactly as requested.' },
        { role: 'user' as const, content: prompt },
      ];

      let fullContent = '';
      const stream = await rawClient.chat.completions.create({
        model: 'qwen3.5-35b-a3b-gguf-q4km',
        messages,
        stream: true,
        tokenType: 'spark',
        temperature: 0.8,
        max_tokens: 2000,
        think: false,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) fullContent += delta;
      }

      return parseCategories(fullContent);
    } else {
      // Demo: backend proxy
      const urls = getURLs();
      const response = await fetch(`${urls.apiUrl}/api/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are an eccentric legendary Hollywood stylist. Generate transformation options in JSON format exactly as requested.' },
            { role: 'user', content: prompt },
          ],
        }),
        credentials: 'include',
      });

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) fullContent += data.content;
            } catch {
              // ignore parse errors on individual lines
            }
          }
        }
      }

      return parseCategories(fullContent);
    }
  } catch (error) {
    console.error('[TransformationService] Error generating transformations:', error);
    // Return a fallback set
    return [{
      name: 'Quick Looks',
      icon: '✨',
      transformations: [
        {
          id: 'fallback-glam',
          name: 'Glamorous Makeover',
          prompt: `Give ${photoAnalysis.subjectDescription} a glamorous red carpet makeover while preserving facial features and identity`,
          pitch: 'Let\'s start with a classic glow-up',
          intensity: 0.7,
          negativePrompt: 'deformed, distorted, bad quality, blurry',
          icon: '💫',
        },
        {
          id: 'fallback-hair',
          name: 'Bold Hair Change',
          prompt: `Change ${photoAnalysis.subjectDescription}'s hair to a completely new dramatic style while preserving facial features and identity`,
          pitch: 'Nothing says transformation like a new do',
          intensity: 0.75,
          negativePrompt: 'deformed, distorted, bad quality, blurry',
          icon: '💇',
        },
      ],
    }];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/transformationService.ts
git commit -m "feat: add AI-powered transformation generation service"
```

---

### Task 5: Tool Registry

**Stream:** B (Core AI Services)
**Files:**
- Create: `src/services/toolRegistry.ts`

- [ ] **Step 1: Create src/services/toolRegistry.ts**

```typescript
import type { ToolDefinition, ToolResult, MakeoverToolContext } from '@/types/chat';

export type ToolHandler = (
  args: Record<string, unknown>,
  context: MakeoverToolContext
) => Promise<ToolResult>;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
  timeout: number;
}

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(
    name: string,
    definition: ToolDefinition,
    handler: ToolHandler,
    timeout = 120000
  ): void {
    this.tools.set(name, { definition, handler, timeout });
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: MakeoverToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${name}` };
    }

    const timeoutMs = tool.timeout;

    try {
      const result = await Promise.race([
        tool.handler(args, context),
        new Promise<ToolResult>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool ${name} timed out after ${timeoutMs / 1000}s`)), timeoutMs)
        ),
      ]);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();
```

- [ ] **Step 2: Commit**

```bash
git add src/services/toolRegistry.ts
git commit -m "feat: add tool registry for chat function calling"
```

---

### Task 6: Tool Definitions & Handlers

**Stream:** B (Core AI Services)
**Files:**
- Create: `src/tools/generate-makeover.ts`
- Create: `src/tools/analyze-result.ts`
- Create: `src/tools/compare-before-after.ts`
- Create: `src/tools/adjust-intensity.ts`
- Create: `src/tools/stack-transformation.ts`
- Create: `src/tools/generate-transformations.ts`
- Create: `src/tools/index.ts`

- [ ] **Step 1: Create src/tools/generate-makeover.ts**

```typescript
import { toolRegistry } from '@/services/toolRegistry';
import type { ToolResult, MakeoverToolContext } from '@/types/chat';

const definition = {
  type: 'function' as const,
  function: {
    name: 'generate_makeover',
    description: 'Generate a makeover transformation on the client\'s photo. Use this when the client wants to try a specific look.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed transformation prompt describing the desired change' },
        intensity: { type: 'number', description: 'Denoising strength 0.3-0.95. Lower = subtle, higher = dramatic. Default 0.65' },
        negativePrompt: { type: 'string', description: 'What to avoid in the result' },
      },
      required: ['prompt'],
    },
  },
};

async function handler(
  args: Record<string, unknown>,
  context: MakeoverToolContext
): Promise<ToolResult> {
  const prompt = String(args.prompt || '');
  const intensity = typeof args.intensity === 'number' ? args.intensity : undefined;
  const negativePrompt = typeof args.negativePrompt === 'string' ? args.negativePrompt : undefined;

  if (!prompt) {
    return { success: false, error: 'A prompt is required' };
  }

  try {
    const result = await context.generateFromPrompt({
      prompt,
      intensity,
      negativePrompt,
      useStackedInput: false,
    });
    return { success: true, data: { resultUrl: result.resultUrl, projectId: result.projectId } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

toolRegistry.register('generate_makeover', definition, handler, 120000);
```

- [ ] **Step 2: Create src/tools/analyze-result.ts**

```typescript
import { toolRegistry } from '@/services/toolRegistry';
import type { ToolResult, MakeoverToolContext } from '@/types/chat';

const definition = {
  type: 'function' as const,
  function: {
    name: 'analyze_result',
    description: 'Analyze a generated makeover result and provide professional feedback. Call this after a makeover completes to comment on the result.',
    parameters: {
      type: 'object',
      properties: {
        resultIndex: { type: 'number', description: 'Index in edit stack, defaults to latest result' },
      },
    },
  },
};

async function handler(
  args: Record<string, unknown>,
  context: MakeoverToolContext
): Promise<ToolResult> {
  const stack = context.getEditStack();
  const idx = typeof args.resultIndex === 'number' ? args.resultIndex : stack.length - 1;
  const step = stack[idx];

  if (!step) {
    return { success: false, error: 'No result to analyze' };
  }

  const imageUrl = step.resultImageUrl;
  if (!imageUrl) {
    return { success: false, error: 'Result image not available' };
  }

  try {
    const analysis = await context.analyzeImage(
      imageUrl,
      'You are an eccentric Hollywood stylist reviewing a makeover result. Describe how the transformation looks — what works well, what could be refined. Be specific and enthusiastic. Suggest 2-3 follow-up ideas. Keep it brief and fun.'
    );
    return { success: true, data: { analysis } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

toolRegistry.register('analyze_result', definition, handler, 30000);
```

- [ ] **Step 3: Create src/tools/compare-before-after.ts**

```typescript
import { toolRegistry } from '@/services/toolRegistry';
import type { ToolResult, MakeoverToolContext } from '@/types/chat';

const definition = {
  type: 'function' as const,
  function: {
    name: 'compare_before_after',
    description: 'Compare the original photo with a makeover result side by side. Useful for discussing what changed.',
    parameters: {
      type: 'object',
      properties: {
        resultIndex: { type: 'number', description: 'Index in edit stack, defaults to latest' },
      },
    },
  },
};

async function handler(
  args: Record<string, unknown>,
  context: MakeoverToolContext
): Promise<ToolResult> {
  const originalUrl = context.getOriginalImageUrl();
  const stack = context.getEditStack();
  const idx = typeof args.resultIndex === 'number' ? args.resultIndex : stack.length - 1;
  const step = stack[idx];

  if (!originalUrl || !step?.resultImageUrl) {
    return { success: false, error: 'Need both original and result images to compare' };
  }

  try {
    const comparison = await context.analyzeImage(
      step.resultImageUrl,
      `You are an eccentric Hollywood stylist comparing a before and after. The original image shows: ${context.getPhotoAnalysis().subjectDescription}. The transformation applied was: "${step.transformation.prompt}". Describe what changed, what improved, and rate the transformation. Be enthusiastic but honest.`
    );
    return { success: true, data: { comparison } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

toolRegistry.register('compare_before_after', definition, handler, 30000);
```

- [ ] **Step 4: Create src/tools/adjust-intensity.ts**

```typescript
import { toolRegistry } from '@/services/toolRegistry';
import type { ToolResult, MakeoverToolContext } from '@/types/chat';

const definition = {
  type: 'function' as const,
  function: {
    name: 'adjust_intensity',
    description: 'Re-run the last transformation with a different intensity. Use when the client wants the effect more or less dramatic.',
    parameters: {
      type: 'object',
      properties: {
        intensity: { type: 'number', description: 'New denoising strength 0.3-0.95. Lower = subtler effect, higher = more dramatic.' },
      },
      required: ['intensity'],
    },
  },
};

async function handler(
  args: Record<string, unknown>,
  context: MakeoverToolContext
): Promise<ToolResult> {
  const intensity = typeof args.intensity === 'number' ? args.intensity : 0.65;
  const stack = context.getEditStack();
  const lastStep = stack[stack.length - 1];

  if (!lastStep) {
    return { success: false, error: 'No previous transformation to adjust' };
  }

  try {
    const result = await context.generateFromPrompt({
      prompt: lastStep.transformation.prompt,
      intensity: Math.max(0.3, Math.min(0.95, intensity)),
      negativePrompt: lastStep.transformation.negativePrompt,
      useStackedInput: false,
    });
    return { success: true, data: { resultUrl: result.resultUrl, projectId: result.projectId, newIntensity: intensity } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

toolRegistry.register('adjust_intensity', definition, handler, 120000);
```

- [ ] **Step 5: Create src/tools/stack-transformation.ts**

```typescript
import { toolRegistry } from '@/services/toolRegistry';
import type { ToolResult, MakeoverToolContext } from '@/types/chat';

const definition = {
  type: 'function' as const,
  function: {
    name: 'stack_transformation',
    description: 'Apply an additional transformation on top of the current result. Great for layering effects (e.g., hair change + makeup).',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The transformation prompt to apply on top of the current result' },
        intensity: { type: 'number', description: 'Denoising strength 0.3-0.95' },
      },
      required: ['prompt'],
    },
  },
};

async function handler(
  args: Record<string, unknown>,
  context: MakeoverToolContext
): Promise<ToolResult> {
  const prompt = String(args.prompt || '');
  const intensity = typeof args.intensity === 'number' ? args.intensity : undefined;

  if (!prompt) {
    return { success: false, error: 'A prompt is required' };
  }

  if (context.getEditStackDepth() === 0) {
    return { success: false, error: 'No previous result to stack on. Use generate_makeover first.' };
  }

  try {
    const result = await context.generateFromPrompt({
      prompt,
      intensity,
      useStackedInput: true,
    });
    return {
      success: true,
      data: { resultUrl: result.resultUrl, projectId: result.projectId, stackDepth: context.getEditStackDepth() },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

toolRegistry.register('stack_transformation', definition, handler, 120000);
```

- [ ] **Step 6: Create src/tools/generate-transformations.ts**

```typescript
import { toolRegistry } from '@/services/toolRegistry';
import type { ToolResult, MakeoverToolContext } from '@/types/chat';
import { generateTransformations } from '@/services/transformationService';

const definition = {
  type: 'function' as const,
  function: {
    name: 'generate_transformations',
    description: 'Generate personalized transformation options for the grid based on what the client is looking for. Call this after understanding their intent.',
    parameters: {
      type: 'object',
      properties: {
        intent: { type: 'string', description: 'What the client is looking for, e.g. "dramatic hair changes" or "subtle professional look"' },
        count: { type: 'number', description: 'Number of options to generate, default 8-12' },
      },
      required: ['intent'],
    },
  },
};

async function handler(
  args: Record<string, unknown>,
  context: MakeoverToolContext
): Promise<ToolResult> {
  const intent = String(args.intent || 'general makeover options');
  const photoAnalysis = context.getPhotoAnalysis();
  const sogniClient = context.getSogniClient();

  try {
    const categories = await generateTransformations(photoAnalysis, intent, sogniClient);
    return { success: true, data: { categories } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

toolRegistry.register('generate_transformations', definition, handler, 30000);
```

- [ ] **Step 7: Create src/tools/index.ts**

```typescript
// Import all tools to trigger registration with the registry
import './generate-makeover';
import './analyze-result';
import './compare-before-after';
import './adjust-intensity';
import './stack-transformation';
import './generate-transformations';
```

- [ ] **Step 8: Commit**

```bash
git add src/tools/ src/services/toolRegistry.ts
git commit -m "feat: add 6 makeover tools with registry"
```

---

### Task 7: Chat Service

**Stream:** C (Chat System)
**Files:**
- Create: `src/services/chatService.ts`

- [ ] **Step 1: Create src/services/chatService.ts**

```typescript
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
const MAX_TOOL_ROUNDS = 3;

function buildSystemPrompt(photoAnalysis: PhotoAnalysis): string {
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
  sogniClient?: any
): Promise<ChatMessage[]> {
  const systemMessage = {
    role: 'system' as const,
    content: buildSystemPrompt(photoAnalysis),
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

  const tools = toolRegistry.getDefinitions();

  let roundCount = 0;
  let currentMessages = llmMessages;

  while (roundCount < MAX_TOOL_ROUNDS) {
    roundCount++;

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

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.delta?.content) {
          assistantContent += choice.delta.content;
          callbacks.onToken(choice.delta.content);
        }

        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
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
            const eventType = line.slice(7).trim();
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

    // Execute tool calls
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

      // Add tool result to history
      const toolMsg: ChatMessage = {
        id: generateId(),
        role: 'tool',
        content: JSON.stringify(result),
        timestamp: Date.now(),
        toolCallId: toolCall.id,
      };
      updatedHistory.push(toolMsg);

      // Add to LLM messages for next round
      currentMessages = [
        ...currentMessages,
        {
          role: 'assistant' as const,
          content: assistantContent,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        },
        {
          role: 'tool' as const,
          content: JSON.stringify(result),
          tool_call_id: toolCall.id,
        },
      ];
    }

    // Reset for next round
    assistantContent = '';
  }

  // Max rounds reached
  callbacks.onComplete(updatedHistory);
  return updatedHistory;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/chatService.ts
git commit -m "feat: add chat service with streaming and tool calling loop"
```

---

### Task 8: useChat Hook

**Stream:** C (Chat System)
**Files:**
- Create: `src/hooks/useChat.ts`

- [ ] **Step 1: Create src/hooks/useChat.ts**

```typescript
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
import type { EditStep, Transformation } from '@/types';
import { sendChatMessage } from '@/services/chatService';
import { analyzePhotoSubject, FALLBACK_ANALYSIS } from '@/services/photoAnalysisService';
import { GENERATION_DEFAULTS } from '@/constants/settings';

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
          onToolCallComplete: (toolCall, result) => {
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
    // Notify the chat that the user clicked a grid card
    const msg = `I want to try "${transformation.name}"`;
    sendMessage(msg);
  }, [sendMessage]);

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
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useChat.ts
git commit -m "feat: add useChat hook bridging chat service to React"
```

---

### Task 9: AppContext Integration

**Stream:** C (Chat System)
**Files:**
- Modify: `src/context/AppContext.tsx` — add `generateFromPrompt`, expose chat-relevant state

- [ ] **Step 1: Add `generateFromPrompt` to AppContext**

Add this function inside the AppProvider, after the existing `generateMakeover` function (around line 995). This is a simplified wrapper that tools can call:

```typescript
  /**
   * Simplified generation interface for chat tools.
   * Constructs a synthetic Transformation and delegates to generateMakeover.
   */
  const generateFromPrompt = useCallback(
    async (params: {
      prompt: string;
      intensity?: number;
      negativePrompt?: string;
      useStackedInput?: boolean;
    }): Promise<{ resultUrl: string; projectId: string }> => {
      // Temporarily switch edit stack mode if needed
      const prevMode = editStack.mode;
      if (params.useStackedInput) {
        editStack.setMode('stacked');
      } else {
        editStack.setMode('original');
      }

      const syntheticTransformation: Transformation = {
        id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: params.prompt.slice(0, 30) + (params.prompt.length > 30 ? '...' : ''),
        category: 'ai-generated',
        subcategory: 'chat',
        prompt: params.prompt,
        icon: '🤖',
        intensity: params.intensity,
        negativePrompt: params.negativePrompt,
      };

      await generateMakeover(syntheticTransformation);

      // Restore edit stack mode
      if (prevMode !== editStack.mode) {
        editStack.setMode(prevMode);
      }

      // Extract result from current state
      // The result is set by generateMakeover via setCurrentResult
      const stack = editStack.steps;
      const latestStep = stack[stack.length - 1];

      return {
        resultUrl: latestStep?.resultImageUrl || '',
        projectId: '',
      };
    },
    [generateMakeover, editStack]
  );
```

- [ ] **Step 2: Expose `generateFromPrompt` in the context value**

Add `generateFromPrompt` to both the `AppContextValue` interface and the `AppContext.Provider` value:

In the interface:
```typescript
  generateFromPrompt: (params: {
    prompt: string;
    intensity?: number;
    negativePrompt?: string;
    useStackedInput?: boolean;
  }) => Promise<{ resultUrl: string; projectId: string }>;
```

In the provider value:
```typescript
  generateFromPrompt,
```

- [ ] **Step 3: Commit**

```bash
git add src/context/AppContext.tsx
git commit -m "feat: add generateFromPrompt to AppContext for chat tool integration"
```

---

### Task 10: Chat UI Components

**Stream:** D (UI)
**Files:**
- Create: `src/components/chat/ChatPanel.tsx`
- Create: `src/components/chat/ChatMessage.tsx`
- Create: `src/components/chat/ChatInput.tsx`
- Create: `src/components/chat/SuggestionChips.tsx`

- [ ] **Step 1: Create src/components/chat/ChatMessage.tsx**

```typescript
import { motion } from 'framer-motion';
import type { ChatMessage as ChatMessageType, ToolProgress } from '@/types/chat';

interface ChatMessageProps {
  message: ChatMessageType;
  toolProgress?: ToolProgress | null;
}

function ChatMessage({ message, toolProgress }: ChatMessageProps) {
  if (message.role === 'tool' || message.role === 'system') return null;

  const isUser = message.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-primary-400/15 text-primary-100'
            : 'bg-surface-800/60 text-white/80'
        }`}
      >
        {message.content || (message.isStreaming ? (
          <span className="inline-flex items-center gap-1">
            <span className="animate-pulse">...</span>
          </span>
        ) : null)}

        {/* Tool progress indicator */}
        {toolProgress && !isUser && message.isStreaming && (
          <div className="mt-2 flex items-center gap-2 text-xs text-white/40">
            {toolProgress.status === 'running' && (
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            {toolProgress.message}
          </div>
        )}

        {/* Inline result thumbnails */}
        {message.imageResults && message.imageResults.length > 0 && (
          <div className="mt-2 flex gap-2">
            {message.imageResults.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Result ${i + 1}`}
                className="h-20 w-20 rounded-lg object-cover"
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default ChatMessage;
```

- [ ] **Step 2: Create src/components/chat/ChatInput.tsx**

```typescript
import { useState, useRef, useCallback } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
  placeholder?: string;
}

function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, []);

  return (
    <div className="flex items-end gap-2 border-t border-primary-400/[0.06] bg-surface-900/80 p-3">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => { setValue(e.target.value); handleInput(); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Tell your stylist what you want...'}
        disabled={disabled}
        rows={1}
        className="min-h-[36px] max-h-[120px] flex-1 resize-none rounded-xl border border-primary-400/10 bg-surface-800/60 px-3 py-2 text-sm text-white/80 placeholder-white/25 outline-none transition-colors focus:border-primary-400/25"
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary-400/15 text-primary-300 transition-all hover:bg-primary-400/25 disabled:opacity-30 disabled:hover:bg-primary-400/15"
        aria-label="Send message"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
        </svg>
      </button>
    </div>
  );
}

export default ChatInput;
```

- [ ] **Step 3: Create src/components/chat/SuggestionChips.tsx**

```typescript
interface SuggestionChipsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  disabled: boolean;
}

function SuggestionChips({ suggestions, onSelect, disabled }: SuggestionChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-2">
      {suggestions.map((suggestion, i) => (
        <button
          key={i}
          onClick={() => onSelect(suggestion)}
          disabled={disabled}
          className="rounded-full border border-primary-400/10 bg-surface-800/40 px-3 py-1 text-xs text-white/50 transition-all hover:border-primary-400/25 hover:bg-primary-400/[0.06] hover:text-white/70 disabled:opacity-30"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

export default SuggestionChips;
```

- [ ] **Step 4: Create src/components/chat/ChatPanel.tsx**

```typescript
import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ChatMessage from '@/components/chat/ChatMessage';
import ChatInput from '@/components/chat/ChatInput';
import SuggestionChips from '@/components/chat/SuggestionChips';
import type { ChatMessage as ChatMessageType, ToolProgress } from '@/types/chat';

interface ChatPanelProps {
  messages: ChatMessageType[];
  isStreaming: boolean;
  isChatOpen: boolean;
  currentToolProgress: ToolProgress | null;
  onSendMessage: (text: string) => void;
  onClose: () => void;
}

const defaultSuggestions = [
  'Show me dramatic looks',
  'Something subtle and professional',
  'Let\'s go wild!',
  'Change my hairstyle',
];

function ChatPanel({
  messages,
  isStreaming,
  isChatOpen,
  currentToolProgress,
  onSendMessage,
  onClose,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Get suggestions from the latest assistant message or use defaults
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && !m.isStreaming);
  const suggestions = lastAssistant?.suggestions || (messages.length <= 1 ? defaultSuggestions : []);

  return (
    <AnimatePresence>
      {isChatOpen && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="chat-panel flex h-full flex-col border-l border-primary-400/[0.06] bg-surface-950/95 backdrop-blur-sm"
        >
          {/* Header */}
          <div className="flex flex-shrink-0 items-center justify-between border-b border-primary-400/[0.06] px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-base">💇</span>
              <span className="text-xs font-medium text-white/60">Your Stylist</span>
            </div>
            <button
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
              aria-label="Close chat"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            <div className="flex flex-col gap-3">
              {messages
                .filter((m) => m.role !== 'tool' && m.role !== 'system')
                .map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    toolProgress={
                      message.isStreaming ? currentToolProgress : null
                    }
                  />
                ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Suggestions */}
          <SuggestionChips
            suggestions={suggestions}
            onSelect={onSendMessage}
            disabled={isStreaming}
          />

          {/* Input */}
          <ChatInput
            onSend={onSendMessage}
            disabled={isStreaming}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default ChatPanel;
```

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/
git commit -m "feat: add chat UI components (panel, messages, input, suggestions)"
```

---

### Task 11: Studio Layout Integration

**Stream:** D (UI)
**Files:**
- Modify: `src/components/studio/MakeoverStudio.tsx` — add chat panel, wire up useChat
- Modify: `src/components/studio/CategoryNav.tsx` — support dynamic categories
- Modify: `src/components/studio/TransformationPicker.tsx` — support AI-generated transformations
- Add: `src/styles/studio.css` — add chat panel styles

- [ ] **Step 1: Update CategoryNav to support dynamic categories**

Replace the static CATEGORIES import with a props-based approach:

```typescript
import { motion } from 'framer-motion';
import type { GeneratedCategory } from '@/types/chat';

interface CategoryNavProps {
  categories: GeneratedCategory[];
  selectedCategory: string;
  onSelectCategory: (categoryName: string) => void;
  isLoading: boolean;
}

function CategoryNav({ categories, selectedCategory, onSelectCategory, isLoading }: CategoryNavProps) {
  if (isLoading) {
    return (
      <nav className="studio-sidebar" aria-label="Transformation categories">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1 rounded-xl px-2 py-3">
            <div className="h-6 w-6 animate-pulse rounded-lg bg-white/5" />
            <div className="h-3 w-12 animate-pulse rounded bg-white/5" />
          </div>
        ))}
      </nav>
    );
  }

  return (
    <nav className="studio-sidebar" aria-label="Transformation categories">
      {categories.map((category) => {
        const isActive = selectedCategory === category.name;
        return (
          <motion.button
            key={category.name}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onSelectCategory(category.name)}
            className={`relative flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-center transition-all md:px-3 ${
              isActive
                ? 'bg-primary-400/8 text-primary-300'
                : 'text-white/35 hover:bg-primary-400/[0.04] hover:text-white/50'
            }`}
            aria-label={category.name}
            aria-current={isActive ? 'true' : undefined}
          >
            {isActive && (
              <motion.div
                layoutId="category-highlight"
                className="absolute inset-0 rounded-xl border border-primary-400/15 bg-primary-400/[0.04]"
                transition={{ duration: 0.25, ease: 'easeInOut' }}
              />
            )}
            <span className="relative text-lg md:text-xl">{category.icon}</span>
            <span className="relative text-center text-[10px] font-medium leading-tight md:text-xs">
              {category.name}
            </span>
          </motion.button>
        );
      })}
    </nav>
  );
}

export default CategoryNav;
```

- [ ] **Step 2: Update TransformationPicker to support AI-generated transformations**

```typescript
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { GeneratedTransformation, GeneratedCategory } from '@/types/chat';

interface TransformationPickerProps {
  categories: GeneratedCategory[];
  selectedCategory: string;
  onSelectTransformation: (transformation: GeneratedTransformation) => void;
  isDisabled: boolean;
  activeTransformationId: string | null;
  isLoading: boolean;
}

const gridContainerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.03 },
  },
};

const gridItemVariants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1 },
};

function TransformationPicker({
  categories,
  selectedCategory,
  onSelectTransformation,
  isDisabled,
  activeTransformationId,
  isLoading,
}: TransformationPickerProps) {
  const category = useMemo(
    () => categories.find((c) => c.name === selectedCategory),
    [categories, selectedCategory]
  );

  const transformations = category?.transformations || [];

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-col">
        <div className="transformation-grid">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="transformation-card flex flex-col items-center gap-2 p-3">
              <div className="h-8 w-8 animate-pulse rounded-lg bg-white/5" />
              <div className="h-3 w-16 animate-pulse rounded bg-white/5" />
              <div className="h-2 w-24 animate-pulse rounded bg-white/5" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      {/* Transformation grid (scrollable) */}
      <div className="min-h-0 flex-1 overflow-y-auto md:overflow-y-hidden md:overflow-x-auto">
        {transformations.length > 0 ? (
          <motion.div
            key={selectedCategory}
            variants={gridContainerVariants}
            initial="hidden"
            animate="visible"
            className="transformation-grid"
          >
            {transformations.map((transformation) => {
              const isActive = activeTransformationId === transformation.id;
              return (
                <motion.button
                  key={transformation.id}
                  variants={gridItemVariants}
                  transition={{ duration: 0.2 }}
                  whileHover={isDisabled ? undefined : { scale: 1.05 }}
                  whileTap={isDisabled ? undefined : { scale: 0.95 }}
                  onClick={() => !isDisabled && onSelectTransformation(transformation)}
                  className={`transformation-card ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`}
                  disabled={isDisabled}
                  aria-label={`Apply ${transformation.name} transformation`}
                >
                  <span className="text-2xl">{transformation.icon}</span>
                  <span className="text-xs font-medium leading-tight">{transformation.name}</span>
                  {transformation.pitch && (
                    <span className="mt-0.5 text-[10px] leading-tight text-white/30 line-clamp-2">
                      {transformation.pitch}
                    </span>
                  )}
                </motion.button>
              );
            })}
          </motion.div>
        ) : (
          <div className="flex items-center justify-center p-12">
            <p className="text-sm text-white/25">
              Tell your stylist what you're looking for to see personalized options.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default TransformationPicker;
```

- [ ] **Step 3: Update MakeoverStudio to integrate chat**

Rewrite `MakeoverStudio.tsx` to wire up the `useChat` hook, `ChatPanel`, and updated `CategoryNav`/`TransformationPicker`:

The key changes:
- Import and use `useChat` hook
- Replace static CATEGORIES with `generatedCategories` from useChat
- Add ChatPanel alongside the studio layout
- Call `initWithPhoto` when studio mounts with a photo
- Wire grid card clicks to `notifyTransformationSelected`
- Add chat toggle button
- Add `.chat-panel` width to the studio layout CSS

- [ ] **Step 4: Add chat panel CSS to src/styles/studio.css**

Add the following CSS for the chat panel layout:

```css
/* Chat panel within studio layout */
.chat-panel {
  width: 320px;
  min-width: 280px;
  max-width: 380px;
}

@media (max-width: 768px) {
  .chat-panel {
    position: fixed;
    inset: 0;
    width: 100%;
    max-width: 100%;
    z-index: 50;
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/studio/ src/components/chat/ src/styles/studio.css
git commit -m "feat: integrate chat panel into studio layout with dynamic grid"
```

---

### Task 12: Onboarding Flow Update

**Stream:** D (UI)
**Files:**
- Modify: `src/components/landing/LandingHero.tsx` — remove gender selection step

- [ ] **Step 1: Update LandingHero onboarding flow**

In `LandingHero.tsx`:
- Remove the gender selection step from the flow
- Change the step type from `'idle' | 'gender' | 'quality'` to `'idle' | 'quality'`
- The "Get Started" button should go directly to quality tier selection (skip gender)
- Remove `pendingGender`, `hoveredGender`, and related gender UI state
- Keep the quality tier selection as-is

The key change is in the button handler — instead of `setStep('gender')`, it goes to `setStep('quality')`.

- [ ] **Step 2: Commit**

```bash
git add src/components/landing/LandingHero.tsx
git commit -m "feat: remove gender selection from onboarding (AI handles it now)"
```

---

### Task 13: Remove Static Transformations

**Stream:** D (UI)
**Files:**
- Delete: `src/constants/transformations.ts`
- Modify: any remaining imports of transformations.ts

- [ ] **Step 1: Delete src/constants/transformations.ts**

Remove the 3207-line static transformation catalog.

- [ ] **Step 2: Remove all imports of transformations.ts**

Search for and remove any remaining `import ... from '@/constants/transformations'` statements. The components that previously imported from there (CategoryNav, TransformationPicker, MakeoverStudio) were already updated in Task 11.

Check these files for remaining references:
- `src/context/AppContext.tsx` — remove any imports from transformations.ts (the `TransformationCategory` type import comes from `@/types`, not transformations.ts)
- Any other files that import `CATEGORIES`, `getSubcategoriesForGender`, `getTransformationsBySubcategory`, or `getTransformationById`

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: remove static transformation catalog (replaced by AI generation)"
```

---

### Task 14: Final Integration & Lint

**Stream:** All
**Files:**
- Various — fix any TypeScript or lint issues

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 2: Run ESLint**

```bash
npm run lint
```

Fix any lint issues (must pass with 0 warnings per CLAUDE.md).

- [ ] **Step 3: Run useEffect validator**

```bash
npm run validate:useeffect
```

Fix any useEffect violations.

- [ ] **Step 4: Build check**

```bash
npm run build
```

Ensure production build succeeds.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "fix: resolve lint and type errors from AI makeover integration"
```
