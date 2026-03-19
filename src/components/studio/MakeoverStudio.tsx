import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useApp } from '@/context/AppContext';
import type { GeneratedTransformation } from '@/types/chat';
import type { UseChatReturn } from '@/hooks/useChat';
import CategoryNav from '@/components/studio/CategoryNav';
import TransformationPicker from '@/components/studio/TransformationPicker';
import EditHistoryCarousel from '@/components/studio/EditHistoryCarousel';
import GenerationProgress from '@/components/studio/GenerationProgress';
import ChatPanel from '@/components/chat/ChatPanel';
import DemoBanner from '@/components/auth/DemoBanner';
import { useMakeoverCostEstimate } from '@/hooks/useMakeoverCostEstimate';
import { useWallet } from '@/hooks/useWallet';
import { formatTokenAmount, getTokenLabel } from '@/services/walletService';
import '@/styles/studio.css';

/**
 * MakeoverStudio integrates the chat panel with the existing studio layout.
 *
 * The chat hook (useChat) is expected to be initialized by a parent component
 * and passed in as a prop. This keeps the hook lifecycle outside the studio
 * so it can be initialized when the photo is first captured.
 *
 * For the Stream D stub, we use a minimal inline chat state until Stream C
 * provides the real useChat hook. The component is structured to accept
 * a UseChatReturn object.
 */

interface MakeoverStudioProps {
  chat?: UseChatReturn;
}

