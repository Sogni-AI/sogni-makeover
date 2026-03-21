import { useEffect, useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface CarouselItem {
  key: string;
  stepIndex: number;
  url: string | null;
  label: string;
  icon?: string;
}

interface FullscreenCarouselProps {
  isOpen: boolean;
  onClose: () => void;
  items: CarouselItem[];
  initialIndex: number;
  onDownload?: () => void;
  onShare?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onFullscreenCompare?: () => void;
}

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const panelVariants = {
  hidden: { scale: 0.9, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 320,
      damping: 30,
      mass: 0.9,
      opacity: { duration: 0.2, ease: 'easeOut' },
    },
  },
  exit: {
    scale: 0.9,
    opacity: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 400,
      damping: 35,
      mass: 0.8,
      opacity: { duration: 0.15, ease: 'easeIn' },
    },
  },
};

function FullscreenCarousel({ isOpen, onClose, items, initialIndex, onDownload, onShare, onUndo, onRedo, canUndo, canRedo, onFullscreenCompare }: FullscreenCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [direction, setDirection] = useState(0);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  // Sync active index when opening
  useEffect(() => {
    if (isOpen) setActiveIndex(initialIndex);
  }, [isOpen, initialIndex]);

  // Escape key to close
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowLeft' && activeIndex > 0) {
      setDirection(-1);
      setActiveIndex(i => Math.max(0, i - 1));
    }
    if (e.key === 'ArrowRight' && activeIndex < items.length - 1) {
      setDirection(1);
      setActiveIndex(i => Math.min(items.length - 1, i + 1));
    }
  }, [activeIndex, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Touch swipe
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx > 0 && activeIndex > 0) {
        setDirection(-1);
        setActiveIndex(i => Math.max(0, i - 1));
      } else if (dx < 0 && activeIndex < items.length - 1) {
        setDirection(1);
        setActiveIndex(i => Math.min(items.length - 1, i + 1));
      }
    }
  }, [activeIndex, items.length]);

  const item = items[activeIndex];

  const slideVariants = {
    enter: (dir: number) => ({ x: dir > 0 ? '40%' : '-40%', opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? '-40%' : '40%', opacity: 0 }),
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fullscreen-carousel-backdrop"
          variants={backdropVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={{ duration: 0.25, ease: 'easeOut' }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Image panel */}
          <motion.div
            className="fullscreen-carousel-panel"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <AnimatePresence initial={false} custom={direction} mode="popLayout">
              <motion.img
                key={item?.key}
                src={item?.url ?? undefined}
                alt={item?.label ?? 'Image'}
                className="fullscreen-carousel-img"
                draggable={false}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: 'spring', stiffness: 350, damping: 32 }}
              />
            </AnimatePresence>
          </motion.div>

          {/* Step indicator dots */}
          {items.length > 1 && (
            <div className="fullscreen-carousel-dots">
              {items.map((it, i) => (
                <button
                  key={it.key}
                  className={`fullscreen-carousel-dot ${i === activeIndex ? 'fullscreen-carousel-dot--active' : ''}`}
                  onClick={() => {
                    setDirection(i > activeIndex ? 1 : -1);
                    setActiveIndex(i);
                  }}
                  aria-label={it.label}
                />
              ))}
            </div>
          )}

          {/* Label + Action bar */}
          <div className="fullscreen-carousel-bottom">
            <div className="fullscreen-carousel-label">
              {item?.icon && <span className="mr-1">{item.icon}</span>}
              <span>{item?.label}</span>
              {items.length > 1 && (
                <span className="ml-1.5 text-white/30">{activeIndex + 1}/{items.length}</span>
              )}
            </div>

            {item && item.stepIndex >= 0 && (
              <div className="fullscreen-carousel-actions">
                <button
                  onClick={onUndo}
                  disabled={!canUndo}
                  className="fullscreen-carousel-action-btn"
                  title="Undo"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                  </svg>
                </button>
                {canRedo && (
                  <button
                    onClick={onRedo}
                    className="fullscreen-carousel-action-btn"
                    title="Redo"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
                    </svg>
                  </button>
                )}
                <div className="fullscreen-carousel-action-divider" />
                <button
                  onClick={onDownload}
                  className="fullscreen-carousel-action-btn"
                  title="Save"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  <span>Save</span>
                </button>
                <button
                  onClick={onShare}
                  className="fullscreen-carousel-action-btn"
                  title="Share"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                  </svg>
                  <span>Share</span>
                </button>
                <div className="fullscreen-carousel-action-divider" />
                <button
                  onClick={() => { onClose(); onFullscreenCompare?.(); }}
                  className="fullscreen-carousel-action-btn"
                  title="Compare before/after"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="fullscreen-comparison-close-btn"
            aria-label="Close fullscreen"
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

export default FullscreenCarousel;
