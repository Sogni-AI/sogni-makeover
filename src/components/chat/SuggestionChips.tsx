interface SuggestionChipsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  disabled: boolean;
}

function SuggestionChips({ suggestions, onSelect, disabled }: SuggestionChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pb-2">
      {suggestions.map((suggestion, i) => (
        <button
          key={i}
          onClick={() => onSelect(suggestion)}
          disabled={disabled}
          className="rounded-full border border-primary-400/10 bg-surface-800/40 px-3 py-1 text-xs text-white/50 transition-all hover:border-primary-400/25 hover:bg-primary-400/[0.06] hover:text-white/70 disabled:opacity-30"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

export default SuggestionChips;
