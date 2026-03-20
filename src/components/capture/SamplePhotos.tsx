import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useApp } from '@/context/AppContext';

const EXCLUDED = new Set([6, 7]);

const allSamples = Array.from({ length: 33 }, (_, i) => i + 1)
  .filter((n) => !EXCLUDED.has(n))
  .map((n) => ({
    id: `sample-${String(n).padStart(2, '0')}`,
    src: `/images/sample-${String(n).padStart(2, '0')}.jpg`,
    label: `Sample Portrait ${n}`,
  }));

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function SamplePhotos() {
  const { setOriginalImage, setCurrentView } = useApp();
  const samples = useMemo(() => shuffle(allSamples), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    return () => el.removeEventListener('scroll', updateScrollState);
  }, [updateScrollState]);

  const scroll = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.7;
    el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
  }, []);

  const handleSampleClick = useCallback(
    (src: string, id: string) => {
      fetch(src)
        .then((res) => res.blob())
        .then((blob) => {
          const file = new File([blob], `${id}.jpg`, { type: 'image/jpeg' });
          setOriginalImage(file);
          setCurrentView('studio');
        });
    },
    [setOriginalImage, setCurrentView]
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3 }}
      className="mt-8 sm:mt-12"
    >
      <p className="text-center text-[11px] font-medium uppercase tracking-[0.2em] text-white/20">
        Or try with a sample photo
      </p>

      <div className="relative mx-auto mt-4 max-w-[90vw] sm:max-w-2xl lg:max-w-5xl">
        {/* Left scroll button */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute -left-1 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-surface-800/90 text-white/60 shadow-lg backdrop-blur-sm transition-colors hover:bg-surface-700 hover:text-white/90 sm:-left-3 sm:h-8 sm:w-8"
            aria-label="Scroll left"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
        )}

        {/* Right scroll button */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute -right-1 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-surface-800/90 text-white/60 shadow-lg backdrop-blur-sm transition-colors hover:bg-surface-700 hover:text-white/90 sm:-right-3 sm:h-8 sm:w-8"
            aria-label="Scroll right"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        )}

        {/* Left fade */}
        {canScrollLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-0 z-[5] w-8 bg-gradient-to-r from-surface-950 to-transparent" />
        )}

        {/* Right fade */}
        {canScrollRight && (
          <div className="pointer-events-none absolute inset-y-0 right-0 z-[5] w-8 bg-gradient-to-l from-surface-950 to-transparent" />
        )}

        {/* Scrollable carousel */}
        <div
          ref={scrollRef}
          className="scrollbar-hide flex gap-2 overflow-x-auto px-3 py-1 sm:gap-3 sm:px-4"
        >
          {samples.map((sample) => (
            <motion.button
              key={sample.id}
              whileHover={{ scale: 1.08, y: -2 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleSampleClick(sample.src, sample.id)}
              className="aspect-[2/3] w-[88px] flex-shrink-0 overflow-hidden rounded-lg border border-primary-400/[0.06] transition-all hover:border-primary-400/20 hover:shadow-lg hover:shadow-primary-400/5 sm:w-[100px] sm:rounded-xl lg:w-[120px]"
              aria-label={`Use ${sample.label}`}
            >
              <img
                src={sample.src}
                alt={sample.label}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </motion.button>
          ))}
        </div>
      </div>

      <p className="mt-2 text-center text-xs text-white/15">
        Sample photos for quick demo
      </p>
    </motion.div>
  );
}

export default SamplePhotos;
