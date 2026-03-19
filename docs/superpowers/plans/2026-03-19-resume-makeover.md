# Resume Makeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to resume a makeover session after closing the browser, restoring original image, edit stack, chat history, and generated categories from IndexedDB.

**Architecture:** A new IndexedDB helper (`makeoverSessionDb.ts`) persists session state after each completed generation. AppContext gains `resumeSession()` and `restoreOriginalImage()` methods. `useChat` and `useEditStack` gain restore methods. The landing page checks for a saved session and shows a "Resume Makeover" button. ChatPanel renders messages with scroll-based pagination.

**Tech Stack:** React 18, TypeScript, IndexedDB (native API), Vite

**Spec:** `docs/superpowers/specs/2026-03-19-resume-makeover-design.md`

---

### Task 1: IndexedDB Session Storage Module

**Files:**
- Create: `src/utils/makeoverSessionDb.ts`
- Reference: `src/utils/cookies.ts` (existing storage patterns)
- Reference: `src/types/index.ts:63-70` (EditStep, EditMode types)
- Reference: `src/types/chat.ts:1-83` (ChatMessage, PhotoAnalysis, GeneratedCategory types)

This module provides all IndexedDB operations for session persistence. It stores a single session record that gets overwritten at each save point.

- [ ] **Step 1: Create the IndexedDB helper module**

```typescript
// src/utils/makeoverSessionDb.ts
import type { EditStep, EditMode, Gender } from '@/types';
import type { ChatMessage, PhotoAnalysis, GeneratedCategory } from '@/types/chat';

const DB_NAME = 'sogni-makeover-db';
const DB_VERSION = 1;
const STORE_NAME = 'session';
const SESSION_KEY = 'active';

export interface PersistedSession {
  version: number;
  originalImageBase64: string;
  editStack: {
    steps: EditStep[];
    currentIndex: number;
    mode: EditMode;
  };
  chatMessages: ChatMessage[];
  photoAnalysis: PhotoAnalysis | null;
  generatedCategories: GeneratedCategory[];
  selectedGender: Gender | null;
  timestamp: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSession(data: PersistedSession): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, SESSION_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[makeoverSessionDb] Failed to save session:', e);
  }
}

export async function loadSession(): Promise<PersistedSession | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(SESSION_KEY);
    const result = await new Promise<PersistedSession | null>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (result && result.version !== 1) return null;
    return result;
  } catch (e) {
    console.warn('[makeoverSessionDb] Failed to load session:', e);
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(SESSION_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[makeoverSessionDb] Failed to clear session:', e);
  }
}

export async function hasSession(): Promise<boolean> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).count();
    const count = await new Promise<number>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return count > 0;
  } catch (e) {
    console.warn('[makeoverSessionDb] Failed to check session:', e);
    return false;
  }
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `cd /Users/markledford/Documents/git/sogni-makeover && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `makeoverSessionDb.ts`

- [ ] **Step 3: Commit**

```bash
git add src/utils/makeoverSessionDb.ts
git commit -m "feat(resume): add IndexedDB session storage module"
```

---

### Task 2: Add `restore` action to useEditStack

**Files:**
- Modify: `src/hooks/useEditStack.ts`

Add a `restore` action to the edit stack reducer that hydrates the full state from persisted data.

- [ ] **Step 1: Add the restore action type and reducer case**

In `src/hooks/useEditStack.ts`, add to the `EditStackAction` union type (after the `reset` line):

```typescript
  | { type: 'restore'; steps: EditStep[]; currentIndex: number; mode: EditMode };
```

Add the reducer case in `editStackReducer` (before the `default` case):

```typescript
    case 'restore':
      return {
        steps: action.steps,
        currentIndex: action.currentIndex,
        mode: action.mode,
      };
```

- [ ] **Step 2: Expose the restore method from the hook**

Add to the `UseEditStackReturn` interface:

```typescript
  restore: (state: { steps: EditStep[]; currentIndex: number; mode: EditMode }) => void;
```

Add the callback in the `useEditStack` function body (after `reset`):

```typescript
  const restore = useCallback(
    (state: { steps: EditStep[]; currentIndex: number; mode: EditMode }) =>
      dispatch({ type: 'restore', ...state }),
    [],
  );
```

