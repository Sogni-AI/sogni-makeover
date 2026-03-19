# AI-Powered Makeover: Design Spec

## Overview

Transform Sogni Makeover from a static menu-driven app (100+ hardcoded transformation prompts) into an AI-powered makeover experience. An eccentric Hollywood stylist AI analyzes the user's photo, generates personalized transformation options, and guides them through a chat interface — while a familiar clickable grid remains as a parallel UI.

## Architecture: Modular Services with Thin Chat Orchestrator

Six independent services connected through a thin chat orchestrator, rather than a monolithic chat service. This allows the grid UI and chat to both access transformation and generation services independently.

```
┌──────────────────────────────────────────────────────────────┐
│                        UI Layer                              │
│  ┌─────────────┐  ┌──────────────────────────────────────┐   │
│  │  Chat Panel  │  │  Studio (CategoryNav + Grid + Image) │  │
│  └──────┬───────┘  └──────────────┬───────────────────────┘  │
│         │                         │                          │
│         └────────────┬────────────┘                          │
│                      │                                       │
│              ┌───────▼────────┐                              │
│              │   useChat Hook  │                             │
│              └───────┬────────┘                              │
└──────────────────────┼───────────────────────────────────────┘
                       │
┌──────────────────────┼───────────────────────────────────────┐
│                Service Layer                                 │
│                      │                                       │
│  ┌───────────────────▼──────────────────┐                    │
│  │          Chat Service                │                    │
│  │  (LLM conversation, streaming,      │                    │
│  │   tool call routing)                 │                    │
│  └───────────────────┬──────────────────┘                    │
│                      │                                       │
│          ┌───────────▼───────────┐                           │
│          │    Tool Registry      │                           │
│          └───────────┬───────────┘                           │
│                      │                                       │
│    ┌─────────────────┼──────────────────────┐               │
│    │                 │                      │               │
│    ▼                 ▼                      ▼               │
│ ┌──────────┐  ┌──────────────┐  ┌──────────────────┐       │
│ │  Photo   │  │Transformation│  │  AppContext       │       │
│ │ Analysis │  │  Service     │  │  (generateMakeover│       │
│ │ Service  │  │              │  │   editStack, etc.)│       │
│ └──────────┘  └──────────────┘  └──────────────────┘       │
└──────────────────────────────────────────────────────────────┘
                       │
┌──────────────────────┼───────────────────────────────────────┐
│                Backend Layer                                 │
│                      │                                       │
│    ┌─────────────────┼──────────────────────┐               │
│    │                 │                      │               │
│    ▼                 ▼                      ▼               │
│ ┌──────────┐  ┌──────────────┐  ┌──────────────────┐       │
│ │ /api/    │  │ /api/chat/   │  │ /api/sogni/      │       │
│ │ photo-   │  │ completions  │  │ (existing)       │       │
│ │ analysis │  │              │  │                  │       │
│ └──────────┘  └──────────────┘  └──────────────────┘       │
│                      │                                       │
│              ┌───────▼────────┐                              │
│              │  Sogni SDK     │                              │
│              │  (Qwen 3.5)   │                              │
│              └────────────────┘                              │
└──────────────────────────────────────────────────────────────┘
```

## 1. Photo Analysis Service

**File**: `src/services/photoAnalysisService.ts`

Analyzes uploaded photos using Qwen 3.5 35B vision model. Fires immediately on photo upload — before the chat opens — so results are ready by the time the AI greets the user.

### LLM Configuration

- **Model**: `qwen3.5-35b-a3b-gguf-q4km`
- **Temperature**: 0.1 (deterministic for structured output)
- **Max tokens**: 200
- **Streaming**: true
- **Token type**: spark

### System Prompt

