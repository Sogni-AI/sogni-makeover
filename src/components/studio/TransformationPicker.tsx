import { useMemo, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import type { GeneratedTransformation, GeneratedCategory } from '@/types/chat';

interface TransformationPickerProps {
  categories: GeneratedCategory[];
  selectedCategory: string;
  onSelectTransformation: (transformation: GeneratedTransformation) => void;
  isDisabled: boolean;
  activeTransformationId: string | null;
  isLoading: boolean;
  thumbnailUrls?: Map<string, string>;
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
              return (
                <motion.button
                  key={transformation.id}
                  variants={gridItemVariants}
                  transition={{ duration: 0.2 }}
                  whileHover={isDisabled ? undefined : { scale: 1.05 }}
                  whileTap={isDisabled ? undefined : { scale: 0.95 }}
                  onClick={() => !isDisabled && onSelectTransformation(transformation)}
                  onMouseEnter={(e) => !isDisabled && transformation.pitch && showTooltip(e, transformation.pitch)}
                  onMouseLeave={hideTooltip}
                  className={`transformation-card ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`}
                  disabled={isDisabled}
                  aria-label={`Apply ${transformation.name} transformation`}
                >
                  <div className="thumbnail-container">
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
                  </div>
                  <span className="text-xs font-medium leading-tight">{transformation.name}</span>
                </motion.button>
              );
            })}
          </motion.div>
        ) : (
          <div className="flex items-center justify-center p-12">
            <p className="text-sm text-white/25">
              Tell your stylist what you&apos;re looking for to see personalized options.
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
