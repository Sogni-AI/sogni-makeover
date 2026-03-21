import { toolRegistry } from '@/services/toolRegistry';
import type { ToolResult, MakeoverToolContext } from '@/types/chat';

const definition = {
  type: 'function' as const,
  function: {
    name: 'analyze_result',
    description: 'Analyze a generated makeover result and provide professional feedback. Call this after a makeover completes to comment on the result.',
    parameters: {
      type: 'object',
      properties: {
        resultIndex: { type: 'number', description: 'Index in edit stack, defaults to latest result' },
      },
    },
  },
};

async function handler(
  args: Record<string, unknown>,
  context: MakeoverToolContext
): Promise<ToolResult> {
  const stack = context.getEditStack();
  const idx = typeof args.resultIndex === 'number' ? args.resultIndex : stack.length - 1;
  const step = stack[idx];

  if (!step) {
    return { success: false, error: 'No result to analyze' };
  }

  const imageUrl = step.resultImageUrl;
  if (!imageUrl) {
    return { success: false, error: 'Result image not available' };
  }

  try {
    const analysis = await context.analyzeImage(
      imageUrl,
      'You are an eccentric Hollywood stylist reviewing a makeover result. In 2-3 sentences max: what works, what could be refined, and one follow-up idea. Be specific and enthusiastic.'
    );
    return { success: true, data: { analysis } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

toolRegistry.register('analyze_result', definition, handler, 30000);
