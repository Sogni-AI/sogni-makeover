import type { ReactNode } from 'react';
import { Fragment } from 'react';
import { motion } from 'framer-motion';
import type { ChatMessage as ChatMessageType } from '@/types/chat';

interface ChatMessageProps {
  message: ChatMessageType;
  onSelectCategory?: (name: string) => void;
  onSelectTransformation?: (name: string) => void;
}

/**
 * Renders inline markdown (bold and italic) within a plain text string.
 */
function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode {
  // Match **bold** and *italic* (bold first to avoid conflicts)
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      // Strip orphaned ** markers (from bold spanning across link tokens)
      parts.push(text.slice(lastIndex, match.index).replace(/\*\*/g, ''));
    }

    if (match[1] !== undefined) {
      parts.push(<strong key={`${keyPrefix}-b-${match.index}`}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      parts.push(<em key={`${keyPrefix}-i-${match.index}`}>{match[2]}</em>);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex).replace(/\*\*/g, ''));
  }

  return parts.length > 1 ? <Fragment>{parts}</Fragment> : parts[0] ?? text;
}

/**
 * Parses message content for [category:Name] and [option:Name] tokens,
 * rendering them as clickable styled buttons, and renders inline markdown.
 */
function parseMessageContent(
  content: string,
  onSelectCategory?: (name: string) => void,
  onSelectTransformation?: (name: string) => void
): ReactNode {
  const linkPattern = /\[(category|option):([^\]]+)\]/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = linkPattern.exec(content)) !== null) {
    // Add text before the match (with markdown rendering)
    if (match.index > lastIndex) {
      parts.push(
        <Fragment key={`text-${lastIndex}`}>
          {renderInlineMarkdown(content.slice(lastIndex, match.index), `t-${lastIndex}`)}
        </Fragment>
      );
    }

    const type = match[1]; // 'category' or 'option'
    const name = match[2]; // the display name

    parts.push(
      <button
        key={`${type}-${match.index}`}
        onClick={() => {
          if (type === 'category') {
            onSelectCategory?.(name);
          } else {
            onSelectTransformation?.(name);
          }
        }}
        className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs font-medium transition-colors ${
          type === 'category'
            ? 'bg-primary-400/10 text-primary-300 hover:bg-primary-400/20'
            : 'bg-secondary-400/10 text-secondary-300 hover:bg-secondary-400/20'
        }`}
      >
        {name}
      </button>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text (with markdown rendering)
  if (lastIndex < content.length) {
    parts.push(
      <Fragment key={`text-${lastIndex}`}>
        {renderInlineMarkdown(content.slice(lastIndex), `t-${lastIndex}`)}
      </Fragment>
    );
  }

  return parts.length > 0 ? parts : renderInlineMarkdown(content, 'root');
}

function ChatMessage({ message, onSelectCategory, onSelectTransformation }: ChatMessageProps) {
  if (message.role === 'tool' || message.role === 'system') return null;

  const isUser = message.role === 'user';

  // Tool progress messages get compact styling with spinner/check
  if (message.isToolProgress) {
    const isDone = message.content === 'Done!' || message.content === 'Failed';
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex justify-start"
      >
        <div className="flex items-center gap-2 rounded-xl bg-surface-800/50 px-3 py-1.5 text-xs text-white/40">
          {!isDone ? (
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          ) : (
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none">
              <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {message.content}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-primary-400/20 text-primary-100'
            : 'bg-surface-800/80 text-white/80'
        }`}
      >
        {message.content ? parseMessageContent(message.content, onSelectCategory, onSelectTransformation) : (message.isStreaming ? (
          <span className="inline-flex items-center gap-1">
            <span className="animate-pulse">...</span>
          </span>
        ) : null)}

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
