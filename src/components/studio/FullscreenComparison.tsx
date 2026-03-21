import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import BeforeAfterSlider from '@/components/common/BeforeAfterSlider';

interface FullscreenComparisonProps {
  isOpen: boolean;
  onClose: () => void;
  beforeImage: string;
  afterImage: string | null;
  originalImage?: string;
  transformationName?: string;
  onDownload: () => void;
  onShare: () => void;
}

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const panelVariants = {
  hidden: {
    scale: 0.85,
    opacity: 0,
    borderRadius: '16px',
  },
  visible: {
    scale: 1,
    opacity: 1,
    borderRadius: '0px',
    transition: {
      type: 'spring' as const,
      stiffness: 320,
      damping: 30,
      mass: 0.9,
      opacity: { duration: 0.2, ease: 'easeOut' },
    },
  },
  exit: {
    scale: 0.88,
    opacity: 0,
    borderRadius: '16px',
    transition: {
      type: 'spring' as const,
      stiffness: 400,
      damping: 35,
      mass: 0.8,
      opacity: { duration: 0.15, ease: 'easeIn' },
    },
  },
};

const barVariants = {
  hidden: { y: 40, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: 'spring' as const, stiffness: 340, damping: 28, delay: 0.08 },
  },
  exit: {
    y: 30,
    opacity: 0,
    transition: { duration: 0.12, ease: 'easeIn' as const },
  },
};

function FullscreenComparison({
  isOpen,
  onClose,
  beforeImage,
  afterImage,
  originalImage,
  transformationName,
  onDownload,
  onShare,
}: FullscreenComparisonProps) {

  // Escape key to close
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!afterImage) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fullscreen-comparison-backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          {/* Slider panel */}
          <motion.div
            className="fullscreen-comparison-panel"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <BeforeAfterSlider
              beforeImage={beforeImage}
              afterImage={afterImage}
              originalImage={originalImage}
              className="fullscreen-comparison-slider"
            />
          </motion.div>

          {/* Bottom action bar */}
          <motion.div
            className="fullscreen-comparison-bar"
            variants={barVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {transformationName && (
              <>
                <span className="text-[11px] font-medium text-primary-300/80">
                  {transformationName}
                </span>
                <div className="h-px w-full bg-primary-400/10" />
              </>
            )}
            <div className="flex items-center gap-1.5">
              <button
                onClick={onDownload}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:bg-primary-400/[0.06] hover:text-white"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Save
              </button>
              <button
                onClick={onShare}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:bg-primary-400/[0.06] hover:text-white"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                </svg>
                Share
              </button>
              <div className="h-4 w-px bg-primary-400/10" />
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:bg-primary-400/[0.06] hover:text-white"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                </svg>
                Close
              </button>
            </div>
          </motion.div>

          {/* Close hotspot (click backdrop area outside slider) */}
          <button
            onClick={onClose}
            className="fullscreen-comparison-close-btn"
            aria-label="Close comparison"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default FullscreenComparison;
