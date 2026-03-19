import { toolRegistry } from '@/services/toolRegistry';
import type { ToolResult, MakeoverToolContext } from '@/types/chat';

const definition = {
  type: 'function' as const,
  function: {
    name: 'generate_makeover',
    description: 'Generate a makeover transformation on the client\'s photo. Use this when the client wants to try a specific look.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed transformation prompt describing the desired change' },
        intensity: { type: 'number', description: 'Denoising strength 0.3-0.95. Lower = subtle, higher = dramatic. Default 0.65' },
        negativePrompt: { type: 'string', description: 'What to avoid in the result' },
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
  const negativePrompt = typeof args.negativePrompt === 'string' ? args.negativePrompt : undefined;

  if (!prompt) {
    return { success: false, error: 'A prompt is required' };
  }

  try {
    const result = await context.generateFromPrompt({
      prompt,
      intensity,
      negativePrompt,
      useStackedInput: false,
    });
    return { success: true, data: { resultUrl: result.resultUrl, projectId: result.projectId } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

toolRegistry.register('generate_makeover', definition, handler, 120000);