```
You are an eccentric legendary Hollywood stylist to the stars. Analyze the
portrait photo as if the subject is the client sitting in your studio chair,
ready to upgrade their look.

Return JSON with your professional assessment:
{
  "subjectCount": 1,
  "subjectDescription": "a young woman with long dark curly hair",
  "perceivedGender": "female",
  "genderConfidence": "high" | "medium" | "low",
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
  "stylistNotes": "That bone structure is begging for a dramatic side part.
   The warm skin tone opens up the whole copper-to-auburn palette. Could go
   editorial or keep it natural — either way, this face carries it."
}

Focus on: apparent gender, age range, hair (color/length/style), skin tone,
facial hair, glasses, distinctive visible features. Do NOT mention clothing
or background. The stylistNotes should be your candid professional read —
what excites you about this client's potential.
```

### Dual-Path Architecture

- **Authenticated users**: Access the raw `SogniClient` via a new `getChatClient()` method on `FrontendSogniClientAdapter` (see Section 8). Call `rawClient.chat.completions.create()` directly — the chat API does not need the adapter's project-event normalization layer.
- **Demo users**: `POST /api/photo-analysis/analyze` → backend proxy

### Image Preprocessing

- Resize to max 512px on longest side
- Convert to JPEG with 0.7 quality
- Timeout: 15 seconds

### Caching

Results cached by blob URL within the session. Since images are `File` objects converted via `URL.createObjectURL()`, the URL is unique per session but stable within one. No cross-session caching needed.

### Fallback

On any failure, returns:
```json
{
  "subjectCount": 1,
  "subjectDescription": "the person",
  "perceivedGender": null,
  "genderConfidence": "low",
  "estimatedAgeRange": null,
  "features": {},
  "stylistNotes": ""
}
```

### Interface

```typescript
interface PhotoAnalysis {
  subjectCount: number;
  subjectDescription: string;
  perceivedGender: 'male' | 'female' | null;
  genderConfidence: 'high' | 'medium' | 'low';
  estimatedAgeRange: string | null;
  features: {
    hairColor: string | null;
    hairStyle: string | null;
    hairLength: string | null;
    skinTone: string | null;
    facialHair: string | null;
    glasses: boolean;
    distinctiveFeatures: string[];
  };
  stylistNotes: string;
}

function analyzePhoto(
  imageUrl: string,
  sogniClient?: SogniClient | null
): Promise<PhotoAnalysis>
```

## 2. Chat Service

**File**: `src/services/chatService.ts`

Thin orchestrator managing LLM conversation, streaming responses, and routing tool calls. Adapted from sogni-chat's pattern but without persona system, memory persistence, or session management.

### System Prompt

```
You are an eccentric legendary Hollywood stylist to the stars. A new client
just sat down in your chair and you've studied their look. You're playful,
a bit cheeky, and confidently opinionated — but always gassing up your client.
You live for a good transformation.

Your job:
1. Greet the client with your read on their look (use your stylist notes)
2. Ask what kind of vibe they're going for today
3. Based on their answer, generate personalized transformation options
4. Guide them through trying looks, stacking edits, and refining results

Rules:
- One tool call per response, always with a brief friendly message
- When uncertain about gender or preferences, ask — don't assume
- After a makeover generates, analyze the result and suggest what to try next
- Suggest stacking edits when it makes sense ("Now let's layer some bold
  eye makeup on top of that new hair!")
- Keep it fun. This is a glow-up, not a doctor's appointment.

Client analysis:
{photoAnalysis JSON injected here}
```

### LLM Configuration

- **Model**: `qwen3.5-35b-a3b-gguf-q4km`
- **Temperature**: 0.7 (creative but coherent)
- **Max tokens**: 500
- **Streaming**: true
- **Token type**: spark
- **Tool calling**: enabled (OpenAI-format function definitions)
- **`think: false`** — disables Qwen's extended reasoning to prevent raw `<think>` blocks from streaming to users. If thinking is ever enabled in the future, `stripThinkBlocks()` must be added to the streaming handler (see sogni-chat's implementation).

### Tool Calling Loop

Up to 3 rounds per user message. After the LLM responds with a tool call:
1. Execute the tool via the registry
2. Append tool result to conversation
3. Send back to LLM for the next response
4. If LLM responds with text (no tool call), stream it to the user

