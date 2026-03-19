import { motion } from 'framer-motion';
import { useApp } from '@/context/AppContext';
import BeforeAfterSlider from '@/components/common/BeforeAfterSlider';
import Button from '@/components/common/Button';

function ComparisonView() {
  const {
    originalImageUrl,
    currentResult,
    currentTransformation,
    setCurrentView,
    editStack,
  } = useApp();

  const resultImageUrl = currentResult?.imageUrl ?? null;

  if (!originalImageUrl || !resultImageUrl) {
    return (
      <section className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-white/35">No results to display yet.</p>
          <Button
            variant="primary"
            className="mt-4"
            onClick={() => setCurrentView('studio')}
          >
            Go to Studio
          </Button>
        </div>
      </section>
    );
  }

  const handleDownload = async () => {
    try {
      const response = await fetch(resultImageUrl);
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
      window.open(resultImageUrl, '_blank');
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        const response = await fetch(resultImageUrl);
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
        // Clipboard failed
      }
    }
  };

  return (
    <section className="relative flex h-full flex-col overflow-hidden">
      {/* Before/After slider fills the space */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="flex min-h-0 flex-1 items-center justify-center p-4"
      >
        <BeforeAfterSlider
          beforeImage={
            editStack.mode === 'stacked' && editStack.currentIndex > 0
              ? editStack.steps[editStack.currentIndex - 1].resultImageUrl
              : originalImageUrl
          }
          afterImage={resultImageUrl}
          originalImage={
            editStack.mode === 'stacked' && editStack.currentIndex > 0
              ? originalImageUrl
              : undefined
          }
          className="max-h-full"
        />
      </motion.div>

      {/* Bottom bar with transformation info and actions */}
      <div className="flex flex-shrink-0 items-center justify-between border-t border-primary-400/[0.06] bg-surface-950/50 px-4 py-2.5">
        {/* Left: transformation info */}
        <div className="flex items-center gap-2">
          {currentTransformation && (
            <span className="text-sm text-white/40">
              <span className="mr-1">{currentTransformation.icon}</span>
              {currentTransformation.name}
            </span>
          )}
        </div>

        {/* Right: action buttons */}
        <div className="flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 rounded-lg border border-primary-400/10 px-2 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-primary-400/[0.06] hover:text-white sm:gap-1.5 sm:px-3"
          >
            <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            <span className="hidden sm:inline">Download</span>
          </button>
          <button
            onClick={handleShare}
            className="flex items-center gap-1 rounded-lg border border-primary-400/10 px-2 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-primary-400/[0.06] hover:text-white sm:gap-1.5 sm:px-3"
          >
            <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
            <span className="hidden sm:inline">Share</span>
          </button>
          <button
            onClick={() => setCurrentView('studio')}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary-400 px-2 py-1.5 text-xs font-medium text-surface-950 transition-colors hover:bg-primary-300 sm:px-3"
          >
            Try Another
          </button>
        </div>
      </div>
    </section>
  );
}

export default ComparisonView;
