import { useRef, useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ChatMessage from '@/components/chat/ChatMessage';
import ChatInput from '@/components/chat/ChatInput';
import SuggestionChips from '@/components/chat/SuggestionChips';
import type { ChatMessage as ChatMessageType, ToolProgress } from '@/types/chat';

const MOBILE_BREAKPOINT = 768;

interface ChatPanelProps {
  messages: ChatMessageType[];
  isStreaming: boolean;
  isChatOpen: boolean;
  currentToolProgress: ToolProgress | null;
  onSendMessage: (text: string) => void;
  onClose: () => void;
  onSelectCategory?: (categoryName: string) => void;
  onHighlightTransformation?: (transformationName: string) => void;
}

const defaultSuggestions = [
  'Show me dramatic looks',
  'Something subtle and professional',
  'Let\'s go wild!',
  'Change my hairstyle',
];

function ChatPanel({
  messages,
  isStreaming,
  isChatOpen,
  currentToolProgress,
  onSendMessage,
  onClose,
  onSelectCategory,
  onHighlightTransformation,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const PAGE_SIZE = 20;
  const visibleMessages = messages.filter((m) => m.role !== 'tool' && m.role !== 'system');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Reset visible count when the first message changes (new session)
  const firstMessageId = visibleMessages.length > 0 ? visibleMessages[0]?.id : null;
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [firstMessageId]);

  const paginatedMessages = visibleMessages.slice(
    Math.max(0, visibleMessages.length - visibleCount),
  );
  const hasMore = visibleCount < visibleMessages.length;

  const visibleCountTotalRef = useRef(visibleMessages.length);
  visibleCountTotalRef.current = visibleMessages.length;

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (el.scrollTop < 50) {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, visibleCountTotalRef.current));
    }
  }, []);

  // Auto-scroll when a new message is added (not on every streaming token)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Get suggestions from the latest assistant message or use defaults
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && !m.isStreaming);
  const suggestions = lastAssistant?.suggestions || (messages.length <= 1 ? defaultSuggestions : []);

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT;

  const handleCategoryFromMessage = useCallback((name: string) => {
    onSelectCategory?.(name);
    if (window.innerWidth <= MOBILE_BREAKPOINT) {
      onClose();
    }
  }, [onSelectCategory, onClose]);

  const handleTransformationFromMessage = useCallback((name: string) => {
    onHighlightTransformation?.(name);
    if (window.innerWidth <= MOBILE_BREAKPOINT) {
      onClose();
    }
  }, [onHighlightTransformation, onClose]);

  return (
    <AnimatePresence>
      {isChatOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={onClose}
          />
          <motion.div
            initial={isMobile ? { y: '100%', opacity: 0 } : { x: '100%', opacity: 0 }}
            animate={{ x: 0, y: 0, opacity: 1 }}
            exit={isMobile ? { y: '100%', opacity: 0 } : { x: '100%', opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="chat-panel relative flex h-full flex-col overflow-x-clip md:border-l border-primary-400/[0.06] bg-surface-950/95 backdrop-blur-sm"
          >
            <div className="flex justify-center py-2 md:hidden">
              <div className="h-1 w-8 rounded-full bg-white/20" />
            </div>

            {/* Header */}
            <div className="relative z-10 flex flex-shrink-0 items-center justify-between border-b border-primary-400/[0.06] px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/60">Your Stylist</span>
              </div>
              <button
                onClick={onClose}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/5 hover:text-white/60"
                aria-label="Close chat"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Messages */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="relative z-10 flex-1 overflow-y-auto px-3 py-3"
            >
              <div className="flex flex-col gap-3">
                {hasMore && (
                  <button
                    onClick={() => setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, visibleMessages.length))}
                    className="self-center rounded-full bg-white/5 px-3 py-1 text-[10px] text-white/40 transition-colors hover:bg-white/10 hover:text-white/60"
                  >
                    Load earlier messages
                  </button>
                )}
                {paginatedMessages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    toolProgress={
                      message.isStreaming ? currentToolProgress : null
                    }
                    onSelectCategory={handleCategoryFromMessage}
                    onSelectTransformation={handleTransformationFromMessage}
                  />
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Suggestions */}
            <div className="relative z-10">
              <SuggestionChips
                suggestions={suggestions}
                onSelect={onSendMessage}
                disabled={isStreaming}
              />
            </div>

            {/* Input with mascot anchored to its top edge */}
            <div className="relative flex-shrink-0">
              <img
                src="/images/mascot.png"
                alt="Stylist"
                className="pointer-events-none absolute bottom-full -right-4 w-1/3 max-w-[100px] md:-right-8 md:w-3/4 md:max-w-[200px]"
              />
              <div className="relative z-10">
                <ChatInput
                  onSend={onSendMessage}
                  disabled={isStreaming}
                />
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default ChatPanel;
