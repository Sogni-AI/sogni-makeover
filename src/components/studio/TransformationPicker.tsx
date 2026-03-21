import { useMemo, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import type { GeneratedTransformation, GeneratedCategory } from '@/types/chat';
import type { GenerationProgress } from '@/types';

interface TransformationPickerProps {
  categories: GeneratedCategory[];
  selectedCategory: string;
  onSelectTransformation: (transformation: GeneratedTransformation) => void;
  isDisabled: boolean;
  activeTransformationId: string | null;
  isLoading: boolean;
  thumbnailUrls?: Map<string, string>;
  generationProgress?: GenerationProgress | null;
  onCancelGeneration?: () => void;
  onDismissProgress?: () => void;
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
  thumbnailUrls,
  generationProgress,
  onCancelGeneration,
  onDismissProgress,
}: TransformationPickerProps) {
  const category = useMemo(
    () => categories.find((c) => c.name === selectedCategory),
    [categories, selectedCategory]
  );

  const transformations = category?.transformations || [];

  // Portal-based tooltip state
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout>>(null);

  const showTooltip = useCallback((e: React.MouseEvent<HTMLButtonElement>, pitch: string) => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({
      text: pitch,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
    autoCloseRef.current = setTimeout(() => setTooltip(null), 8000);
  }, []);

  const hideTooltip = useCallback(() => {
    if (autoCloseRef.current) {
      clearTimeout(autoCloseRef.current);
      autoCloseRef.current = null;
    }
    hideTimeoutRef.current = setTimeout(() => setTooltip(null), 100);
  }, []);

  const isCategoryLoading = category && !category.populated;

  if (isLoading || isCategoryLoading) {
    return (
      <div className="flex min-h-0 flex-col">
        <div className="transformation-grid">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="transformation-card flex flex-col items-center gap-2 p-3">
              <div className="thumbnail-container">
                <div className="thumbnail-placeholder animate-pulse" />
              </div>
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
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
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
              const thumbUrl = thumbnailUrls?.get(transformation.id);
              const isActiveGenerating = isActive && generationProgress && generationProgress.status !== 'completed';
              const isTerminal = generationProgress?.status === 'error' || generationProgress?.status === 'cancelled';
              return (
                <motion.button
                  key={transformation.id}
                  variants={gridItemVariants}
                  transition={{ duration: 0.2 }}
                  whileHover={isDisabled ? undefined : { scale: 1.05 }}
                  whileTap={isDisabled ? undefined : { scale: 0.95 }}
                  onClick={() => {
                    if (isActiveGenerating && !isTerminal && onCancelGeneration) {
                      onCancelGeneration();
                    } else if (isActiveGenerating && isTerminal && onDismissProgress) {
                      onDismissProgress();
                    } else if (!isDisabled) {
                      onSelectTransformation(transformation);
                    }
                  }}
                  onMouseEnter={(e) => !isDisabled && transformation.pitch && showTooltip(e, transformation.pitch)}
                  onMouseLeave={hideTooltip}
                  className={`transformation-card ${isActive ? 'active' : ''} ${isDisabled && !isActiveGenerating ? 'disabled' : ''}`}
                  disabled={isDisabled && !isActiveGenerating}
                  aria-label={isActiveGenerating && !isTerminal ? `Cancel ${transformation.name}` : `Apply ${transformation.name} transformation`}
                >
                  <div className="thumbnail-container relative">
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={transformation.name}
                        className="thumbnail-image"
                        loading="lazy"
                      />
                    ) : (
                      <div className="thumbnail-placeholder">
                        <span className="text-lg">{transformation.icon}</span>
                      </div>
                    )}
                    {/* Generation progress overlay on active card */}
                    {isActiveGenerating && (
                      <div className="card-progress-overlay">
                        {!isTerminal ? (
                          <div className="card-progress-spinner" />
                        ) : (
                          <svg className="h-4 w-4 text-secondary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                          </svg>
                        )}
                        <div className="card-progress-bar">
                          <motion.div
                            className="card-progress-fill"
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.max(0, Math.min(100, generationProgress.progress))}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                          />
                        </div>
                        <span className="card-progress-label">
                          {isTerminal ? 'Tap to dismiss' : `${Math.round(generationProgress.progress)}%`}
                        </span>
                      </div>
                    )}
                  </div>
                  <span className="text-xs font-medium leading-tight">
                    {isActiveGenerating && !isTerminal ? (
                      <span className="text-primary-300/70">
                        {generationProgress.status === 'queued' ? 'Queued' : 'Generating'}
                      </span>
                    ) : (
                      transformation.name
                    )}
                  </span>
                </motion.button>
              );
            })}
          </motion.div>
        ) : (
          <div className="flex items-center justify-center p-12">
            <p className="text-sm text-white/25">
              {categories.length > 0
                ? 'Tap on a category to get started or tell your stylist what you\u2019re looking for to see more options.'
                : 'Tell your stylist what you\u2019re looking for to see personalized options.'}
            </p>
          </div>
        )}
      </div>

      {/* Portal tooltip (escapes overflow clipping) */}
      {tooltip && createPortal(
        <div
          className="transformation-tooltip-portal"
          style={{
            left: tooltip.x,
            top: tooltip.y,
          }}
        >
          {tooltip.text}
        </div>,
        document.body
      )}
    </div>
  );
}

export default TransformationPicker;
