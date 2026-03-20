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
              Tell your stylist what you&apos;re looking for to see personalized options.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default TransformationPicker;
