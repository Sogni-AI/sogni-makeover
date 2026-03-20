import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useApp } from '@/context/AppContext';
import type { GeneratedTransformation } from '@/types/chat';
import { useChat } from '@/hooks/useChat';
import CategoryNav from '@/components/studio/CategoryNav';
import TransformationPicker from '@/components/studio/TransformationPicker';
import EditHistoryCarousel from '@/components/studio/EditHistoryCarousel';
import GenerationProgress from '@/components/studio/GenerationProgress';
import ChatPanel from '@/components/chat/ChatPanel';
import DemoBanner from '@/components/auth/DemoBanner';
import { useMakeoverCostEstimate } from '@/hooks/useMakeoverCostEstimate';
import { useWallet } from '@/hooks/useWallet';
import { formatTokenAmount, getTokenLabel } from '@/services/walletService';
import { saveSession } from '@/utils/makeoverSessionDb';
import '@/styles/studio.css';

function MakeoverStudio() {
  const {
    originalImageUrl,
    originalImageBase64,
    setCurrentView,
    resetPhoto,
    isGenerating,
    generationProgress,
    setGenerationProgress,
    cancelGeneration,
    generateMakeover,
    generateFromPrompt,
    currentTransformation,
    authState,
    demoGenerationsRemaining,
    history,
    enhanceProgress,
    isEnhancing,
    cancelEnhancement,
    editStack,
    sogniClient,
    isResumedSession,
    saveSessionRef,
    pendingResumeData,
    clearPendingResumeData,
    selectedGender,
  } = useApp();

  const { tokenCost, usdCost, isLoading: costLoading } = useMakeoverCostEstimate();
  const { tokenType } = useWallet();

  // Stable function refs for useChat to avoid stale closures
  const editStackRef = useRef(editStack);
  editStackRef.current = editStack;
  const isGeneratingRef = useRef(isGenerating);
  isGeneratingRef.current = isGenerating;
  const currentResultUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const step = editStack.currentStep;
    currentResultUrlRef.current = step?.resultImageUrl ?? null;
  }, [editStack.currentStep]);

  const selectedGenderRef = useRef(selectedGender);
  selectedGenderRef.current = selectedGender;

  // Initialize chat hook
  const chat = useChat({
    sogniClient,
    originalImageUrl,
    originalImageBase64,
    getCurrentResultUrl: () => currentResultUrlRef.current,
    getEditStack: () => editStackRef.current.steps,
    getEditStackDepth: () => editStackRef.current.stepCount,
    isGenerating: () => isGeneratingRef.current,
    generateFromPrompt,
    onCategoryRecommended: (categoryName: string) => {
      setSelectedCategory(categoryName);
    },
  });

  // Use generated categories from chat
  const generatedCategories = chat.generatedCategories;
  const isCategoriesLoading = chat.isStreaming && generatedCategories.length === 0;

  const chatMessagesRef = useRef(chat.messages);
  chatMessagesRef.current = chat.messages;
  const chatPhotoAnalysisRef = useRef(chat.photoAnalysis);
  chatPhotoAnalysisRef.current = chat.photoAnalysis;
  const chatGeneratedCategoriesRef = useRef(chat.generatedCategories);
  chatGeneratedCategoriesRef.current = chat.generatedCategories;

  useEffect(() => {
    saveSessionRef.current = (latestBase64?: string) => {
      if (!originalImageBase64) return;
      // Patch the latest step's base64 if provided — editStackRef is stale
      // when called synchronously after editStack.updateLatestBase64()
      const steps = [...editStackRef.current.steps];
      const idx = editStackRef.current.currentIndex;
      if (latestBase64 && idx >= 0 && idx < steps.length) {
        steps[idx] = { ...steps[idx], resultImageBase64: latestBase64 };
      }
      saveSession({
        version: 1,
        originalImageBase64,
        editStack: {
          steps,
          currentIndex: idx,
          mode: editStackRef.current.mode,
        },
        chatMessages: chatMessagesRef.current,
        photoAnalysis: chatPhotoAnalysisRef.current,
        generatedCategories: chatGeneratedCategoriesRef.current,
        selectedGender: selectedGenderRef.current,
        timestamp: Date.now(),
      });
    };
    return () => { saveSessionRef.current = null; };
  }, [originalImageBase64]); // eslint-disable-line react-hooks/exhaustive-deps

  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [activeTransformationId, setActiveTransformationId] = useState<string | null>(null);
  const [showAutoPilotTip, setShowAutoPilotTip] = useState(false);

  // Trigger photo analysis + AI greeting when studio mounts with a photo
  const initTriggered = useRef(false);
  useEffect(() => {
    if (originalImageUrl && !initTriggered.current) {
      initTriggered.current = true;
      if (isResumedSession) {
        return;
      }
      chat.initWithPhoto(originalImageUrl);
    }
  }, [originalImageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isResumedSession && pendingResumeData) {
      chat.restoreSession({
        messages: pendingResumeData.chatMessages,
        photoAnalysis: pendingResumeData.photoAnalysis,
        generatedCategories: pendingResumeData.generatedCategories,
      });
      clearPendingResumeData();
    }
  }, [isResumedSession, pendingResumeData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync selected category when categories arrive
  useEffect(() => {
    if (generatedCategories.length > 0 && !selectedCategory) {
      setSelectedCategory(generatedCategories[0].name);
    }
  }, [generatedCategories.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger auto-analysis when generation completes
  const prevGeneratingRef = useRef(false);
  useEffect(() => {
    const wasGenerating = prevGeneratingRef.current;
    prevGeneratingRef.current = isGenerating;

    if (wasGenerating && !isGenerating && editStack.currentStep) {
      const step = editStack.currentStep;
      chat.notifyGenerationComplete(
        { name: step.transformation.name, prompt: step.transformation.prompt },
        step.resultImageUrl
      );
    }
  }, [isGenerating]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCategoryChange = useCallback((categoryName: string) => {
    setSelectedCategory(categoryName);
  }, []);

  const handleSelectTransformation = useCallback(
    (transformation: GeneratedTransformation) => {
      setActiveTransformationId(transformation.id);

      // Add informational message to chat (no LLM invocation)
      chat.notifyTransformationSelected(transformation);

      // Trigger generation directly via the existing pipeline
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
    chat.toggleChat();
  }, [chat]);

  const handleChatSelectCategory = useCallback((categoryName: string) => {
    setSelectedCategory(categoryName);
  }, []);

  const handleChatHighlightTransformation = useCallback((transformationName: string) => {
    // Find which category contains this transformation by name and select it
    const category = generatedCategories.find(c =>
      c.transformations.some(t => t.name === transformationName)
    );
    if (category) {
      setSelectedCategory(category.name);
      const transformation = category.transformations.find(t => t.name === transformationName);
      if (transformation) {
        setActiveTransformationId(transformation.id);
      }
    }
  }, [generatedCategories]);

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

                  {/* Auto-Pilot toggle */}
                  <div className="relative flex items-center gap-1.5">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={chat.isAutoPilot}
                        onChange={chat.toggleAutoPilot}
                        className="peer sr-only"
                      />
                      <div className="relative h-4 w-7 rounded-full bg-white/10 transition-colors after:absolute after:left-[2px] after:top-1/2 after:-translate-y-1/2 after:h-3 after:w-3 after:rounded-full after:bg-white/40 after:transition-all peer-checked:bg-primary-400/30 peer-checked:after:translate-x-3 peer-checked:after:bg-primary-300" />
                      <span className={`text-[10px] font-medium transition-colors ${chat.isAutoPilot ? 'text-primary-300/70' : 'text-white/35'}`}>
                        Auto-Pilot
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowAutoPilotTip((prev) => !prev)}
                      onBlur={() => setShowAutoPilotTip(false)}
                      className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/5 text-[8px] font-bold text-white/25 transition-colors hover:bg-white/10 hover:text-white/40"
                      aria-label="What is Auto-Pilot?"
                    >
                      i
                    </button>
                    {showAutoPilotTip && (
                      <div className="absolute right-0 top-full z-50 mt-1.5 w-56 rounded-lg border border-primary-400/10 bg-surface-800 p-2.5 text-[11px] leading-relaxed text-white/60 shadow-lg">
                        Let your stylist iterate automatically on your look for up to 6 transformations. The stylist will analyze each result, refresh the options, and apply the next look it recommends.
                      </div>
                    )}
                  </div>

                  {/* Chat toggle button */}
                  <button
                    onClick={handleToggleChat}
                    className={`relative flex h-7 w-7 items-center justify-center rounded-lg transition-all ${
                      chat.isChatOpen
                        ? 'bg-primary-400/15 text-primary-300'
                        : 'text-white/35 hover:bg-primary-400/[0.06] hover:text-white/60'
                    }`}
                    aria-label={chat.isChatOpen ? 'Close chat' : 'Open chat'}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                    </svg>
                    {chat.unreadCount > 0 && !chat.isChatOpen && (
                      <span className="absolute -top-1 -right-1 flex h-3 w-3">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75" />
                        <span className="relative inline-flex h-3 w-3 rounded-full bg-primary-400" />
                      </span>
                    )}
                  </button>
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
        <ChatPanel
          messages={chat.messages}
          isStreaming={chat.isStreaming}
          isChatOpen={chat.isChatOpen}
          unreadCount={chat.unreadCount}
          currentToolProgress={chat.currentToolProgress}
          onSendMessage={chat.sendMessage}
          onOpen={chat.openChat}
          onClose={chat.closeChat}
          onSelectCategory={handleChatSelectCategory}
          onHighlightTransformation={handleChatHighlightTransformation}
        />
      </div>
    </motion.div>
  );
}

export default MakeoverStudio;
