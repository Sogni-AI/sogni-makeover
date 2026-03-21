import { motion } from 'framer-motion';
import { useApp } from '@/context/AppContext';

interface ResultDisplayProps {
  resultUrl: string;
}

function ResultDisplay({ resultUrl }: ResultDisplayProps) {
  const { setCurrentView, editStack } = useApp();

  const handleDownload = async () => {
    try {
      const response = await fetch(resultUrl);
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
      window.open(resultUrl, '_blank');
    }
  };

  return (
    <div className="relative h-full w-full">
      <motion.div
        key="result"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="h-full w-full"
      >
        <img
          src={resultUrl}
          alt="Transformation result"
          className="h-full w-full object-contain"
        />
      </motion.div>

      {/* Floating action bar */}
      <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-primary-400/10 bg-surface-900/80 px-2 py-1.5 shadow-xl backdrop-blur-md">
        {/* Undo/Redo group */}
        <button
          onClick={editStack.undo}
          disabled={!editStack.canUndo}
          className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-white/70 transition-colors hover:bg-primary-400/[0.06] hover:text-white disabled:pointer-events-none disabled:text-white/20"
          title="Undo"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
          </svg>
          <span className="hidden sm:inline">Undo</span>
        </button>
        {editStack.canRedo && (
          <button
            onClick={editStack.redo}
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

        {/* Actions */}
        <button
          onClick={handleDownload}
          className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-white/70 transition-colors hover:bg-primary-400/[0.06] hover:text-white"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Save
        </button>
        <div className="h-4 w-px bg-primary-400/10" />
        <button
          onClick={() => setCurrentView('results')}
          className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-white/70 transition-colors hover:bg-primary-400/[0.06] hover:text-white"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
          </svg>
          Full View
        </button>
      </div>
    </div>
  );
}

export default ResultDisplay;