### Context Window

Basic sliding window — drop oldest message pairs when approaching ~65k token limit. Makeover conversations are typically short (10-20 exchanges), so this rarely triggers.

### Streaming

Token-by-token via Sogni SDK's streaming API. The `useChat` hook updates message content on each token for live typing effect.

### Interface

```typescript
interface ChatMessage {
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

interface ChatStreamCallbacks {
  onToken: (token: string) => void;
  onToolCallStart: (toolCall: ToolCall) => void;
  onToolCallComplete: (toolCall: ToolCall, result: ToolResult) => void;
  onComplete: (messages: ChatMessage[]) => void;
  onError: (error: Error) => void;
}

// Chat service is constructed with dependencies, not passed per-call
class ChatService {
  constructor(
    private toolRegistry: ToolRegistry,
    private toolContext: MakeoverToolContext
  ) {}

  // Returns the full updated conversation history (not a single message)
  // Uses this.toolContext.getSogniClient() internally for LLM calls.
  // Falls back to backend proxy if client is null (demo mode).
  async sendMessage(
    userMessage: string,
    conversationHistory: ChatMessage[],
    photoAnalysis: PhotoAnalysis,
    callbacks: ChatStreamCallbacks
  ): Promise<ChatMessage[]>;
}
```

The service owns the tool calling loop internally: it consumes the SDK's async iterable `ChatStream`, checks for `tool_calls` on the final result, executes them via the `toolRegistry`, appends tool results to the conversation, and calls `create()` again — up to 3 rounds. Callbacks notify the UI at each stage. This matches sogni-chat's proven pattern.

## 3. Transformation Service

**File**: `src/services/transformationService.ts`

Replaces the static 3207-line `transformations.ts`. Generates personalized transformation options on demand using the LLM.

### Generation Prompt

```
Based on this client's features and what they're looking for, generate
8-12 transformation options organized into 2-4 categories.

Client: {photoAnalysis}
They want: {user intent summary, e.g. "dramatic hair changes"}

Return JSON:
{
  "categories": [
    {
      "name": "Hair Color",
      "icon": "palette emoji",
      "transformations": [
        {
          "id": "unique-id",
          "name": "Copper Auburn",
          "prompt": "Change a young woman with long dark curly hair's
           hair color to rich copper auburn with warm highlights
           while preserving facial features and identity",
          "pitch": "Your warm skin tone would make this absolutely glow",
          "intensity": 0.7,
          "negativePrompt": "deformed, distorted, bad quality, blurry",
          "icon": "fire emoji"
        }
      ]
    }
  ]
}

Rules:
- Write prompts with the actual subject description baked in (not generic
  "the person")
- Set intensity (denoising strength) appropriate to how dramatic the
  change is: subtle changes 0.5-0.6, moderate 0.6-0.75, dramatic 0.75-0.95
- Each pitch is a one-liner the stylist would say to sell the look
- Categories should be relevant to what the client asked for
- Keep negative prompts consistent: "deformed, distorted, bad quality, blurry"
```

### LLM Configuration

- **Model**: `qwen3.5-35b-a3b-gguf-q4km`
- **Temperature**: 0.8 (creative suggestions)
- **Max tokens**: 1500
- **Streaming**: true
- **Token type**: spark

### Interface

```typescript
interface GeneratedTransformation {
  id: string;
  name: string;
  prompt: string;
  pitch: string;
  intensity: number;
  negativePrompt: string;
  icon: string;
}

interface GeneratedCategory {
  name: string;
  icon: string;
  transformations: GeneratedTransformation[];
}

function generateTransformations(
  photoAnalysis: PhotoAnalysis,
  intent: string,
  count?: number,
  sogniClient?: SogniClient | null
): Promise<GeneratedCategory[]>
```

### JSON Parsing Robustness

