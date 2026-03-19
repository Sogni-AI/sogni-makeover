import { toolRegistry } from '@/services/toolRegistry';
import type { ToolResult, MakeoverToolContext } from '@/types/chat';
import { generateTransformations } from '@/services/transformationService';

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
  const photoAnalysis = context.getPhotoAnalysis();
  const sogniClient = context.getSogniClient();

  try {
    const result = await generateTransformations(photoAnalysis, intent, sogniClient, {
      mode: mode as 'refresh' | 'expand',
      currentLook,
      currentCategories: context.getCurrentCategories(),
    });
    return { success: true, data: { categories: result.categories, recommendedCategory: result.recommendedCategory } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

toolRegistry.register('generate_transformations', definition, handler, 30000);