Add `restore` to the return object.

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/markledford/Documents/git/sogni-makeover && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useEditStack.ts
git commit -m "feat(resume): add restore action to useEditStack"
```

---

### Task 3: Add restore methods to useChat

**Files:**
- Modify: `src/hooks/useChat.ts`

Add `restoreSession()` method that restores messages, photo analysis, generated categories, and opens the chat — without triggering `initWithPhoto`.

- [ ] **Step 1: Add the restore method and expose it**

Add to `UseChatReturn` interface (after `initWithPhoto`):

```typescript
  restoreSession: (data: {
    messages: ChatMessage[];
    photoAnalysis: PhotoAnalysis | null;
    generatedCategories: GeneratedCategory[];
  }) => void;
```

Add the implementation in the `useChat` function body (after `initWithPhoto`):

```typescript
  const restoreSession = useCallback((data: {
    messages: ChatMessage[];
    photoAnalysis: PhotoAnalysis | null;
    generatedCategories: GeneratedCategory[];
  }) => {
    setMessages(data.messages);
    if (data.photoAnalysis) {
      photoAnalysisRef.current = data.photoAnalysis;
      setPhotoAnalysis(data.photoAnalysis);
    }
    setGeneratedCategories(data.generatedCategories);
    setIsChatOpen(true);
  }, []);
```

Add `restoreSession` to the return object.

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/markledford/Documents/git/sogni-makeover && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useChat.ts
git commit -m "feat(resume): add restoreSession method to useChat"
```

---

### Task 4: Add session persistence and resume to AppContext

**Files:**
- Modify: `src/context/AppContext.tsx`
- Reference: `src/utils/makeoverSessionDb.ts`

Add `resumeSession()` and `restoreOriginalImage()` methods to AppContext. Add save-point logic after each generation. Clear session on `resetPhoto()`.

- [ ] **Step 1: Add imports and new context fields**

Add import at top of `src/context/AppContext.tsx`:

```typescript
import {
  saveSession as saveSessionToDb,
  loadSession as loadSessionFromDb,
  clearSession as clearSessionFromDb,
} from '@/utils/makeoverSessionDb';
import type { PersistedSession } from '@/utils/makeoverSessionDb';
```

Add to `AppContextValue` interface (after `resetSettings`):

```typescript
  // Session resume
  resumeSession: () => Promise<boolean>;
  isResumedSession: boolean;
```

- [ ] **Step 2: Add state and implement restoreOriginalImage**

Add state in `AppProvider` (after the `editStack` line):

```typescript
  // -- Session resume --
  const [isResumedSession, setIsResumedSession] = useState(false);
```

Add `restoreOriginalImage` function (after `setOriginalImage`):

```typescript
  const restoreOriginalImage = useCallback((base64: string) => {
    // Convert base64 to blob URL without the wasteful File->base64 round-trip
    const byteString = atob(base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: 'image/jpeg' });
    const file = new File([blob], 'restored-photo.jpg', { type: 'image/jpeg' });

    setOriginalImageRaw(file);
    setOriginalImageUrl(URL.createObjectURL(blob));
    setOriginalImageBase64(base64);
  }, []);
```

- [ ] **Step 3: Add resumeSession method**

Add after `restoreOriginalImage`:

```typescript
  const resumeSession = useCallback(async (): Promise<boolean> => {
    const session = await loadSessionFromDb();
    if (!session) return false;

    // Restore original image
    restoreOriginalImage(session.originalImageBase64);

    // Restore edit stack
    editStack.restore(session.editStack);

    // Restore gender
    if (session.selectedGender) {
      setSelectedGenderRaw(session.selectedGender);
    }

    // Mark as resumed (MakeoverStudio will use this to skip initWithPhoto)
    setIsResumedSession(true);

    // Navigate to studio
    setCurrentView('studio');

    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restoreOriginalImage and editStack.restore are stable callbacks
  }, []);
```

- [ ] **Step 4: Add saveSessionToDb call at save points**

The save point happens after `editStack.pushStep()` and `fetchImageAsBase64()` completes. There are two places this occurs in `generateMakeover`:

