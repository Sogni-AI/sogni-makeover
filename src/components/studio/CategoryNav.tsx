import { motion } from 'framer-motion';
import type { GeneratedCategory } from '@/types/chat';

interface CategoryNavProps {
  categories: GeneratedCategory[];
  selectedCategory: string;
  onSelectCategory: (categoryName: string) => void;
  isLoading: boolean;
}

function CategoryNav({ categories, selectedCategory, onSelectCategory, isLoading }: CategoryNavProps) {
  if (isLoading) {
    return (
      <nav className="studio-sidebar" aria-label="Transformation categories">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1 rounded-xl px-2 py-3">
            <div className="h-6 w-6 animate-pulse rounded-lg bg-white/5" />
            <div className="h-3 w-12 animate-pulse rounded bg-white/5" />
          </div>
        ))}
      </nav>
    );
  }

  return (
    <nav className="studio-sidebar" aria-label="Transformation categories">
      {categories.map((category) => {
        const isActive = selectedCategory === category.name;
        return (
          <motion.button
            key={category.name}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onSelectCategory(category.name)}
            className={`relative flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-center transition-all md:px-3 ${
              isActive
                ? 'bg-primary-400/8 text-primary-300'
                : 'text-white/35 hover:bg-primary-400/[0.04] hover:text-white/50'
            }`}
            aria-label={category.name}
            aria-current={isActive ? 'true' : undefined}
          >
            {isActive && (
              <motion.div
                layoutId="category-highlight"
                className="absolute inset-0 rounded-xl border border-primary-400/15 bg-primary-400/[0.04]"
                transition={{ duration: 0.25, ease: 'easeInOut' }}
              />
            )}
            <span className="relative text-lg md:text-xl">{category.icon}</span>
            <span className="relative text-center text-[10px] font-medium leading-tight md:text-xs">
              {category.name}
            </span>
          </motion.button>
        );
      })}
    </nav>
  );
}

export default CategoryNav;