LLMs frequently wrap JSON in markdown code fences (`` ```json ... ``` ``). The service must:
- Strip markdown code fence wrappers before parsing
- Handle partial/malformed JSON gracefully (retry once with a "please return valid JSON" nudge)
- Validate required fields (`name`, `prompt`, `intensity`) and fill defaults for missing optional fields
- Return a sensible fallback set of generic transformations if parsing fails entirely

### Compatibility

The `GeneratedTransformation` interface is consumed by `generateFromPrompt()` in `MakeoverToolContext` (see Section 4), which constructs a synthetic `Transformation` object with `category: 'ai-generated'` and `subcategory: 'chat'` to feed the existing `generateMakeover` pipeline.

## 4. Tool Registry & Tools

**File**: `src/services/toolRegistry.ts`
**Directory**: `src/tools/`

Each tool is a self-contained module: `definition.ts` (OpenAI-format JSON schema) + `handler.ts` (execution function). Registered in a singleton registry.

### 6 Tools

#### `generate_makeover`
The core tool. Takes a prompt + optional intensity, runs image edit via the existing `generateMakeover` pipeline in AppContext.

```typescript
// definition
{
  name: "generate_makeover",
  description: "Generate a makeover transformation on the client's photo",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "The transformation prompt" },
      intensity: { type: "number", description: "Denoising strength 0.3-0.95" },
      negativePrompt: { type: "string" }
    },
    required: ["prompt"]
  }
}

// handler
Args: { prompt: string, intensity?: number, negativePrompt?: string }
Returns: { resultUrl: string, projectId: string }
Timeout: 2 minutes
```

#### `analyze_result`
Sends the generated result image to the vision model. The AI comments on how it came out and suggests refinements.

```typescript
// definition
{
  name: "analyze_result",
  description: "Analyze a generated makeover result and provide feedback",
  parameters: {
    type: "object",
    properties: {
      resultIndex: { type: "number", description: "Index in edit stack, defaults to latest" }
    }
  }
}

// handler
Args: { resultIndex?: number }
Returns: { analysis: string, suggestions: string[] }
Timeout: 30 seconds
```

#### `compare_before_after`
Vision model receives both original and result images for side-by-side assessment.

```typescript
// definition
{
  name: "compare_before_after",
  description: "Compare original photo with a makeover result",
  parameters: {
    type: "object",
    properties: {
      resultIndex: { type: "number" }
    }
  }
}

// handler
Args: { resultIndex?: number }
Returns: { comparison: string }
Timeout: 30 seconds
```

#### `adjust_intensity`
Re-runs the last transformation with a different denoising strength.

```typescript
// definition
{
  name: "adjust_intensity",
  description: "Re-run the last transformation with different intensity",
  parameters: {
    type: "object",
    properties: {
      intensity: { type: "number", description: "New denoising strength 0.3-0.95" }
    },
    required: ["intensity"]
  }
}

// handler
Args: { intensity: number }
Returns: { resultUrl: string, projectId: string }
Timeout: 2 minutes
```

#### `stack_transformation`
Applies a new edit on top of the current result using the existing edit stack system.

```typescript
// definition
{
  name: "stack_transformation",
  description: "Apply an additional transformation on top of the current result",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      intensity: { type: "number" }
    },
    required: ["prompt"]
  }
}

// handler
Args: { prompt: string, intensity?: number }
Returns: { resultUrl: string, projectId: string, stackDepth: number }
Timeout: 2 minutes
```

#### `generate_transformations`
Calls the transformation service to produce a new batch of grid options.

```typescript
// definition
{
  name: "generate_transformations",
  description: "Generate personalized transformation options for the grid",
  parameters: {
    type: "object",
    properties: {
      intent: { type: "string", description: "What the client is looking for" },
      count: { type: "number", description: "Number of options, default 8-12" }
    },
    required: ["intent"]
  }
}

// handler
Args: { intent: string, count?: number }
Returns: { categories: GeneratedCategory[] }
Timeout: 30 seconds
```

### MakeoverToolContext

Tool handlers need access to React state and functions from AppContext. A `MakeoverToolContext` interface is passed to every handler at execution time, decoupling tools from React context directly.

