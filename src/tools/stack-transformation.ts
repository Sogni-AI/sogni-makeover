import { toolRegistry } from '@/services/toolRegistry';
import type { ToolResult, MakeoverToolContext } from '@/types/chat';

const definition = {
  type: 'function' as const,
  function: {
    name: 'stack_transformation',
    description: 'Apply an additional transformation on top of the current result. Great for layering effects (e.g., hair change + makeup).',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The transformation prompt to apply on top of the current result' },
        intensity: { type: 'number', description: 'Denoising strength 0.3-0.95' },
      },
      required: ['prompt'],
    },
  },
};

async function handler(
  args: Record<string, unknown>,
  context: MakeoverToolContext
): Promise<ToolResult> {
  const prompt = String(args.prompt || '');
  const intensity = typeof args.intensity === 'number' ? args.intensity : undefined;

  if (!prompt) {
    return { success: false, error: 'A prompt is required' };
  }

  if (context.getEditStackDepth() === 0) {
    return { success: false, error: 'No previous result to stack on. Use generate_makeover first.' };
  }

  try {
    const result = await context.generateFromPrompt({
      prompt,
      intensity,
      useStackedInput: true,
    });
    return {
      success: true,
      data: { resultUrl: result.resultUrl, projectId: result.projectId, stackDepth: context.getEditStackDepth() },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

toolRegistry.register('stack_transformation', definition, handler, 120000);
