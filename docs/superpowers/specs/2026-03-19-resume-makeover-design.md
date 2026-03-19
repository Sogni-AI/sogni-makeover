# Resume Makeover Feature Design

**Date:** 2026-03-19
**Status:** Approved

## Overview

Allow users to resume an in-progress makeover when they return to the site. When a saved session exists, a "Resume Makeover" button appears next to "Start Your Makeover" on the landing page. Clicking it restores the user to the studio with their original photo, edit stack, and full chat history intact.

## Requirements

1. Persist makeover session state across browser sessions (survives tab/browser close)
2. Resume takes user to the **studio** with:
   - Original photo restored
   - Edit stack restored with last result image loaded
   - Chat sidebar open with full conversation history
3. Chat is paginated — recent messages shown immediately, older messages lazy-loaded on scroll-up
4. "Last session wins" — starting a new makeover overwrites the saved session at the first save point
5. Save points occur after each completed generation (when `pushStep` is called with a result)

## Storage

### IndexedDB Database

- **Database name:** `sogni-makeover-db`
- **Object store:** `session`
- **Strategy:** Single active session record, overwritten at each save point. No session history.

### Persisted Data

At each save point (after completed generation), the following is written to IndexedDB:

| Field | Type | Description |
|-------|------|-------------|
| `originalImageBase64` | `string` | Base64 of the user's source photo |
| `editStack` | `object` | `{ steps: EditStep[], currentIndex: number, mode: EditMode }` — each step includes `transformation`, `resultImageBase64`, `timestamp` |
| `chatMessages` | `ChatMessage[]` | Full chat message array |
| `selectedGender` | `Gender \| null` | User's selected gender |
| `timestamp` | `number` | When the session was last saved |

### Storage Helper Module

A new module `src/utils/sessionStorage.ts` provides:

- `saveSession(data)` — write/overwrite the active session
- `loadSession()` — read the active session (returns `null` if none)
- `clearSession()` — delete the active session
- `hasSession()` — quick check if a session exists (for landing page)

All operations are async (IndexedDB is async by nature).

## Landing Page Changes

**File:** `src/components/landing/LandingHero.tsx`

When a saved session exists in IndexedDB:

- Show "Resume Makeover" button alongside "Start Your Makeover"
- "Resume Makeover" triggers the resume flow
- "Start Your Makeover" proceeds as normal — the saved session is not cleared immediately; it gets overwritten at the first save point of the new makeover

The component checks for a saved session on mount using `hasSession()`.

## Resume Flow

When "Resume Makeover" is clicked:

1. Load session data from IndexedDB via `loadSession()`
2. Reconstruct original image state:
   - Create a `File` object from the base64 data
   - Generate an object URL for display
   - Set `originalImage`, `originalImageUrl`, `originalImageBase64` in AppContext
3. Restore edit stack:
   - Populate `steps` array with persisted steps (including base64 data)
   - Restore `currentIndex` and `mode`
   - Generate object URLs for each step's `resultImageUrl`
4. Restore chat messages into `useChat` state
5. Restore selected gender
6. Set `currentView` to `'studio'`
7. Open chat sidebar

## Chat Pagination

All chat messages are loaded from IndexedDB into memory at resume time, but rendering is paginated:

- Initially render only the last ~20 messages
- When user scrolls to the top of the chat panel, prepend the next batch (~20 more)
- Simple offset-based pagination against the in-memory array
- No additional IndexedDB reads needed after initial load

## Save Points

A save point is triggered after each completed generation — specifically when `editStack.pushStep()` is called and the generation result is ready.

At a save point, the current state is serialized and written to IndexedDB:
- Original image base64
- Full edit stack (all steps with base64 data)
- Full chat message array
- Selected gender

This happens in AppContext or MakeoverStudio, wherever the post-generation logic currently runs.

## Session Lifecycle

| Action | Effect on Saved Session |
|--------|------------------------|
| Generation completes (save point) | Session saved/overwritten in IndexedDB |
| User clicks "Resume Makeover" | Session loaded, user enters studio |
| User clicks "Start Your Makeover" with existing session | No immediate effect; overwritten at first save point |
| `resetPhoto()` called | Session cleared from IndexedDB |
| User completes makeover and returns to landing | Session remains (can resume for more edits) |

## Session Cleanup

- `resetPhoto()` calls `clearSession()` to remove the saved session from IndexedDB
- No automatic expiry — the session persists until explicitly cleared or overwritten

## Key Files to Modify

| File | Changes |
|------|---------|
| `src/utils/sessionStorage.ts` | **New** — IndexedDB helper for session persistence |
| `src/components/landing/LandingHero.tsx` | Add "Resume Makeover" button, check for saved session |
| `src/context/AppContext.tsx` | Add save point logic after generation, restore session on resume, clear on resetPhoto |
| `src/hooks/useChat.ts` | Accept initial messages for resume, expose `setMessages` or `restoreMessages` |
| `src/hooks/useEditStack.ts` | Add `restore(state)` method to hydrate from persisted data |
| `src/components/chat/ChatPanel.tsx` | Add scroll-based pagination for message rendering |
| `src/components/studio/MakeoverStudio.tsx` | Wire up save points, handle resume initialization |