```typescript
interface MakeoverToolContext {
  // Generation — accepts simplified params, not full Transformation
  generateFromPrompt: (params: {
    prompt: string;
    intensity?: number;
    negativePrompt?: string;
    useStackedInput?: boolean;  // true = apply on top of current result
  }) => Promise<{ resultUrl: string; projectId: string }>;

  // State accessors
  getOriginalImageBase64: () => string | null;
  getOriginalImageUrl: () => string | null;
  getCurrentResultUrl: () => string | null;
  getEditStack: () => EditStep[];
  getEditStackDepth: () => number;
  isGenerating: () => boolean;

  // Vision analysis (for analyze_result, compare_before_after)
  analyzeImage: (imageUrl: string, systemPrompt: string) => Promise<string>;

  // Sogni client (for LLM calls in generate_transformations)
  getSogniClient: () => SogniClient | null;

  // Photo analysis (for generate_transformations)
  getPhotoAnalysis: () => PhotoAnalysis;
}
```

`generateFromPrompt` is a new wrapper added to AppContext that constructs a synthetic `Transformation` object internally (with `category: 'ai-generated'` and `subcategory: 'chat'`) and calls the existing `generateMakeover` pipeline. This avoids refactoring `generateMakeover` while giving tools a clean interface.

**Note**: `'ai-generated'` must be added to the `TransformationCategory` union in `src/types/index.ts`.

The `useChat` hook creates a `MakeoverToolContext` from AppContext values and passes it to the `ChatService` constructor, which passes it through to the registry on each `execute()` call.

### Registry

```typescript
class ToolRegistry {
  private tools: Map<string, { definition: ToolDefinition, handler: ToolHandler }>;

  register(name: string, definition: ToolDefinition, handler: ToolHandler): void;
  getDefinitions(): ToolDefinition[];
  execute(
    name: string,
    args: Record<string, unknown>,
    context: MakeoverToolContext
  ): Promise<ToolResult>;
}
```

## 5. Chat UI Components

**Directory**: `src/components/chat/`

### ChatPanel

Slide-out or docked panel alongside the studio layout. Right side on desktop, bottom sheet on mobile. Collapsible.

- Auto-opens after photo upload with the AI's greeting
- Message list with auto-scroll
- Shows streaming tokens with typing indicator
- Tool progress indicators (progress bar during generation)
- Inline result thumbnails in assistant messages

### ChatMessage

Renders individual messages:
- **User messages**: plain text, right-aligned
- **Assistant messages**: streaming text, left-aligned, with optional inline images
- **Tool progress**: progress bar overlay during tool execution
- **Suggestion chips**: clickable quick-reply buttons after tool completion

### ChatInput

- Auto-growing textarea
- Send button (+ Enter to send)
- Disabled during streaming/tool execution

### SuggestionChips

Clickable quick-reply buttons the AI surfaces after results:
- "Go bolder"
- "Try makeup instead"
- "Stack another edit"
- "Show me something totally different"

Rendered below the latest assistant message.

## 6. Grid Integration

The existing `TransformationPicker` and `CategoryNav` components are adapted to render AI-generated content instead of static imports.

### CategoryNav Changes

- Renders dynamic categories from `GeneratedCategory[]` instead of the hardcoded `CATEGORIES` constant
- Icons and names come from the AI
- Shows loading skeleton while AI generates options

### TransformationPicker Changes

