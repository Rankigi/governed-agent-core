import axios from "axios";
import {
  BaseLLMProvider,
  type Message,
  type ToolDefinition,
  type LLMResponse,
  type ToolCall,
} from "./base";

export class OllamaProvider extends BaseLLMProvider {
  name = "ollama";
  model = process.env.OLLAMA_MODEL || "llama3.2";
  private baseUrl: string;

  constructor() {
    super();
    this.baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  }

  isAvailable(): boolean {
    return !!process.env.OLLAMA_BASE_URL || process.env.LLM_PROVIDER === "ollama";
  }

  async call(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    // Convert messages to Ollama format
    const ollamaMessages = messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool" as const, content: m.content };
      }
      return { role: m.role, content: m.content };
    });

    // Ollama tool format (supported in newer models)
    const ollamaTools = tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    try {
      const response = await axios.post(`${this.baseUrl}/api/chat`, {
        model: this.model,
        messages: ollamaMessages,
        tools: ollamaTools.length > 0 ? ollamaTools : undefined,
        stream: false,
      });

      const msg = response.data.message;
      const toolCalls: ToolCall[] = [];

      // Parse tool calls if present
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          toolCalls.push({
            id: `ollama_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: tc.function?.name ?? "",
            arguments: tc.function?.arguments ?? {},
          });
        }
      }

      return {
        content: msg.content || null,
        tool_calls: toolCalls,
        model: this.model,
        usage: {
          input_tokens: response.data.prompt_eval_count ?? 0,
          output_tokens: response.data.eval_count ?? 0,
        },
      };
    } catch (error) {
      // If tool calling fails (model doesn't support it), fall back to prompt-based
      if (tools.length > 0) {
        return this.callWithPromptTools(messages, tools);
      }
      throw error;
    }
  }

  private async callWithPromptTools(
    messages: Message[],
    tools: ToolDefinition[],
  ): Promise<LLMResponse> {
    // Inject tool descriptions into system message for models without native tool support
    const toolDesc = tools
      .map((t) => `- ${t.name}: ${t.description} (params: ${JSON.stringify(t.parameters)})`)
      .join("\n");

    const enhancedMessages = messages.map((m) => {
      if (m.role === "system") {
        return {
          ...m,
          content: `${m.content}\n\nAvailable tools:\n${toolDesc}\n\nTo use a tool, respond with exactly: TOOL_CALL: {"name": "tool_name", "arguments": {...}}`,
        };
      }
      return m;
    });

    const ollamaMessages = enhancedMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const response = await axios.post(`${this.baseUrl}/api/chat`, {
      model: this.model,
      messages: ollamaMessages,
      stream: false,
    });

    const content = response.data.message?.content ?? "";
    const toolCalls: ToolCall[] = [];

    // Parse TOOL_CALL from response
    const match = content.match(/TOOL_CALL:\s*(\{[\s\S]*?\})/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        toolCalls.push({
          id: `ollama_${Date.now()}`,
          name: parsed.name,
          arguments: parsed.arguments ?? {},
        });
      } catch {
        // Not valid JSON — treat as regular response
      }
    }

    return {
      content: toolCalls.length > 0 ? null : content,
      tool_calls: toolCalls,
      model: this.model,
      usage: {
        input_tokens: response.data.prompt_eval_count ?? 0,
        output_tokens: response.data.eval_count ?? 0,
      },
    };
  }
}
