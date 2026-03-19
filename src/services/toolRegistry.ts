import type { ToolDefinition, ToolResult, MakeoverToolContext } from '@/types/chat';

export type ToolHandler = (
  args: Record<string, unknown>,
  context: MakeoverToolContext
) => Promise<ToolResult>;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
  timeout: number;
}

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(
    name: string,
    definition: ToolDefinition,
    handler: ToolHandler,
    timeout = 120000
  ): void {
    this.tools.set(name, { definition, handler, timeout });
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: MakeoverToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${name}` };
    }

    const timeoutMs = tool.timeout;

    try {
      const result = await Promise.race([
        tool.handler(args, context),
        new Promise<ToolResult>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool ${name} timed out after ${timeoutMs / 1000}s`)), timeoutMs)
        ),
      ]);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();
