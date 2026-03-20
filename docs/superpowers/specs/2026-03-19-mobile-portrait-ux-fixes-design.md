# Mobile Portrait UX Fixes

**Date:** 2026-03-19
**Status:** Approved

## Problem

Four usability issues on mobile portrait (iPhone):

1. **Camera view too tall** - The 2:3 camera preview + header + sample photos push the shutter button below the fold, requiring scroll.
2. **Chat panel full-screen takeover** - On mobile, the chat covers 100% of the viewport with `position: fixed; inset: 0`, making it feel like a page change rather than an overlay.
3. **No new message indicator** - When the chat is closed and new messages arrive, there's no visual cue to prompt the user to open it.
4. **Chat links don't work on mobile** - Clicking `[category:Name]` or `[option:Name]` links updates studio state, but the full-screen chat obscures the change.

## Design

### Fix 1: Camera View Height Constraint

**Files:** `PhotoCapture.tsx`, `CameraView.tsx`

- When camera tab is active and streaming/captured, hide the "Begin Your Transformation" header, subtitle, and sample photos section on mobile to reclaim vertical space.
- Add `max-h-[50dvh]` to the camera preview container on mobile so the video + shutter button always fit within the viewport.
- Use a `hasCameraContent` state or pass the active tab + camera state to conditionally hide elements.

**Approach:** In `PhotoCapture.tsx`, pass `activeTab` context so that when `activeTab === 'camera'`, the header and `<SamplePhotos />` are hidden on small screens. In `CameraView.tsx`, add a mobile max-height constraint to the preview container.

### Fix 2: Chat Bottom Sheet on Mobile

**Files:** `ChatPanel.tsx`, `studio.css`

- Replace the full-screen overlay with a bottom sheet: `position: fixed; bottom: 0; left: 0; right: 0; height: 75dvh; border-radius: 16px 16px 0 0;`.
- Add a drag handle bar at the top of the sheet (small rounded pill, visual affordance only -- no drag-to-dismiss needed).
- Keep the existing close button (X) for dismissal.
- Add a semi-transparent backdrop behind the sheet so the user sees the app is still there.
- Desktop behavior unchanged (right sidebar, 320px wide).

**Animation:** Slide up from bottom using Framer Motion (`initial={{ y: '100%' }}`, `animate={{ y: 0 }}`).

### Fix 3: Unread Message Indicator

**Files:** `useChat.ts`, `MakeoverStudio.tsx`

- Track `unreadCount` in `useChat`: increment when a new assistant message is added while `isChatOpen` is false; reset to 0 when chat opens.
- Expose `unreadCount` from the hook.
- In `MakeoverStudio.tsx`, render a pulsing dot badge on the chat toggle button when `unreadCount > 0`.

### Fix 4: Chat Links Close Chat on Mobile

**Files:** `ChatPanel.tsx`, `ChatMessage.tsx`

- Pass `onClose` into `ChatMessage` (or wrap the category/transformation callbacks).
- When a `[category:Name]` or `[option:Name]` link is clicked, call the existing handler AND then call `onClose()` on mobile (check `window.innerWidth <= 768`).
- This lets the user see the studio update immediately.