**Path A (frontend SDK, around line 694):** Replace the `.then` chain:

```typescript
          fetchImageAsBase64(resultImageUrl).then(base64 => {
            editStack.updateLatestBase64(base64);
          }).catch(() => {
            // Non-critical — will be fetched on-demand if needed
          });
```

with:

```typescript
          fetchImageAsBase64(resultImageUrl).then(base64 => {
            editStack.updateLatestBase64(base64);
            // Save point: persist session after base64 is ready
            saveSessionRef.current?.();
          }).catch(() => {
            // Non-critical — will be fetched on-demand if needed
          });
```

**Path B (SSE/demo, around line 912):** Apply the same change to the second `fetchImageAsBase64` call.

Add a `saveSessionRef` that MakeoverStudio will set (since MakeoverStudio has access to chat state that AppContext doesn't):

In AppContext interface, add:

```typescript
  saveSessionRef: React.MutableRefObject<(() => void) | null>;
```

In AppProvider, add:

```typescript
  const saveSessionRef = useRef<(() => void) | null>(null);
```

- [ ] **Step 5: Clear session on resetPhoto**

In `resetPhoto` (around line 327), add before `setCurrentView('capture')`:

```typescript
    clearSessionFromDb();
    setIsResumedSession(false);
```

- [ ] **Step 6: Add new fields to context value**

Add to the context value object returned by `AppProvider`:

```typescript
    resumeSession,
    isResumedSession,
    saveSessionRef,
```

- [ ] **Step 7: Verify it compiles**

Run: `cd /Users/markledford/Documents/git/sogni-makeover && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/context/AppContext.tsx
git commit -m "feat(resume): add session persistence and resume to AppContext"
```

---

### Task 5: Wire up save points and resume in MakeoverStudio

**Files:**
- Modify: `src/components/studio/MakeoverStudio.tsx`
- Reference: `src/utils/makeoverSessionDb.ts`

MakeoverStudio needs to:
1. Set the `saveSessionRef` callback so AppContext can trigger saves
2. Skip `initWithPhoto` on resumed sessions
3. Restore chat state on resume

- [ ] **Step 1: Add save session wiring**

Add import:

```typescript
import { saveSession } from '@/utils/makeoverSessionDb';
```

Add `isResumedSession` and `saveSessionRef` to the destructured `useApp()` call:

```typescript
    isResumedSession,
    saveSessionRef,
```

Add `selectedGender` to the destructured `useApp()` call (it's needed for the save payload).

After the `chat` hook initialization, add the save session ref wiring:

```typescript
  // Wire up save session callback for AppContext to trigger after base64 fetch
  useEffect(() => {
    saveSessionRef.current = () => {
      if (!originalImageBase64) return;
      saveSession({
        version: 1,
        originalImageBase64,
        editStack: {
          steps: editStackRef.current.steps,
          currentIndex: editStackRef.current.currentIndex,
          mode: editStackRef.current.mode,
        },
        chatMessages: chat.messages,
        photoAnalysis: chat.photoAnalysis,
        generatedCategories: chat.generatedCategories,
        selectedGender: selectedGender,
        timestamp: Date.now(),
      });
    };
    return () => { saveSessionRef.current = null; };
  }, [originalImageBase64, selectedGender]); // eslint-disable-line react-hooks/exhaustive-deps
```

Note: We intentionally exclude `chat.messages`, `chat.photoAnalysis`, `chat.generatedCategories` from deps — the callback reads current values via closure at call time. The refs (`editStackRef`) ensure fresh edit stack state.

Wait — `chat.messages` won't be fresh in the closure if it was captured at effect time. We need to use refs for chat state too:

```typescript
  const chatMessagesRef = useRef(chat.messages);
  chatMessagesRef.current = chat.messages;
  const chatPhotoAnalysisRef = useRef(chat.photoAnalysis);
  chatPhotoAnalysisRef.current = chat.photoAnalysis;
  const chatGeneratedCategoriesRef = useRef(chat.generatedCategories);
  chatGeneratedCategoriesRef.current = chat.generatedCategories;
  const selectedGenderRef = useRef(selectedGender);
  selectedGenderRef.current = selectedGender;

  useEffect(() => {
    saveSessionRef.current = () => {
      if (!originalImageBase64) return;
      saveSession({
        version: 1,
        originalImageBase64,
        editStack: {
          steps: editStackRef.current.steps,
          currentIndex: editStackRef.current.currentIndex,
          mode: editStackRef.current.mode,
        },
        chatMessages: chatMessagesRef.current,
        photoAnalysis: chatPhotoAnalysisRef.current,
        generatedCategories: chatGeneratedCategoriesRef.current,
        selectedGender: selectedGenderRef.current,
        timestamp: Date.now(),
      });
    };
    return () => { saveSessionRef.current = null; };
  }, [originalImageBase64]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2: Skip initWithPhoto on resume and restore chat state**

Modify the `initTriggered` effect (around line 78-84). Replace:

```typescript
  const initTriggered = useRef(false);
  useEffect(() => {
    if (originalImageUrl && !initTriggered.current) {
      initTriggered.current = true;
      chat.initWithPhoto(originalImageUrl);
    }
  }, [originalImageUrl]); // eslint-disable-line react-hooks/exhaustive-deps
```

With:

```typescript
  const initTriggered = useRef(false);
  useEffect(() => {
    if (originalImageUrl && !initTriggered.current) {
      initTriggered.current = true;
      if (isResumedSession) {
        // Session was restored — chat state is already loaded via resumeSession flow
        // No need to run initWithPhoto (which would trigger photo analysis + AI greeting)
        return;
      }
      chat.initWithPhoto(originalImageUrl);
    }
  }, [originalImageUrl]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/markledford/Documents/git/sogni-makeover && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/studio/MakeoverStudio.tsx
git commit -m "feat(resume): wire up save points and resume skip in MakeoverStudio"
```

---

### Task 6: Restore chat state from AppContext.resumeSession

**Files:**
- Modify: `src/context/AppContext.tsx`

The `resumeSession` method needs to return the chat/category data so MakeoverStudio can pass it to `chat.restoreSession()`. However, since `useChat` is initialized in MakeoverStudio (not AppContext), we need a different approach: store the persisted chat data in state so MakeoverStudio can read it after navigating to studio.

- [ ] **Step 1: Add persisted session data state**

In AppContext interface, add:

```typescript
  pendingResumeData: {
    chatMessages: import('@/types/chat').ChatMessage[];
    photoAnalysis: import('@/types/chat').PhotoAnalysis | null;
    generatedCategories: import('@/types/chat').GeneratedCategory[];
  } | null;
  clearPendingResumeData: () => void;
```

In AppProvider, add state:

```typescript
  const [pendingResumeData, setPendingResumeData] = useState<{
    chatMessages: ChatMessage[];
    photoAnalysis: PhotoAnalysis | null;
    generatedCategories: GeneratedCategory[];
  } | null>(null);

  const clearPendingResumeData = useCallback(() => setPendingResumeData(null), []);
```

Add the import for ChatMessage, PhotoAnalysis, GeneratedCategory at the top:

```typescript
import type { ChatMessage, PhotoAnalysis, GeneratedCategory } from '@/types/chat';
```

- [ ] **Step 2: Update resumeSession to store chat data**

In `resumeSession`, add before `setCurrentView('studio')`:

```typescript
    // Store chat data for MakeoverStudio to restore after mounting
    setPendingResumeData({
      chatMessages: session.chatMessages,
      photoAnalysis: session.photoAnalysis,
      generatedCategories: session.generatedCategories,
    });
```

- [ ] **Step 3: Add to context value**

Add `pendingResumeData` and `clearPendingResumeData` to the context value object.

- [ ] **Step 4: Consume in MakeoverStudio**

In MakeoverStudio, destructure `pendingResumeData` and `clearPendingResumeData` from `useApp()`.

Add an effect after the `initTriggered` effect:

```typescript
  // Restore chat state from persisted session data
  useEffect(() => {
    if (isResumedSession && pendingResumeData) {
      chat.restoreSession(pendingResumeData);
      clearPendingResumeData();
    }
  }, [isResumedSession, pendingResumeData]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 5: Verify it compiles**

Run: `cd /Users/markledford/Documents/git/sogni-makeover && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/context/AppContext.tsx src/components/studio/MakeoverStudio.tsx
git commit -m "feat(resume): restore chat state via pendingResumeData"
```

---

### Task 7: Add "Resume Makeover" button to LandingHero

**Files:**
- Modify: `src/components/landing/LandingHero.tsx`
- Reference: `src/utils/makeoverSessionDb.ts`

- [ ] **Step 1: Add session check and resume button**

Add imports:

```typescript
import { hasSession } from '@/utils/makeoverSessionDb';
```

Add `resumeSession` to the destructured `useApp()` call in the component.

Add state for tracking whether a saved session exists:

```typescript
  const [hasSavedSession, setHasSavedSession] = useState(false);

  useEffect(() => {
    hasSession().then(setHasSavedSession);
  }, []);
```

In the `step === 'idle'` branch (around line 285), after the "Start Your Makeover" `<Button>`, add the resume button:

```typescript
                  {hasSavedSession && (
                    <Button
                      variant="secondary"
                      size="lg"
                      onClick={() => resumeSession()}
                      className="text-lg"
                    >
                      Resume Makeover
                    </Button>
                  )}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/markledford/Documents/git/sogni-makeover && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/LandingHero.tsx
git commit -m "feat(resume): add Resume Makeover button to landing page"
```

---

### Task 8: Add chat pagination to ChatPanel

**Files:**
- Modify: `src/components/chat/ChatPanel.tsx`

Render only the last 20 visible messages initially. When user scrolls to top, load more.

- [ ] **Step 1: Add pagination state and scroll handler**

Add `useState, useCallback` to the existing React import.

Add pagination state and logic inside `ChatPanel`:

```typescript
  const PAGE_SIZE = 20;
  const visibleMessages = messages.filter((m) => m.role !== 'tool' && m.role !== 'system');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Reset visible count when messages change significantly (e.g., new session)
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [messages.length > 0 ? messages[0]?.id : null]); // Reset when first message changes (new session)

  const paginatedMessages = visibleMessages.slice(
    Math.max(0, visibleMessages.length - visibleCount),
  );
  const hasMore = visibleCount < visibleMessages.length;

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el || !hasMore) return;
    // Load more when scrolled near the top (within 50px)
    if (el.scrollTop < 50) {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, visibleMessages.length));
    }
  }, [hasMore, visibleMessages.length]);
```

- [ ] **Step 2: Update the messages rendering section**

Replace the messages `<div>` (the one with `className="relative z-10 flex-1 overflow-y-auto px-3 py-3"`):

```typescript
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="relative z-10 flex-1 overflow-y-auto px-3 py-3"
          >
            <div className="flex flex-col gap-3">
              {hasMore && (
                <button
                  onClick={() => setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, visibleMessages.length))}
                  className="self-center rounded-full bg-white/5 px-3 py-1 text-[10px] text-white/40 transition-colors hover:bg-white/10 hover:text-white/60"
                >
                  Load earlier messages
                </button>
              )}
              {paginatedMessages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    toolProgress={
                      message.isStreaming ? currentToolProgress : null
                    }
                    onSelectCategory={onSelectCategory}
                    onSelectTransformation={onHighlightTransformation}
                  />
                ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
```

Remove the old `messagesEndRef` scroll effect's dependency on `messages.length` — it still works since new messages change `paginatedMessages.length`.

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/markledford/Documents/git/sogni-makeover && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ChatPanel.tsx
git commit -m "feat(resume): add scroll-based chat pagination"
```

---

### Task 9: Lint and validate

**Files:**
- All modified files

- [ ] **Step 1: Run ESLint**

Run: `cd /Users/markledford/Documents/git/sogni-makeover && npm run lint 2>&1 | tail -30`
Expected: 0 warnings, 0 errors

- [ ] **Step 2: Run useEffect validation**

Run: `cd /Users/markledford/Documents/git/sogni-makeover && npm run validate:useeffect 2>&1`
Expected: Pass

- [ ] **Step 3: Run build**

Run: `cd /Users/markledford/Documents/git/sogni-makeover && npm run build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 4: Fix any issues found and commit**

```bash
git add -A
git commit -m "fix(resume): lint and validation fixes"
```
