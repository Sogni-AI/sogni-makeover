import { toolRegistry } from '@/services/toolRegistry';
import type { ToolResult, MakeoverToolContext } from '@/types/chat';

const definition = {
  type: 'function' as const,
  function: {
    name: 'compare_before_after',
    description: 'Compare the original photo with a makeover result side by side. Useful for discussing what changed.',
    parameters: {
      type: 'object',
      properties: {
        resultIndex: { type: 'number', description: 'Index in edit stack, defaults to latest' },
      },
    },
  },
};

async function handler(
  args: Record<string, unknown>,
  context: MakeoverToolContext
): Promise<ToolResult> {
  const originalUrl = context.getOriginalImageUrl();
  const stack = context.getEditStack();
  const idx = typeof args.resultIndex === 'number' ? args.resultIndex : stack.length - 1;
  const step = stack[idx];

  if (!originalUrl || !step?.resultImageUrl) {
    return { success: false, error: 'Need both original and result images to compare' };
  }

  try {
    const comparison = await context.analyzeImage(
      step.resultImageUrl,
      `You are an eccentric Hollywood stylist comparing a before and after makeover.
The original: ${context.getPhotoAnalysis().subjectDescription}.
The prompt was: "${step.transformation.prompt}".
In 2 sentences max: what landed vs what missed, and overall quality. Be enthusiastic but honest.`
    );
    return { success: true, data: { comparison } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

toolRegistry.register('compare_before_after', definition, handler, 30000);