function MakeoverStudio({ chat }: MakeoverStudioProps) {
  const {
    originalImageUrl,
    setCurrentView,
    resetPhoto,
    isGenerating,
    generationProgress,
    setGenerationProgress,
    cancelGeneration,
    generateMakeover,
    currentTransformation,
    authState,
    demoGenerationsRemaining,
    history,
    enhanceProgress,
    isEnhancing,
    cancelEnhancement,
    editStack,
  } = useApp();

  const { tokenCost, usdCost, isLoading: costLoading } = useMakeoverCostEstimate();
  const { tokenType } = useWallet();

  // Use generated categories from chat, or empty array as fallback
  const generatedCategories = chat?.generatedCategories ?? [];
  const isCategoriesLoading = chat ? chat.isStreaming && generatedCategories.length === 0 : false;

  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [activeTransformationId, setActiveTransformationId] = useState<string | null>(null);

  // Sync selected category when categories arrive
  useEffect(() => {
    if (generatedCategories.length > 0 && !selectedCategory) {
      setSelectedCategory(generatedCategories[0].name);
    }
  }, [generatedCategories.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCategoryChange = useCallback((categoryName: string) => {
    setSelectedCategory(categoryName);
  }, []);

  const handleSelectTransformation = useCallback(
    (transformation: GeneratedTransformation) => {
      setActiveTransformationId(transformation.id);

      // Notify the chat that a grid card was clicked
      if (chat) {
        chat.notifyTransformationSelected(transformation);
      }

      // Also trigger generation directly via the existing pipeline
      generateMakeover({
        id: transformation.id,
        name: transformation.name,
        category: 'ai-generated',
        subcategory: 'chat',
        prompt: transformation.prompt,
        icon: transformation.icon,
        intensity: transformation.intensity,
        negativePrompt: transformation.negativePrompt,
      });
    },
    [generateMakeover, chat]
  );

  const handleBack = useCallback(() => {
    resetPhoto();
  }, [resetPhoto]);

  const handleToggleChat = useCallback(() => {
    if (chat) {
      chat.toggleChat();
    }
  }, [chat]);

  // Redirect to capture if no image is loaded
  useEffect(() => {
    if (!originalImageUrl) {
      setCurrentView('capture');
    }
  }, [originalImageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!originalImageUrl) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="relative flex h-full flex-col overflow-hidden"
    >
      {!authState.isAuthenticated && (
        <DemoBanner generationsRemaining={demoGenerationsRemaining} />
      )}

      <div className="studio-layout-with-chat min-h-0 flex-1">
        {/* Main studio area */}
        <div className="studio-layout min-h-0 flex-1">
          {/* Category sidebar */}
          <CategoryNav
            categories={generatedCategories}
            selectedCategory={selectedCategory}
            onSelectCategory={handleCategoryChange}
            isLoading={isCategoriesLoading}
          />

          {/* Main content */}
          <div className="studio-content">
            {/* Photo area */}
            <div className="studio-photo-area">
              <EditHistoryCarousel />

              {/* Enhancement progress overlay */}
              {enhanceProgress &&
                enhanceProgress.status !== 'completed' && (
                <GenerationProgress
                  progress={enhanceProgress}
                  onCancel={cancelEnhancement}
                  onDismiss={() => {/* enhancement progress clears on its own */}}
                  transformationName="Auto-Enhance"
                />
              )}

              {/* Generation progress overlay (also shown for error/cancelled so user sees feedback) */}
              {!isEnhancing && generationProgress &&
                generationProgress.status !== 'completed' && (
                <GenerationProgress
                  progress={generationProgress}
                  onCancel={cancelGeneration}
                  onDismiss={() => setGenerationProgress(null)}
                  transformationName={currentTransformation?.name}
                />
              )}
            </div>

            {/* Transformation picker */}
            <div className="flex min-h-0 flex-col overflow-hidden border-t border-primary-400/[0.06]">
              {/* Toolbar */}
              <div className="flex flex-shrink-0 items-center justify-between border-b border-primary-400/[0.06] px-3 py-1.5">
                {/* Left: navigation and mode controls */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleBack}
                    className="flex items-center gap-1 text-xs text-white/35 transition-colors hover:text-white/60"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                    </svg>
                    New Photo
                  </button>
                  {authState.isAuthenticated && history.length > 0 && (
                    <>
                      <span className="text-[10px] text-white/10">|</span>
                      <button
                        onClick={() => setCurrentView('history')}
                        className="flex items-center gap-1 text-xs text-white/35 transition-colors hover:text-white/60"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        History
                      </button>
                    </>
                  )}
                  {editStack.hasSteps && (
                    <>
                      <span className="text-[10px] text-white/10">|</span>
                      <div className="flex items-center rounded-full border border-primary-400/[0.06] bg-surface-900/40">
                        <button
                          onClick={() => editStack.setMode('original')}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            editStack.mode === 'original'
                              ? 'bg-primary-400/15 text-primary-300'
                              : 'text-white/35 hover:text-white/60'
                          }`}
                        >
                          Original
                        </button>
                        <button
                          onClick={() => editStack.setMode('stacked')}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            editStack.mode === 'stacked'
                              ? 'bg-primary-400/15 text-primary-300'
                              : 'text-white/35 hover:text-white/60'
                          }`}
                        >
                          Stacked
                        </button>
                      </div>
                    </>
                  )}
                  {(() => {
                    const displayTransformation = editStack.currentStep?.transformation ?? currentTransformation;
                    if (!displayTransformation) return null;
                    return (
                      <>
                        <span className="text-[10px] text-white/10">|</span>
                        <span className="text-[11px] text-primary-300/70">
                          {displayTransformation.icon} {displayTransformation.name}
                          {editStack.stepCount > 1 && (
                            <span className="ml-1 text-white/25">
                              ({Math.max(0, editStack.currentIndex + 1)} of {editStack.stepCount})
                            </span>
                          )}
                        </span>
                      </>
                    );
                  })()}
                </div>

                {/* Right: cost estimate + chat toggle */}
                <div className="flex items-center gap-2">
                  {authState.isAuthenticated && (
                    <div className="hidden items-center gap-1 sm:flex">
                      {costLoading ? (
                        <span className="text-[10px] text-white/25">...</span>
                      ) : tokenCost !== null ? (
                        <>
                          <span className="text-[10px] text-white/30">~</span>
                          <span className="text-[10px] font-medium text-white/50">
                            {formatTokenAmount(tokenCost)} {getTokenLabel(tokenType)}
                          </span>
                          {usdCost !== null && (
                            <span className="text-[10px] text-white/25">
                              ≈ ${usdCost.toFixed(2)}
                            </span>
                          )}
                        </>
                      ) : null}
                    </div>
                  )}

                  {/* Chat toggle button */}
                  {chat && (
                    <button
                      onClick={handleToggleChat}
                      className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all ${
                        chat.isChatOpen
                          ? 'bg-primary-400/15 text-primary-300'
                          : 'text-white/35 hover:bg-primary-400/[0.06] hover:text-white/60'
                      }`}
                      aria-label={chat.isChatOpen ? 'Close chat' : 'Open chat'}
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              <TransformationPicker
                categories={generatedCategories}
                selectedCategory={selectedCategory}
                onSelectTransformation={handleSelectTransformation}
                isDisabled={isGenerating || isEnhancing}
                activeTransformationId={activeTransformationId}
                isLoading={isCategoriesLoading}
              />
            </div>
          </div>
        </div>

        {/* Chat panel (slides in from right) */}
        {chat && (
          <ChatPanel
            messages={chat.messages}
            isStreaming={chat.isStreaming}
            isChatOpen={chat.isChatOpen}
            currentToolProgress={chat.currentToolProgress}
            onSendMessage={chat.sendMessage}
            onClose={chat.closeChat}
          />
        )}
      </div>
    </motion.div>
  );
}

export default MakeoverStudio;
