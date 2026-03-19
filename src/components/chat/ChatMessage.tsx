import { motion } from 'framer-motion';
import type { ChatMessage as ChatMessageType, ToolProgress } from '@/types/chat';

interface ChatMessageProps {
  message: ChatMessageType;
  toolProgress?: ToolProgress | null;
}

function ChatMessage({ message, toolProgress }: ChatMessageProps) {
  if (message.role === 'tool' || message.role === 'system') return null;

  const isUser = message.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-primary-400/15 text-primary-100'
            : 'bg-surface-800/60 text-white/80'
        }`}
      >
        {message.content || (message.isStreaming ? (
          <span className="inline-flex items-center gap-1">
            <span className="animate-pulse">...</span>
          </span>
        ) : null)}

        {/* Tool progress indicator */}
        {toolProgress && !isUser && message.isStreaming && (
          <div className="mt-2 flex items-center gap-2 text-xs text-white/40">
            {toolProgress.status === 'running' && (
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            {toolProgress.message}
          </div>
        )}

        {/* Inline result thumbnails */}
        {message.imageResults && message.imageResults.length > 0 && (
          <div className="mt-2 flex gap-2">
            {message.imageResults.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Result ${i + 1}`}
                className="h-20 w-20 rounded-lg object-cover"
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default ChatMessage;
