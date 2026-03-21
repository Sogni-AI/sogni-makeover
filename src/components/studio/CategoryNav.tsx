import { motion } from 'framer-motion';
import type { GeneratedCategory } from '@/types/chat';
import { getCategoryThumbnailId } from '@/services/thumbnailService';

interface CategoryNavProps {
  categories: GeneratedCategory[];
  selectedCategory: string;
  onSelectCategory: (categoryName: string) => void;
  isLoading: boolean;
  thumbnailUrls: Map<string, string>;
}

function CategoryNav({ categories, selectedCategory, onSelectCategory, isLoading, thumbnailUrls }: CategoryNavProps) {
  if (isLoading) {
    return (
      <nav className="studio-sidebar" aria-label="Transformation categories">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="category-card">
            <div className="category-thumbnail-placeholder animate-pulse" />
            <div className="h-3 w-full animate-pulse rounded bg-white/5" />
          </div>
        ))}
      </nav>
    );
  }

  return (
    <nav className="studio-sidebar" aria-label="Transformation categories">
      {categories.map((category) => {
        const isActive = selectedCategory === category.name;
        const thumbUrl = thumbnailUrls.get(getCategoryThumbnailId(category.name));
        return (
          <motion.button
            key={category.name}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onSelectCategory(category.name)}
            className={`category-card ${isActive ? 'active' : ''}`}
            aria-label={category.name}
            aria-current={isActive ? 'true' : undefined}
          >
            {category.isPopulating && (
              <motion.div
                className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary-400"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
            )}
            <div className="category-thumbnail-container">
              {thumbUrl ? (
                <img
                  src={thumbUrl}
                  alt={category.name}
                  className="category-thumbnail-image"
                  loading="lazy"
                />
              ) : (
                <span className="text-lg md:text-xl">{category.icon}</span>
              )}
            </div>
            <span className="category-card-label">
              {category.name}
            </span>
          </motion.button>
        );
      })}
    </nav>
  );
}

export default CategoryNav;
