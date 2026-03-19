import { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ChatMessage from '@/components/chat/ChatMessage';
import ChatInput from '@/components/chat/ChatInput';
import SuggestionChips from '@/components/chat/SuggestionChips';
import type { ChatMessage as ChatMessageType, ToolProgress } from '@/types/chat';

interface ChatPanelProps {
  messages: ChatMessageType[];
  isStreaming: boolean;
  isChatOpen: boolean;
  currentToolProgress: ToolProgress | null;
  onSendMessage: (text: string) => void;
  onClose: () => void;
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
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Get suggestions from the latest assistant message or use defaults
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && !m.isStreaming);
  const suggestions = lastAssistant?.suggestions || (messages.length <= 1 ? defaultSuggestions : []);

  return (
    <AnimatePresence>
      {isChatOpen && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="chat-panel flex h-full flex-col border-l border-primary-400/[0.06] bg-surface-950/95 backdrop-blur-sm"
        >
          {/* Header */}
          <div className="flex flex-shrink-0 items-center justify-between border-b border-primary-400/[0.06] px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-base">💇</span>
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
          <div className="flex-1 overflow-y-auto px-3 py-3">
            <div className="flex flex-col gap-3">
              {messages
                .filter((m) => m.role !== 'tool' && m.role !== 'system')
                .map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    toolProgress={
                      message.isStreaming ? currentToolProgress : null
                    }
                  />
                ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Suggestions */}
          <SuggestionChips
            suggestions={suggestions}
            onSelect={onSendMessage}
            disabled={isStreaming}
          />

          {/* Input */}
          <ChatInput
            onSend={onSendMessage}
            disabled={isStreaming}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default ChatPanel;
