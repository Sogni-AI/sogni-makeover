import { useState, useRef, useCallback, useEffect } from 'react';

interface BeforeAfterSliderProps {
  beforeImage: string;
  afterImage: string;
  /** When provided and different from beforeImage, shows a toggle on the Before label */
  originalImage?: string;
  className?: string;
}

/**
 * Center-crop an image to match target dimensions (same behavior as CSS object-cover).
 * Returns a blob URL of the resized image, or null if no resize needed.
 */
function resizeToMatch(
  img: HTMLImageElement,
  targetW: number,
  targetH: number,
): string | null {
  const { naturalWidth: srcW, naturalHeight: srcH } = img;

  // Already matching — skip resize
  if (srcW === targetW && srcH === targetH) return null;

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Replicate object-cover: scale to fill, then center-crop
  const scale = Math.max(targetW / srcW, targetH / srcH);
  const scaledW = srcW * scale;
  const scaledH = srcH * scale;
  const offsetX = (targetW - scaledW) / 2;
  const offsetY = (targetH - scaledH) / 2;

  ctx.drawImage(img, 0, 0, srcW, srcH, offsetX, offsetY, scaledW, scaledH);

  return canvas.toDataURL('image/jpeg', 0.92);
}

function BeforeAfterSlider({ beforeImage, afterImage, originalImage, className = '' }: BeforeAfterSliderProps) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null);
  const [normalizedBefore, setNormalizedBefore] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const naturalSizeRef = useRef<{ width: number; height: number } | null>(null);

  // Whether the before toggle is available (original differs from the default before)
  const canToggle = !!originalImage && originalImage !== beforeImage;

  // Reset sizing when images change to prevent stale dimensions / FOUC
  useEffect(() => {
    setDisplaySize(null);
    naturalSizeRef.current = null;
    setNormalizedBefore(null);
    setShowOriginal(false);
  }, [afterImage, beforeImage]);

  // Compute display size that fits within parent while maintaining aspect ratio
  const computeDisplaySize = useCallback(() => {
    const el = containerRef.current;
    const parent = el?.parentElement;
    const nat = naturalSizeRef.current;
    if (!parent || !nat) return;

    const cs = getComputedStyle(parent);
    const availW = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = parent.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const isDesktop = availW >= 768;
    const scale = Math.min(availW / nat.width, availH / nat.height, 1) * (isDesktop ? 0.90 : 1);

    setDisplaySize({
      width: Math.round(nat.width * scale),
      height: Math.round(nat.height * scale),
    });
  }, []);

  // Recompute on parent resize
  useEffect(() => {
    const parent = containerRef.current?.parentElement;
    if (!parent) return;

    const observer = new ResizeObserver(() => computeDisplaySize());
    observer.observe(parent);
    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Capture natural image dimensions on load and normalize the before image
  const handleAfterImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const afterW = img.naturalWidth;
    const afterH = img.naturalHeight;
    naturalSizeRef.current = { width: afterW, height: afterH };
    computeDisplaySize();

    // Normalize the before image to match the after's exact dimensions
    const beforeImg = new Image();
    beforeImg.crossOrigin = 'anonymous';
    beforeImg.onload = () => {
      const dataUrl = resizeToMatch(beforeImg, afterW, afterH);
      if (dataUrl) {
        setNormalizedBefore(dataUrl);
      }
    };
    beforeImg.src = activeBeforeImage;
  }, [activeBeforeImage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-normalize the before image when the toggle changes
  useEffect(() => {
    const nat = naturalSizeRef.current;
    if (!nat) return;

    setNormalizedBefore(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const dataUrl = resizeToMatch(img, nat.width, nat.height);
      if (dataUrl) {
        setNormalizedBefore(dataUrl);
      }
    };
    img.src = activeBeforeImage;
  }, [showOriginal]); // eslint-disable-line react-hooks/exhaustive-deps

  const updatePosition = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      updatePosition(e.clientX);
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      setIsDragging(true);
      updatePosition(e.touches[0].clientX);
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      updatePosition(e.clientX);
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      updatePosition(e.touches[0].clientX);
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging]); // eslint-disable-line react-hooks/exhaustive-deps

  // Determine which before image to show based on toggle state
  const activeBeforeImage = (canToggle && showOriginal) ? originalImage : beforeImage;

  // Use the normalized (dimension-matched) before image when available
  const effectiveBefore = normalizedBefore || activeBeforeImage;

  return (
    <div
      ref={containerRef}
      className={`relative cursor-col-resize select-none overflow-hidden rounded-2xl transition-opacity duration-300 ${displaySize ? 'opacity-100' : 'opacity-0'} ${className}`}
      style={{
        touchAction: 'none',
        ...(displaySize ? { width: displaySize.width, height: displaySize.height } : {}),
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      role="slider"
      aria-label="Before and after comparison slider"
      aria-valuenow={Math.round(sliderPosition)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') setSliderPosition((p) => Math.max(0, p - 2));
        if (e.key === 'ArrowRight') setSliderPosition((p) => Math.min(100, p + 2));
      }}
    >
      {/* After image (fills computed container) */}
      <img
        src={afterImage}
        alt="After transformation"
        className="block h-full w-full object-cover"
        onLoad={handleAfterImageLoad}
        draggable={false}
      />

      {/* Before image (clipped overlay — same size as after) */}
      <img
        src={effectiveBefore}
        alt="Before transformation"
        className="absolute inset-0 block h-full w-full object-cover"
        style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
        draggable={false}
      />

      {/* Divider line */}
      <div
        className="absolute bottom-0 top-0 z-10 w-px bg-primary-300/80 shadow-lg"
        style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)' }}
      >
        {/* Drag handle */}
        <div className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary-300/50 bg-surface-950/80 shadow-xl backdrop-blur-sm">
          <svg className="h-5 w-5 text-primary-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
        </div>
      </div>

      {/* Labels */}
      {canToggle ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowOriginal((v) => !v);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="absolute bottom-3 left-3 z-20 flex items-center gap-1.5 rounded-lg bg-surface-950/80 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-white/70 backdrop-blur-sm transition-colors hover:bg-surface-950/90 hover:text-white/90"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
          {showOriginal ? 'Original' : 'Previous'}
        </button>
      ) : (
        <div className="absolute bottom-3 left-3 z-10 rounded-lg bg-surface-950/70 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-white/70 backdrop-blur-sm">
          Before
        </div>
      )}
      <div className="absolute bottom-3 right-3 z-10 rounded-lg bg-surface-950/70 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-white/70 backdrop-blur-sm">
        After
      </div>
    </div>
  );
}

export default BeforeAfterSlider;
