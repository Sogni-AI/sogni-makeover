import { motion } from 'framer-motion';
import type { GenerationProgress as GenerationProgressType } from '@/types';
import ProgressBar from '@/components/common/ProgressBar';

interface GenerationProgressProps {
  progress: GenerationProgressType;
  onCancel: () => void;
  onDismiss?: () => void;
  transformationName?: string;
}

const statusLabels: Record<string, string> = {
  uploading: 'Uploading',
  queued: 'Queued',
  generating: 'Generating',
  completed: 'Complete',
  error: 'Error',
  cancelled: 'Cancelled',
};

function GenerationProgress({ progress, onCancel, onDismiss, transformationName }: GenerationProgressProps) {
  const statusLabel = statusLabels[progress.status] || progress.status;
  const isTerminal = progress.status === 'error' || progress.status === 'cancelled';
  const isActive = !isTerminal && progress.status !== 'completed';
  const blurAmount = Math.max(0, 8 - (progress.progress / 100) * 8);

  return (
    <div className="generation-overlay">
      {/* Preview image fills the entire overlay as background */}
      {progress.previewUrl && (
        <>
          <img
            src={progress.previewUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-contain"
            style={{
              filter: `blur(${blurAmount}px)`,
              transition: 'filter 0.8s ease-out',
            }}
          />
          {/* Dark scrim that fades as generation completes */}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to top, rgba(12,10,9,0.8) 0%, rgba(12,10,9,${Math.max(0.15, 0.5 - progress.progress / 200)}) 50%, rgba(12,10,9,${Math.max(0.1, 0.4 - progress.progress / 250)}) 100%)`,
              transition: 'background 0.8s ease-out',
            }}
          />
        </>
      )}

      {/* Compact progress bar at bottom of overlay */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="absolute inset-x-0 bottom-0 z-10 p-4"
      >
        <div className="mx-auto max-w-md rounded-xl border border-primary-400/[0.08] bg-surface-900/80 px-4 py-3 shadow-2xl backdrop-blur-md">
          {/* Status + progress */}
          <div className="flex items-center gap-3">
            {/* Spinner or status icon */}
            <div className="flex-shrink-0">
              {isActive ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-400/20 border-t-primary-400" />
              ) : progress.status === 'error' ? (
                <svg className="h-5 w-5 text-secondary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              ) : (
                <svg className="h-5 w-5 text-primary-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-white/90">{statusLabel}</span>
                {transformationName && (
                  <span className="truncate text-xs text-white/35">{transformationName}</span>
                )}
              </div>
              <div className="mt-1.5">
                <ProgressBar
                  progress={progress.progress}
                  message={progress.message}
                  showPercentage
                />
              </div>
            </div>

            {/* Cancel/Dismiss */}
            {isActive && (
              <button
                onClick={onCancel}
                className="flex-shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-white/40 transition-colors hover:bg-primary-400/[0.06] hover:text-white/70"
              >
                Cancel
              </button>
            )}
            {isTerminal && onDismiss && (
              <button
                onClick={onDismiss}
                className="flex-shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-white/40 transition-colors hover:bg-primary-400/[0.06] hover:text-white/70"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default GenerationProgress;
