import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam, TextBlockParam, ToolUseBlockParam } from "@anthropic-ai/sdk/resources/messages";
import {
  BaseLLMProvider,
  type Message,
  type ToolDefinition,
  type LLMResponse,
  type ToolCall,
} from "./base";

export class AnthropicProvider extends BaseLLMProvider {
  name = "anthropic";
  model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  private client: Anthropic;

  constructor() {
    super();
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  async call(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    let systemPrompt = "";
    const anthropicMessages: MessageParam[] = [];

    for (const m of messages) {
      if (m.role === "system") {
        systemPrompt = m.content;
        continue;
      }

      if (m.role === "tool") {
        const toolResult: ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: m.tool_call_id!,
          content: m.content,
        };
        anthropicMessages.push({ role: "user", content: [toolResult] });
        continue;
      }

      if (m.role === "assistant" && m.tool_calls?.length) {
        const content: Array<TextBlockParam | ToolUseBlockParam> = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const tc of m.tool_calls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        anthropicMessages.push({ role: "assistant", content });
        continue;
      }

      anthropicMessages.push({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      });
    }

    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt || undefined,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    });

    let textContent = "";
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textContent += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content: textContent || null,
      tool_calls: toolCalls,
      model: this.model,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }
}
