import { useState } from 'react';
import { motion } from 'framer-motion';
import { useApp } from '@/context/AppContext';
import { useToast } from '@/context/ToastContext';
import Button from '@/components/common/Button';
import type { HistoryItem } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

function getCategoryLabel(item: HistoryItem): string {
  // Capitalize the category name for display
  const raw = item.transformation.category;
  return raw.charAt(0).toUpperCase() + raw.slice(1).replace(/-/g, ' ');
}

// ---------------------------------------------------------------------------
// HistoryView
// ---------------------------------------------------------------------------

function HistoryView() {
  const { history, clearHistory, removeFromHistory, setCurrentView } = useApp();
  const { showToast } = useToast();
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const handleBack = () => {
    setCurrentView('landing');
  };

  const handleClearHistory = () => {
    if (window.confirm('Clear all makeover history?')) {
      clearHistory();
      showToast('History cleared', 'success');
    }
  };

  const handleCardClick = () => {
    setCurrentView('studio');
  };

  const handleDeleteItem = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeFromHistory(id);
    showToast('Entry deleted', 'success');
  };

  const handleImageError = (id: string) => {
    setFailedImages((prev) => new Set(prev).add(id));
  };

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  if (history.length === 0) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-primary-400/[0.06] px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-primary-400/[0.06] hover:text-white/90"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-lg font-semibold text-white/90">Makeover History</h1>
          </div>
        </div>

        {/* Empty state content */}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-800/60">
            <svg className="h-8 w-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm text-white/40">No makeovers yet</p>
          <Button
            variant="primary"
            size="md"
            onClick={() => setCurrentView('capture')}
          >
            Start Your First Makeover
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // History grid
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-primary-400/[0.06] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-primary-400/[0.06] hover:text-white/90"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-white/90">Makeover History</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClearHistory}
        >
          Clear History
        </Button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {history.map((item, index) => (
            <motion.button
              key={item.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04, duration: 0.3 }}
              onClick={handleCardClick}
              className="group cursor-pointer overflow-hidden rounded-xl border border-primary-400/[0.06] bg-surface-900/40 text-left transition-all hover:border-primary-400/15 hover:bg-surface-900/60"
            >
              {/* Thumbnail */}
              <div className="relative aspect-[2/3] bg-surface-800">
                {failedImages.has(item.id) ? (
                  <div className="flex h-full w-full items-center justify-center bg-surface-800">
                    <svg className="h-8 w-8 text-white/10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                    </svg>
                  </div>
                ) : (
                  <img
                    src={item.resultImage}
                    alt={item.transformation.name}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    onError={() => handleImageError(item.id)}
                  />
                )}
                {/* Delete button */}
                <button
                  onClick={(e) => handleDeleteItem(e, item.id)}
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white/60 opacity-0 backdrop-blur-sm transition-all hover:bg-red-500/80 hover:text-white group-hover:opacity-100"
                  title="Delete"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Info */}
              <div className="px-2.5 py-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 text-xs">{item.transformation.icon}</span>
                  <p className="truncate text-sm font-medium text-white/80 group-hover:text-white/90">
                    {item.transformation.name}
                  </p>
                </div>
                <p
                  className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/40 group-hover:text-white/55"
                  title={item.transformation.prompt}
                >
                  {item.transformation.prompt}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-white/25">
                  <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5">
                    {getCategoryLabel(item)}
                  </span>
                  <span>{getRelativeTime(item.timestamp)}</span>
                  {item.duration > 0 && <span>{formatDuration(item.duration)}</span>}
                  {item.cost !== undefined && <span>{item.cost.toFixed(2)} credits</span>}
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default HistoryView;
