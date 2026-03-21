import { toolRegistry } from '@/services/toolRegistry';
import type { ToolResult, MakeoverToolContext } from '@/types/chat';
import { generateTransformations, generateCategoryShells, generateCategoryOptions } from '@/services/transformationService';

const definition = {
  type: 'function' as const,
  function: {
    name: 'generate_transformations',
    description: 'Generate personalized transformation options for the grid based on what the client is looking for. Call this after understanding their intent.',
    parameters: {
      type: 'object',
      properties: {
        intent: { type: 'string', description: 'What the client is looking for, e.g. "dramatic hair changes" or "subtle professional look"' },
        count: { type: 'number', description: 'Number of options to generate, default 8-12' },
        mode: { type: 'string', enum: ['refresh', 'expand'], description: 'refresh = reorganize grid based on current look, expand = add more options to existing grid' },
        currentLook: { type: 'string', description: 'Description of what the client currently looks like after recent transformations' },
        phase: { type: 'string', enum: ['categories', 'options'], description: 'categories = generate category shells only (fast), options = generate options for a specific category' },
        categoryName: { type: 'string', description: 'Category name to populate with options (required when phase is "options")' },
      },
      required: ['intent', 'mode'],
    },
  },
};

async function handler(
  args: Record<string, unknown>,
  context: MakeoverToolContext
): Promise<ToolResult> {
  const intent = String(args.intent || 'general makeover options');
  const mode = (args.mode as string) || 'refresh';
  const currentLook = args.currentLook as string | undefined;
  const phase = args.phase as string | undefined;
  const categoryName = args.categoryName as string | undefined;
  const photoAnalysis = context.getPhotoAnalysis();
  const sogniClient = context.getSogniClient();

  try {
    if (phase === 'categories') {
      const result = await generateCategoryShells(photoAnalysis, intent, sogniClient, {
        mode: mode as 'refresh' | 'expand',
        currentCategories: context.getCurrentCategories(),
      });
      return { success: true, data: { categories: result.categories, recommendedCategory: result.recommendedCategory, mode, phase: 'categories' } };
    }

    if (phase === 'options') {
      if (!categoryName) {
        return { success: false, error: 'categoryName is required when phase is "options"' };
      }
      // Find the category description from current categories
      const currentCategories = context.getCurrentCategories();
      const category = currentCategories.find(c => c.name === categoryName);
      const categoryDescription = category?.description || categoryName;

      const transformations = await generateCategoryOptions(photoAnalysis, categoryName, categoryDescription, sogniClient, {
        currentLook,
      });
      return { success: true, data: { categoryName, transformations, phase: 'options' } };
    }

    // Backward compatibility: no phase provided, use full generation
    const result = await generateTransformations(photoAnalysis, intent, sogniClient, {
      mode: mode as 'refresh' | 'expand',
      currentLook,
      currentCategories: context.getCurrentCategories(),
    });
    return { success: true, data: { categories: result.categories, recommendedCategory: result.recommendedCategory, mode, hint: 'Reference categories and options using bracket syntax: [category:Name] and [option:Name] to create interactive links.' } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

toolRegistry.register('generate_transformations', definition, handler, 60000);
