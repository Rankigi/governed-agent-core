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

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];

      if (m.role === "system") {
        systemPrompt = m.content;
        continue;
      }

      if (m.role === "tool") {
        // Collect ALL consecutive tool messages into one user message
        // Anthropic requires all tool_results in a single user message
        // immediately after the assistant's tool_use message
        const toolResults: ToolResultBlockParam[] = [];

        let j = i;
        while (j < messages.length && messages[j].role === "tool") {
          toolResults.push({
            type: "tool_result",
            tool_use_id: messages[j].tool_call_id!,
            content: messages[j].content,
          });
          j++;
        }

        anthropicMessages.push({ role: "user", content: toolResults });
        i = j - 1; // advance past all collected tool messages
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

    // Sanitize: strip orphaned tool_use blocks before sending
    const sanitized = this.sanitizeMessages(anthropicMessages);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt || undefined,
      messages: sanitized,
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

  /**
   * Safety net: strip any assistant tool_use blocks that lack
   * a corresponding tool_result in the conversation.
   * Prevents 400 "tool_use ids without tool_result blocks".
   */
  private sanitizeMessages(messages: MessageParam[]): MessageParam[] {
    // Collect all tool_result ids
    const resultIds = new Set<string>();
    for (const m of messages) {
      if (m.role === "user" && Array.isArray(m.content)) {
        for (const block of m.content) {
          if (typeof block === "object" && "type" in block && block.type === "tool_result") {
            resultIds.add((block as ToolResultBlockParam).tool_use_id);
          }
        }
      }
    }

    // Strip orphaned tool_use blocks from assistant messages
    const sanitized: MessageParam[] = [];
    for (const m of messages) {
      if (m.role === "assistant" && Array.isArray(m.content)) {
        const hasToolUse = m.content.some(
          (b) => typeof b === "object" && "type" in b && b.type === "tool_use",
        );

        if (hasToolUse) {
          // Check if ALL tool_use ids have matching results
          const allMatched = m.content.every((b) => {
            if (typeof b !== "object" || !("type" in b) || b.type !== "tool_use") return true;
            return resultIds.has((b as ToolUseBlockParam).id);
          });

          if (!allMatched) {
            // Keep text blocks only, drop tool_use blocks
            const textBlocks = m.content.filter(
              (b) => typeof b === "object" && "type" in b && b.type === "text",
            );
            if (textBlocks.length > 0) {
              sanitized.push({ role: "assistant", content: textBlocks });
            }
            // If no text blocks either, skip the message entirely
            continue;
          }
        }
      }
      sanitized.push(m);
    }

    return sanitized;
  }
}
