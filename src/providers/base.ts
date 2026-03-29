export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMResponse {
  content: string | null;
  tool_calls: ToolCall[];
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export abstract class BaseLLMProvider {
  abstract name: string;
  abstract model: string;

  abstract call(
    messages: Message[],
    tools: ToolDefinition[],
  ): Promise<LLMResponse>;

  abstract isAvailable(): boolean;
}
