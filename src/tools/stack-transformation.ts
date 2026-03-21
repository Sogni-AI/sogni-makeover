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
        name: { type: 'string', description: 'Short display name for this look (e.g. "Smoky Eye Glam")' },
        prompt: { type: 'string', description: 'The transformation prompt to apply on top of the current result' },
        intensity: { type: 'number', description: 'Denoising strength 0.3-0.95' },
      },
      required: ['name', 'prompt'],
    },
  },
};

async function handler(
  args: Record<string, unknown>,
  context: MakeoverToolContext
): Promise<ToolResult> {
  const name = typeof args.name === 'string' ? args.name : undefined;
  const prompt = String(args.prompt || '');
  const intensity = typeof args.intensity === 'number' ? args.intensity : undefined;

  if (!prompt) {
    return { success: false, error: 'A prompt is required' };
  }

  if (context.getEditStack().length === 0) {
    return { success: false, error: 'No previous result to stack on. Use generate_makeover first.' };
  }

  if (context.isGenerating()) {
    return { success: false, error: 'A generation is already in progress' };
  }

  try {
    const result = await context.generateFromPrompt({
      name,
      prompt,
      intensity,
      useStackedInput: true,
    });

    // Patch getEditStack so subsequent tool calls in the same LLM round
    // (e.g. compare_before_after) can access this step before React renders.
    const prevGetEditStack = context.getEditStack;
    const syntheticStep = {
      transformation: { id: `tool-${Date.now()}`, name: name || prompt.slice(0, 30), category: 'ai-generated' as const, subcategory: 'chat', prompt, icon: '' },
      resultImageUrl: result.resultUrl,
      resultImageBase64: '',
      timestamp: Date.now(),
    };
    context.getEditStack = () => {
      const stack = prevGetEditStack();
      if (stack.some((s) => s.resultImageUrl === result.resultUrl)) return stack;
      return [...stack, syntheticStep];
    };

    return {
      success: true,
      data: { resultUrl: result.resultUrl, projectId: result.projectId, stackDepth: context.getEditStack().length },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

toolRegistry.register('stack_transformation', definition, handler, 120000);
