import { useReducer, useCallback } from 'react';
import type { EditStep, EditMode } from '@/types';

const MAX_STACK_DEPTH = 20;

// ---------------------------------------------------------------------------
// State & Actions
// ---------------------------------------------------------------------------

interface EditStackState {
  steps: EditStep[];
  currentIndex: number; // -1 = viewing the original photo
  mode: EditMode;
}

type EditStackAction =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'goToStep'; index: number }
  | { type: 'push'; step: EditStep }
  | { type: 'updateBase64'; index: number; base64: string }
  | { type: 'updateLatestBase64'; base64: string }
  | { type: 'setMode'; mode: EditMode }
  | { type: 'reset' }
  | { type: 'restore'; steps: EditStep[]; currentIndex: number; mode: EditMode };

const initialState: EditStackState = {
  steps: [],
  currentIndex: -1,
  mode: 'stacked',
};

function editStackReducer(state: EditStackState, action: EditStackAction): EditStackState {
  switch (action.type) {
    case 'undo':
      if (state.currentIndex < 0) return state;
      return { ...state, currentIndex: state.currentIndex - 1 };

    case 'redo':
      if (state.currentIndex >= state.steps.length - 1) return state;
      return { ...state, currentIndex: state.currentIndex + 1 };

    case 'goToStep': {
      const clamped = Math.max(-1, Math.min(state.steps.length - 1, action.index));
      if (clamped === state.currentIndex) return state;
      return { ...state, currentIndex: clamped };
    }

    case 'push': {
      // Truncate any redo steps beyond current position
      const truncated = state.steps.slice(0, state.currentIndex + 1);
      let newSteps = [...truncated, action.step];
      let newIndex = newSteps.length - 1;

      // Cap at MAX_STACK_DEPTH — evict oldest
      if (newSteps.length > MAX_STACK_DEPTH) {
        newSteps = newSteps.slice(newSteps.length - MAX_STACK_DEPTH);
        newIndex = newSteps.length - 1;
      }

      return { ...state, steps: newSteps, currentIndex: newIndex };
    }

    case 'updateBase64': {
      if (action.index < 0 || action.index >= state.steps.length) return state;
      const updated = [...state.steps];
      updated[action.index] = { ...updated[action.index], resultImageBase64: action.base64 };
      return { ...state, steps: updated };
    }

    case 'updateLatestBase64': {
      // Update the step at currentIndex — safe regardless of eviction during push
      if (state.currentIndex < 0 || state.currentIndex >= state.steps.length) return state;
      const updated = [...state.steps];
      updated[state.currentIndex] = { ...updated[state.currentIndex], resultImageBase64: action.base64 };
      return { ...state, steps: updated };
    }

    case 'setMode':
      return { ...state, mode: action.mode };

    case 'reset':
      return initialState;

    case 'restore':
      return {
        steps: action.steps,
        currentIndex: action.currentIndex,
        mode: action.mode,
      };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseEditStackReturn {
  // State
  steps: EditStep[];
  currentIndex: number;
  mode: EditMode;
  currentStep: EditStep | null;
  activeImageUrl: string | null;
  canUndo: boolean;
  canRedo: boolean;
  stepCount: number;
  hasSteps: boolean;

  // Actions
  undo: () => void;
  redo: () => void;
  goToStep: (index: number) => void;
  pushStep: (step: EditStep) => void;
  updateStepBase64: (index: number, base64: string) => void;
  updateLatestBase64: (base64: string) => void;
  setMode: (mode: EditMode) => void;
  reset: () => void;
  restore: (state: { steps: EditStep[]; currentIndex: number; mode: EditMode }) => void;
}

export function useEditStack(): UseEditStackReturn {
  const [state, dispatch] = useReducer(editStackReducer, initialState);

  const { steps, currentIndex, mode } = state;
  const currentStep = currentIndex >= 0 ? steps[currentIndex] ?? null : null;
  const activeImageUrl = currentStep?.resultImageUrl ?? null;
  const canUndo = currentIndex >= 0;
  const canRedo = currentIndex < steps.length - 1;

  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const goToStep = useCallback((index: number) => dispatch({ type: 'goToStep', index }), []);
  const pushStep = useCallback((step: EditStep) => dispatch({ type: 'push', step }), []);
  const updateStepBase64 = useCallback(
    (index: number, base64: string) => dispatch({ type: 'updateBase64', index, base64 }),
    [],
  );
  const updateLatestBase64 = useCallback(
    (base64: string) => dispatch({ type: 'updateLatestBase64', base64 }),
    [],
  );
  const setMode = useCallback((mode: EditMode) => dispatch({ type: 'setMode', mode }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  const restore = useCallback(
    (state: { steps: EditStep[]; currentIndex: number; mode: EditMode }) =>
      dispatch({ type: 'restore', ...state }),
    [],
  );

  return {
    steps,
    currentIndex,
    mode,
    currentStep,
    activeImageUrl,
    canUndo,
    canRedo,
    stepCount: steps.length,
    hasSteps: steps.length > 0,
    undo,
    redo,
    goToStep,
    pushStep,
    updateStepBase64,
    updateLatestBase64,
    setMode,
    reset,
    restore,
  };
}