- Renders `GeneratedTransformation[]` instead of static `Transformation[]`
- Each card shows: `name`, `icon`, and `pitch` (the stylist's one-liner)
- Clicking a card:
  1. Triggers `generateMakeover` directly (same as today)
  2. Posts a message to chat ("Try Copper Auburn") so the AI stays in context

### Loading State

While AI generates initial transformations:
- Grid shows skeleton/shimmer cards
- Message: "Your stylist is curating looks..."

### Result Flow

When a makeover completes (from chat or grid):
- Result appears in the main image area (unchanged)
- AI automatically analyzes it and posts a chat comment
- New suggestion chips appear
- Grid can refresh with new options based on the result

## 7. Backend Changes

### New: `server/routes/photoAnalysis.js`

```
POST /api/photo-analysis/analyze
- Body: { imageBase64: string }
- Returns: PhotoAnalysis JSON
- Origin: *.sogni.ai only
- Calls: sogni.analyzePhotoSubject()
```

### New: `server/routes/chat.js`

```
POST /api/chat/completions
- Body: { messages: ChatMessage[], tools: ToolDefinition[] }
- Returns: SSE stream (Content-Type: text/event-stream)
- Origin: *.sogni.ai only
- Calls: sogni.chatCompletion()
```

**SSE Event Format** (modeled on the existing `/api/sogni/progress` pattern):

```
event: token
data: {"content": "Oh hello"}

event: token
data: {"content": "! *adjusts"}

event: tool_call
data: {"id": "call_123", "name": "generate_transformations", "arguments": "{\"intent\": \"dramatic hair\"}"}

event: complete
data: {"finishReason": "stop", "usage": {"promptTokens": 450, "completionTokens": 120}}

event: error
data: {"message": "Model timeout", "code": "timeout"}
```

The frontend `chatService` consumes this stream via `fetch` with `ReadableStream` (not `EventSource`, which only supports GET — the chat endpoint is POST). Tool calls received via the stream are executed client-side by the `useChat` hook, and results are sent back as a new `POST /api/chat/completions` request with the tool result appended to the messages array.

**Note**: For demo users, the tool calling loop happens client-side across multiple SSE requests (LLM call → tool_call event → client executes tool → new request with tool result). This is less efficient than the authenticated path where the chat service can run the full loop in one call, but keeps the backend stateless.

### Updates to `server/services/sogni.js`

Two new functions using the existing global Sogni client:

```javascript
async function analyzePhotoSubject(imageBase64DataUri) {
  const client = await getOrCreateGlobalSogniClient();
  // Vision analysis with system prompt, streaming, spark tokens
}

async function chatCompletion(messages, tools) {
  const client = await getOrCreateGlobalSogniClient();
  // Chat completion with tools, streaming, spark tokens
}
```

### Route Registration in `server/index.js`

```javascript
app.use('/api/photo-analysis', photoAnalysisRoutes);
app.use('/api/chat', chatRoutes);
```

## 8. Removals & Migrations

### Removed

| File | Lines | Reason |
|------|-------|--------|
| `src/constants/transformations.ts` | 3207 | Replaced by AI-generated transformations |
| Gender selection step in `LandingHero.tsx` | ~100 | AI infers from photo, confirms in chat if unsure |
| Static `CATEGORIES` constant | ~50 | Replaced by dynamic categories |
| Gender-based filtering in `CategoryNav`, `TransformationPicker` | ~30 | No longer needed — AI generates gender-appropriate options |

**Quality tier selection**: The current onboarding flow is `gender → quality → capture`. With gender removed, the flow becomes `quality → capture`. The quality tier step (Lightning vs Standard model) is preserved — it moves to be the first/only onboarding step. Alternatively, it can be surfaced in Settings or as part of the chat ("Want speed or detail? Lightning is fast, Standard is pristine."). Implementation plan should decide.

**`selectedGender` in AppContext**: Remains as an optional field but is populated by the AI's photo analysis (`perceivedGender`) instead of user selection. Components that previously read `selectedGender` to filter transformations no longer need it since the AI generates gender-appropriate options directly.

### Modified

| File | Change |
|------|--------|
| `AppContext.tsx` | `generateMakeover` accepts AI-generated transformations; exposes hooks for tool handlers |
| `TransformationPicker.tsx` | New data source (AI-generated), shows `pitch` field |
| `CategoryNav.tsx` | Dynamic categories instead of static |
| `MakeoverStudio.tsx` | Adds ChatPanel alongside existing layout |
| `src/services/api.ts` | Adds `analyzePhoto()` and `chatCompletion()` |
| `src/types/index.ts` | Add `'ai-generated'` to `TransformationCategory` union |
| `src/services/frontendSogniAdapter.ts` | Adds `getChatClient(): SogniClient` method that exposes the underlying raw SDK client for direct `chat.completions.create()` calls. The adapter's project-event normalization is not needed for chat — we pass through the raw client. This matches how sogni-photobooth accesses the chat API. |

### Kept As-Is

- Edit stack system (`useEditStack`)
- Generation progress UI (`GenerationProgress`)
- Before/after comparison (`BeforeAfterSlider`)
- Result display
- Auth system
- All backend generation logic
- Settings (model selection, etc.)
- Demo mode limits
- Share actions

## 9. New Files Summary

### Frontend Services
- `src/services/photoAnalysisService.ts`
- `src/services/chatService.ts`
- `src/services/transformationService.ts`
- `src/services/toolRegistry.ts`

### Tools
- `src/tools/generate-makeover/definition.ts`
- `src/tools/generate-makeover/handler.ts`
- `src/tools/analyze-result/definition.ts`
- `src/tools/analyze-result/handler.ts`
- `src/tools/compare-before-after/definition.ts`
- `src/tools/compare-before-after/handler.ts`
- `src/tools/adjust-intensity/definition.ts`
- `src/tools/adjust-intensity/handler.ts`
- `src/tools/stack-transformation/definition.ts`
- `src/tools/stack-transformation/handler.ts`
- `src/tools/generate-transformations/definition.ts`
- `src/tools/generate-transformations/handler.ts`

### Chat UI
- `src/components/chat/ChatPanel.tsx`
- `src/components/chat/ChatMessage.tsx`
- `src/components/chat/ChatInput.tsx`
- `src/components/chat/SuggestionChips.tsx`

### Hooks
- `src/hooks/useChat.ts`

### `useChat` Hook Interface

```typescript
interface UseChatReturn {
  // State
  messages: ChatMessage[];
  isStreaming: boolean;
  isChatOpen: boolean;
  currentToolProgress: ToolProgress | null;
  generatedCategories: GeneratedCategory[];

  // Actions
  sendMessage: (text: string) => Promise<void>;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;

  // Called by grid when user clicks a transformation card
  notifyTransformationSelected: (transformation: GeneratedTransformation) => void;

  // Called by AppContext when a generation completes (from any source)
  notifyGenerationComplete: (resultUrl: string) => void;

  // Initialize with photo analysis (triggers AI greeting)
  initWithPhoto: (photoAnalysis: PhotoAnalysis) => Promise<void>;
}
```

The hook creates a `ChatService` and `MakeoverToolContext` from AppContext values. It manages the message array, streaming state, and bridges between chat and grid interactions. Lives alongside AppContext — not inside it — to keep concerns separated.

### Backend
- `server/routes/photoAnalysis.js`
- `server/routes/chat.js`

### Types
- `src/types/chat.ts`

## 10. User Flow

1. User lands on app, uploads/captures photo
2. Photo analysis fires immediately in background
3. Chat panel auto-opens with AI greeting:
   > "Oh hello! *adjusts glasses* Now THAT is a face I can work with. Those cheekbones? Criminal. And that hair has so much potential... I'm already seeing possibilities. So tell me — what are we doing today? Something subtle and polished, or are we going full glow-up?"
4. User responds: "I want to try some dramatic hair changes"
5. AI calls `generate_transformations` with intent "dramatic hair changes"
6. Grid populates with personalized options (Copper Auburn, Platinum Pixie, etc.) each with a stylist pitch
7. User clicks "Copper Auburn" card (or asks in chat)
8. `generate_makeover` runs, progress shows in main area
9. Result appears, AI auto-analyzes:
   > "YES. Oh that copper is absolutely singing against your skin tone. Want to push it even warmer, or should we stack some bold eye makeup on top? I'm thinking a smoky gold eye would tie this whole look together."
10. User: "Stack the eye makeup"
11. AI calls `stack_transformation`, applies on top of hair result
12. Cycle continues until user is satisfied
