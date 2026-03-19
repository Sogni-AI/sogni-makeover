import { toolRegistry } from '@/services/toolRegistry';
import type { ToolResult, MakeoverToolContext } from '@/types/chat';

const definition = {
  type: 'function' as const,
  function: {
    name: 'adjust_intensity',
    description: 'Re-run the last transformation with a different intensity. Use when the client wants the effect more or less dramatic.',
    parameters: {
      type: 'object',
      properties: {
        intensity: { type: 'number', description: 'New denoising strength 0.3-0.95. Lower = subtler effect, higher = more dramatic.' },
      },
      required: ['intensity'],
    },
  },
};

async function handler(
  args: Record<string, unknown>,
  context: MakeoverToolContext
): Promise<ToolResult> {
  const intensity = typeof args.intensity === 'number' ? args.intensity : 0.65;
  const stack = context.getEditStack();
  const lastStep = stack[stack.length - 1];

  if (!lastStep) {
    return { success: false, error: 'No previous transformation to adjust' };
  }

  try {
    const result = await context.generateFromPrompt({
      prompt: lastStep.transformation.prompt,
      intensity: Math.max(0.3, Math.min(0.95, intensity)),
      negativePrompt: lastStep.transformation.negativePrompt,
      useStackedInput: false,
    });
    return { success: true, data: { resultUrl: result.resultUrl, projectId: result.projectId, newIntensity: intensity } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

toolRegistry.register('adjust_intensity', definition, handler, 120000);
