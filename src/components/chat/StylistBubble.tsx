import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { parseMessageContent } from './ChatMessage';
import SuggestionChips from './SuggestionChips';
import type { ChatMessage as ChatMessageType } from '@/types/chat';

const DEFAULT_SUGGESTIONS = [
  'Show me dramatic looks',
  'Something subtle and professional',
  "Let's go wild!",
  'Change my hairstyle',
];

const AUTO_DISMISS_MS = 8000;
const MIN_DISPLAY_MS = 3000;

interface StylistBubbleProps {
  messages: ChatMessageType[];
  isStreaming: boolean;
  isChatOpen: boolean;
  unreadCount: number;
  onSendMessage: (text: string) => void;
  onOpen: () => void;
  onClose: () => void;
  onSelectCategory?: (categoryName: string) => void;
  onHighlightTransformation?: (transformationName: string) => void;
}

function StylistBubble({
  messages,
  isStreaming,
  isChatOpen,
  unreadCount,
  onSendMessage,
  onOpen,
  onClose,
  onSelectCategory,
  onHighlightTransformation,
}: StylistBubbleProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [displayedMessage, setDisplayedMessage] = useState<ChatMessageType | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayedAtRef = useRef<number>(0);
  const pendingMessageRef = useRef<ChatMessageType | null>(null);

  // Filter to only assistant messages
  const filteredMessages = messages.filter((msg) => {
    if (msg.role === 'tool' || msg.role === 'system') return false;
    if (msg.role === 'user') return false;
    if (!msg.content?.trim() && !msg.isStreaming && !msg.imageResults?.length && !msg.isToolProgress)
      return false;
    return true;
  });

  const latestMessage = filteredMessages.length > 0 ? filteredMessages[filteredMessages.length - 1] : null;

  const latestNonStreamingAssistant = [...messages]
    .reverse()
    .find((msg) => msg.role === 'assistant' && !msg.isStreaming && !msg.isToolProgress);

  const suggestions =
    latestNonStreamingAssistant?.suggestions && latestNonStreamingAssistant.suggestions.length > 0
      ? latestNonStreamingAssistant.suggestions
      : messages.length <= 1
        ? DEFAULT_SUGGESTIONS
        : [];

  // --- Message hold timer (min display time) ---

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const showMessage = useCallback((msg: ChatMessageType) => {
    setDisplayedMessage(msg);
    displayedAtRef.current = Date.now();
    pendingMessageRef.current = null;
    clearHoldTimer();
  }, [clearHoldTimer]);

  useEffect(() => {
    if (!latestMessage) return;
    if (displayedMessage && latestMessage.id === displayedMessage.id) {
      setDisplayedMessage(latestMessage);
      return;
    }
    if (!displayedMessage) {
      showMessage(latestMessage);
      return;
    }
    const elapsed = Date.now() - displayedAtRef.current;
    if (elapsed >= MIN_DISPLAY_MS) {
      showMessage(latestMessage);
    } else {
      pendingMessageRef.current = latestMessage;
      clearHoldTimer();
      holdTimerRef.current = setTimeout(() => {
        if (pendingMessageRef.current) {
          showMessage(pendingMessageRef.current);
        }
      }, MIN_DISPLAY_MS - elapsed);
    }
  }, [latestMessage?.id, latestMessage?.content]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return clearHoldTimer;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Dismiss timer ---

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const startDismissTimer = useCallback(() => {
    clearDismissTimer();
    dismissTimerRef.current = setTimeout(() => {
      setIsExpanded(false);
      onClose();
    }, AUTO_DISMISS_MS);
  }, [clearDismissTimer, onClose]);

  useEffect(() => {
    if (filteredMessages.length === 0) return;
    setIsExpanded(true);
    onOpen();
  }, [filteredMessages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isStreaming) {
      setIsExpanded(true);
      clearDismissTimer();
    }
  }, [isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isStreaming && displayedMessage) {
      // On mobile, chat persists — don't auto-dismiss
      if (!window.matchMedia('(max-width: 767px)').matches) {
        startDismissTimer();
      }
    }
    return clearDismissTimer;
  }, [isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isChatOpen) {
      setIsExpanded(true);
      clearDismissTimer();
    }
  }, [isChatOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return clearDismissTimer;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Handlers ---

  const toggleExpand = useCallback(() => {
    // On mobile, chat persists — don't toggle
    if (window.matchMedia('(max-width: 767px)').matches) return;
    setIsExpanded((prev) => {
      const next = !prev;
      if (next) {
        clearDismissTimer();
        onOpen();
      } else {
        clearDismissTimer();
        onClose();
      }
      return next;
    });
  }, [clearDismissTimer, onOpen, onClose]);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;
    onSendMessage(trimmed);
    setInputValue('');
    clearDismissTimer();
  }, [inputValue, isStreaming, onSendMessage, clearDismissTimer]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInputFocus = useCallback(() => {
    clearDismissTimer();
  }, [clearDismissTimer]);

  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

  return (
    <div className={`stylist-bubble${isMobile && isExpanded && displayedMessage ? ' stylist-bubble--active' : ''}`}>
      {/* Dark gradient scrim — desktop only, visible when card is expanded */}
      <AnimatePresence>
        {isExpanded && displayedMessage && (
          <motion.div
            key="stylist-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="stylist-scrim"
          />
        )}
      </AnimatePresence>

      {/* Mascot — always anchored to bottom-right, never moves */}
      <button className="stylist-mascot-btn" onClick={toggleExpand} aria-label="Toggle AI stylist">
        <img src="/images/mascot.png" alt="AI Stylist" />
        {!isExpanded && unreadCount > 0 && (
          <span className="stylist-unread-dot" />
        )}
      </button>

      {/* Speech card — floats above mascot */}
      <AnimatePresence>
        {isExpanded && displayedMessage && (
          <motion.div
            key="stylist-card"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="stylist-card"
          >
            {/* Message area */}
            <div className="stylist-card-message">
              <div className="stylist-card-message-content">
                {displayedMessage.isToolProgress ? (
                  <div className="flex items-center gap-2 text-xs text-white/40">
                    {displayedMessage.isToolDone ? (
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none">
                        <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                      </svg>
                    )}
                    {displayedMessage.content}
                  </div>
                ) : (
                  <div className="whitespace-pre-line text-sm leading-relaxed text-white/80">
                    {displayedMessage.content
                      ? parseMessageContent(displayedMessage.content, onSelectCategory, onHighlightTransformation)
                      : displayedMessage.isStreaming
                        ? <span className="animate-pulse text-white/40">...</span>
                        : null}
                  </div>
                )}
              </div>
            </div>

            {/* Suggestion chips */}
            {suggestions.length > 0 && (
              <div className="stylist-card-chips">
                <SuggestionChips
                  suggestions={suggestions}
                  onSelect={onSendMessage}
                  disabled={isStreaming}
                />
              </div>
            )}

            {/* Input */}
            <div className="stylist-card-input">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={handleInputFocus}
                placeholder="Ask your stylist..."
                disabled={isStreaming}
              />
              <button
                onClick={handleSend}
                disabled={isStreaming || !inputValue.trim()}
                aria-label="Send message"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default StylistBubble;
