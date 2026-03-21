/**
 * Hook to manage thumbnail generation for transformation cards.
 *
 * Generates thumbnails for the currently selected category first,
 * then background-generates for other categories.
 * Caches results so switching categories is instant.
 * Resets cache when categories are fully replaced (e.g., LLM refresh).
 * Appends subject context (skin tone, age) to prompts for visual matching.
 * Supports restoring cached thumbnails from a persisted session.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { GeneratedCategory, PhotoAnalysis } from '@/types/chat';
import {
  generateThumbnailBatch,
  buildSubjectContext,
  getTransformationThumbnailPrompt,
} from '@/services/thumbnailService';

interface UseThumbnailsOptions {
  categories: GeneratedCategory[];
  selectedCategory: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sogniClient: any;
  photoAnalysis: PhotoAnalysis | null;
  /** Restored thumbnail cache from a persisted session (id -> url) */
  initialCache?: Record<string, string> | null;
}

export interface UseThumbnailsReturn {
  /** Map of transformationId -> thumbnail image URL */
  thumbnailUrls: Map<string, string>;
  /** Serializable snapshot of all cached URLs for session persistence */
  cacheSnapshot: () => Record<string, string>;
}

export function useThumbnails({
  categories,
  selectedCategory,
  sogniClient,
  photoAnalysis,
  initialCache,
}: UseThumbnailsOptions): UseThumbnailsReturn {
  const [thumbnailUrls, setThumbnailUrls] = useState<Map<string, string>>(() => {
    if (initialCache) {
      return new Map(Object.entries(initialCache));
    }
    return new Map();
  });

  // Track which IDs have been queued (to avoid re-generating)
  const queuedIdsRef = useRef<Set<string>>(
    initialCache ? new Set(Object.keys(initialCache)) : new Set()
  );

  // Abort controller for cleanup
  const abortRef = useRef<AbortController | null>(null);

  // Stable primitive key derived from all transformation IDs + category names.
  const categoriesKey = useMemo(() => {
    const catKeys = categories.map((c) => c.name).join('|');
    const tKeys = categories.flatMap((c) => c.transformations.map((t) => t.id)).join(',');
    return `${catKeys}::${tKeys}`;
  }, [categories]);

  // Track the previous key to detect full replacement
  const prevKeyRef = useRef(categoriesKey);

  // Memoize subject context so it only changes when photoAnalysis changes
  const subjectContext = useMemo(() => buildSubjectContext(photoAnalysis), [photoAnalysis]);

  const handleResult = useCallback((result: { id: string; url: string }) => {
    setThumbnailUrls((prev) => {
      const next = new Map(prev);
      next.set(result.id, result.url);
      return next;
    });
  }, []);

  /** Serialize the current cache for session persistence */
  const cacheSnapshot = useCallback((): Record<string, string> => {
    return Object.fromEntries(thumbnailUrls);
  }, [thumbnailUrls]);

  // Generate thumbnails when categories change or selectedCategory changes
  useEffect(() => {
    if (categories.length === 0) return;

    // Detect full category replacement
    if (prevKeyRef.current !== categoriesKey) {
      const currentIds = new Set(categories.flatMap((c) => c.transformations.map((t) => t.id)));
      const anyOverlap = [...queuedIdsRef.current].some((id) => currentIds.has(id));
      if (!anyOverlap && queuedIdsRef.current.size > 0) {
        queuedIdsRef.current = new Set();
        setThumbnailUrls(new Map());
      }
      prevKeyRef.current = categoriesKey;
    }

    // Abort any previous batch
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Build transformation items, prioritizing the selected category
    const selectedCat = categories.find((c) => c.name === selectedCategory);
    const otherCats = categories.filter((c) => c.name !== selectedCategory);

    const priorityItems = (selectedCat?.transformations ?? [])
      .filter((t) => !queuedIdsRef.current.has(t.id))
      .map((t) => ({
        id: t.id,
        prompt: getTransformationThumbnailPrompt(t, subjectContext),
      }));

    const backgroundItems = otherCats
      .flatMap((c) => c.transformations)
      .filter((t) => !queuedIdsRef.current.has(t.id))
      .map((t) => ({
        id: t.id,
        prompt: getTransformationThumbnailPrompt(t, subjectContext),
      }));

    // Mark all as queued
    const allItems = [...priorityItems, ...backgroundItems];
    for (const item of allItems) {
      queuedIdsRef.current.add(item.id);
    }

    if (allItems.length === 0) return;

    (async () => {
      // Generate selected category transformations first
      if (priorityItems.length > 0) {
        await generateThumbnailBatch(priorityItems, sogniClient, handleResult, controller.signal);
      }
      // Then background transformations
      if (backgroundItems.length > 0 && !controller.signal.aborted) {
        await generateThumbnailBatch(backgroundItems, sogniClient, handleResult, controller.signal);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [categoriesKey, selectedCategory]);

  return { thumbnailUrls, cacheSnapshot };
}
