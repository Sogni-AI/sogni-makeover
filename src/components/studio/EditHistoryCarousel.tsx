import { useRef, useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '@/context/AppContext';
import FullscreenComparison from '@/components/studio/FullscreenComparison';

// ── Coverflow positioning math ──────────────────────────────────────────────

interface CarouselItemStyle {
  x: number;
  scale: number;
  opacity: number;
  zIndex: number;
}

/**
 * Computes transform values for a coverflow card based on its distance from
 * the active item. Adjacent cards are positioned edge-to-edge with the hero,
 * minus a small overlap to create the layered depth illusion.
 */
function getCarouselItemStyle(offset: number, heroWidth: number): CarouselItemStyle {
  const absOffset = Math.abs(offset);
  const sign = Math.sign(offset);
  const OVERLAP_PX = 12;

  const scales    = [1.0, 0.62, 0.42, 0.30];
  const opacities = [1.0, 0.82, 0.50, 0.25];
  const zIndexes  = [10, 8, 4, 1];

  if (absOffset > 3) {
    return { x: sign * heroWidth * 2.5, scale: 0.25, opacity: 0, zIndex: 0 };
  }

  const scale   = scales[absOffset];
  const opacity = opacities[absOffset];
  const zIndex  = zIndexes[absOffset];

  if (absOffset === 0) return { x: 0, scale, opacity, zIndex };

  // ±1: edge-to-edge with hero minus overlap
  const s1 = scales[1];
  const x1 = heroWidth * (1 + s1) / 2 - OVERLAP_PX;
  if (absOffset === 1) return { x: sign * x1, scale, opacity, zIndex };

  // ±2: edge-to-edge with the ±1 card
  const s2 = scales[2];
  const x2 = x1 + heroWidth * (s1 + s2) / 2 - OVERLAP_PX / 2;
  if (absOffset === 2) return { x: sign * x2, scale, opacity, zIndex };

  // ±3: continues outward
  const s3 = scales[3];
  const x3 = x2 + heroWidth * (s2 + s3) / 2;
  return { x: sign * x3, scale, opacity, zIndex };
}

// ── Spring / tween configs ──────────────────────────────────────────────────

const positionSpring = { type: 'spring' as const, stiffness: 380, damping: 32, mass: 1 };
const scaleSpring    = { type: 'spring' as const, stiffness: 340, damping: 22, mass: 0.8 };
const opacityTween   = { type: 'tween' as const, duration: 0.18, ease: 'easeOut' as const };
const entrySpring    = { type: 'spring' as const, stiffness: 280, damping: 18, mass: 0.9 };

// ── Component ───────────────────────────────────────────────────────────────

function EditHistoryCarousel() {
  const {
    originalImageUrl,
    editStack,
    isGenerating,
  } = useApp();

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 450 });
  const [showFullscreen, setShowFullscreen] = useState(false);

  const { steps, currentIndex, canUndo, canRedo, goToStep, undo, redo, mode } = editStack;

  // ── Measure container ─────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Card dimensions (portrait 2:3, fit inside container) ──────────────────

  const maxH = containerSize.height * 0.92;
  const maxW = containerSize.width * 0.55;
  const widthFromHeight = maxH * (2 / 3);
  const cardWidth  = Math.min(widthFromHeight, maxW);
  const cardHeight = widthFromHeight > maxW ? maxW * (3 / 2) : maxH;

  // Centering offsets (cards have left:50% top:50% via CSS)
  const baseX = -cardWidth / 2;
  const baseY = -cardHeight / 2;

  // ── Arrow key navigation ──────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToStep(Math.max(-1, currentIndex - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToStep(Math.min(steps.length - 1, currentIndex + 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, steps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mouse wheel navigation ───────────────────────────────────────────────

  const wheelCooldown = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      // Only respond to meaningful scroll deltas
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 10) return;

      e.preventDefault();

      if (wheelCooldown.current) return;
      wheelCooldown.current = true;
      setTimeout(() => { wheelCooldown.current = false; }, 300);

      if (delta > 0) {
        goToStep(Math.min(steps.length - 1, currentIndex + 1));
      } else {
        goToStep(Math.max(-1, currentIndex - 1));
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [currentIndex, steps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Touch swipe ───────────────────────────────────────────────────────────

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      goToStep(dx > 0
        ? Math.max(-1, currentIndex - 1)
        : Math.min(steps.length - 1, currentIndex + 1));
    }
  }, [currentIndex, steps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Download ──────────────────────────────────────────────────────────────

  const handleDownload = async () => {
    const url = editStack.activeImageUrl;
    if (!url) return;
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `sogni-makeover-${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, '_blank');
    }
  };

  // ── Share ────────────────────────────────────────────────────────────────

  const handleShare = async () => {
    const url = editStack.activeImageUrl;
    if (!url) return;
    if (navigator.share) {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], 'sogni-makeover.jpg', { type: 'image/jpeg' });
        await navigator.share({
          title: 'My Sogni Makeover',
          text: 'Check out my AI makeover!',
          files: [file],
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      try {
        await navigator.clipboard.writeText(window.location.href);
      } catch {
        // Clipboard write failed
      }
    }
  };

  // ── Build items list ──────────────────────────────────────────────────────

  const allItems = [
    { key: 'original', stepIndex: -1, url: originalImageUrl, transformation: null as null },
    ...steps.map((step, i) => ({
      key: `step-${step.timestamp}`,
      stepIndex: i,
      url: step.resultImageUrl,
      transformation: step.transformation,
    })),
  ];
  const activeArrayIndex = currentIndex + 1; // 0 = original

  // Before image for inline comparison
  const beforeImage = currentIndex > 0 && mode === 'stacked'
    ? steps[currentIndex - 1].resultImageUrl
    : originalImageUrl;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="coverflow-viewport"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Coverflow cards ──────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {allItems.map((item, arrayIdx) => {
          const offset = arrayIdx - activeArrayIndex;
          const absOffset = Math.abs(offset);
          const isActive = offset === 0;

          if (absOffset > 3) return null;

          const s = getCarouselItemStyle(offset, cardWidth);
          const brightness = isActive ? 1.0 : Math.max(0.45, 0.72 - (absOffset - 1) * 0.22);

          return (
            <motion.div
              key={item.key}
              className={`coverflow-card ${isActive ? 'coverflow-card--active' : 'coverflow-card--inactive'}`}
              style={{ width: cardWidth, height: cardHeight, zIndex: s.zIndex }}
              initial={{ opacity: 0, scale: 0.8, filter: 'blur(8px)', x: baseX + s.x, y: baseY }}
              animate={{
                x: baseX + s.x,
                y: baseY,
                scale: s.scale,
                opacity: s.opacity,
                filter: `brightness(${brightness})${isActive ? '' : ` saturate(${Math.max(0.6, 1 - absOffset * 0.15)})`}`,
              }}
              exit={{ opacity: 0, scale: 0.7, filter: 'blur(4px)', transition: { duration: 0.2 } }}
              transition={{
                x: positionSpring,
                y: positionSpring,
                scale: scaleSpring,
                opacity: opacityTween,
                filter: { type: 'tween', duration: 0.28, ease: 'easeOut' },
              }}
              onClick={() => !isActive && goToStep(item.stepIndex)}
              whileHover={!isActive ? {
                scale: s.scale * 1.07,
                opacity: Math.min(1, s.opacity + 0.14),
                transition: { type: 'spring', stiffness: 500, damping: 28 },
              } : undefined}
              whileTap={!isActive ? {
                scale: s.scale * 0.94,
                transition: { type: 'spring', stiffness: 600, damping: 35 },
              } : undefined}
            >
              <img
                src={item.url ?? undefined}
                alt={item.stepIndex === -1 ? 'Original photo' : (item.transformation?.name ?? 'Result')}
                className="coverflow-card-img"
                draggable={false}
              />

              {/* Label on non-active cards */}
              {!isActive && (
                <div className="coverflow-label">
                  {item.stepIndex === -1
                    ? <span className="coverflow-label-text">Original</span>
                    : <span className="coverflow-label-icon">{item.transformation?.icon}</span>
                  }
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* ── Generating placeholder ───────────────────────────── */}
      <AnimatePresence>
        {isGenerating && (() => {
          const gs = getCarouselItemStyle(1, cardWidth); // appears one position ahead
          return (
            <motion.div
              key="generating"
              className="coverflow-card coverflow-placeholder"
              style={{ width: cardWidth, height: cardHeight, zIndex: gs.zIndex }}
              initial={{ opacity: 0, scale: 0.4, x: baseX + gs.x, y: baseY }}
              animate={{
                opacity: gs.opacity * 0.6,
                scale: gs.scale,
                x: baseX + gs.x,
                y: baseY,
              }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={entrySpring}
            >
              <div className="coverflow-shimmer" />
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ── Mini redo pill (original photo, redo available) ──── */}
      {currentIndex === -1 && canRedo && !isGenerating && (
        <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
          <button
            onClick={redo}
            className="flex items-center gap-1.5 rounded-full border border-primary-400/10 bg-surface-900/80 px-3 py-1.5 text-xs font-medium text-white/70 shadow-xl backdrop-blur-md transition-colors hover:bg-primary-400/[0.06] hover:text-white"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
            </svg>
            Redo
          </button>
        </div>
      )}

      {/* ── Action bar (viewing a result) ────────────────────── */}
      {currentIndex >= 0 && (
        <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1 rounded-2xl border border-primary-400/10 bg-surface-900/80 px-2 pb-1.5 pt-1 shadow-xl backdrop-blur-md">
          {steps[currentIndex]?.transformation && (
            <>
              <span className="relative text-[11px] font-medium text-primary-300/80">
                {steps[currentIndex].transformation.icon} {steps[currentIndex].transformation.name}
                {editStack.stepCount > 1 && (
                  <span className="ml-1 text-white/25">
                    {currentIndex + 1}/{editStack.stepCount}
                  </span>
                )}
              </span>
              <div className="h-px w-full bg-primary-400/10" />
            </>
          )}
          <div className="flex items-center gap-1.5">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-white/70 transition-colors hover:bg-primary-400/[0.06] hover:text-white disabled:pointer-events-none disabled:text-white/20"
            title="Undo"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
            <span className="hidden sm:inline">Undo</span>
          </button>
          {canRedo && (
            <button
              onClick={redo}
              className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-white/70 transition-colors hover:bg-primary-400/[0.06] hover:text-white"
              title="Redo"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
              </svg>
              <span className="hidden sm:inline">Redo</span>
            </button>
          )}
          <div className="h-4 w-px bg-primary-400/10" />
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-white/70 transition-colors hover:bg-primary-400/[0.06] hover:text-white"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Save
          </button>
          <button
            onClick={handleShare}
            className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-white/70 transition-colors hover:bg-primary-400/[0.06] hover:text-white"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
            <span className="hidden sm:inline">Share</span>
          </button>
          <div className="h-4 w-px bg-primary-400/10" />
          <button
            onClick={() => setShowFullscreen(true)}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-white/70 transition-colors hover:bg-primary-400/[0.06] hover:text-white"
            title="Full view"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
          </button>
          </div>
        </div>
      )}

      {/* ── Fullscreen comparison overlay ───────────────────── */}
      <FullscreenComparison
        isOpen={showFullscreen}
        onClose={() => setShowFullscreen(false)}
        beforeImage={beforeImage!}
        afterImage={currentIndex >= 0 ? steps[currentIndex].resultImageUrl : null}
        originalImage={
          currentIndex > 0 && mode === 'stacked' && originalImageUrl
            ? originalImageUrl
            : undefined
        }
        transformationName={currentIndex >= 0 ? steps[currentIndex].transformation?.name : undefined}
        onDownload={handleDownload}
        onShare={handleShare}
      />
    </div>
  );
}

export default EditHistoryCarousel;
