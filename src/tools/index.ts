import type { ToolDefinition } from "../providers/base";
import { webSearch } from "./web-search";
import { calculator } from "./calculator";
import { summarize } from "./summarize";
import { remember } from "./remember";
import { eridu } from "./eridu";

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<string>;
}

export const TOOLS: Tool[] = [webSearch, calculator, summarize, remember, eridu];

export function getToolDefinitions(): ToolDefinition[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return `Unknown tool: ${name}`;
  return tool.execute(args);
}
