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
   * Also merges consecutive same-role messages that can result
   * from stripping (Anthropic requires alternating roles).
   */
  private sanitizeMessages(messages: MessageParam[]): MessageParam[] {
    // Collect all tool_result ids from user messages
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

    // Pass 1: Strip orphaned tool_use blocks from assistant messages
    const stripped: MessageParam[] = [];
    for (const m of messages) {
      if (m.role === "assistant" && Array.isArray(m.content)) {
        const hasToolUse = m.content.some(
          (b) => typeof b === "object" && "type" in b && b.type === "tool_use",
        );

        if (hasToolUse) {
          const allMatched = m.content.every((b) => {
            if (typeof b !== "object" || !("type" in b) || b.type !== "tool_use") return true;
            return resultIds.has((b as ToolUseBlockParam).id);
          });

          if (!allMatched) {
            const textBlocks = m.content.filter(
              (b) => typeof b === "object" && "type" in b && b.type === "text",
            );
            if (textBlocks.length > 0) {
              stripped.push({ role: "assistant", content: textBlocks });
            }
            continue;
          }
        }
      }
      stripped.push(m);
    }

    // Pass 2: Merge consecutive same-role messages (Anthropic requires alternating)
    const merged: MessageParam[] = [];
    for (const m of stripped) {
      const prev = merged[merged.length - 1];
      if (prev && prev.role === m.role) {
        // Merge content: both could be string or array
        const prevContent = typeof prev.content === "string" ? prev.content : "";
        const curContent = typeof m.content === "string" ? m.content : "";
        if (prevContent && curContent) {
          prev.content = prevContent + "\n" + curContent;
        }
        // If either is an array, skip merge (complex case) — keep the later one
        continue;
      }
      merged.push(m);
    }

    // Pass 3: Drop any trailing user message with only tool_results that are orphaned
    // (tool_results for tool_use blocks we just stripped)
    const final: MessageParam[] = [];
    for (let i = 0; i < merged.length; i++) {
      const m = merged[i];
      if (m.role === "user" && Array.isArray(m.content)) {
        const onlyToolResults = m.content.every(
          (b) => typeof b === "object" && "type" in b && b.type === "tool_result",
        );
        if (onlyToolResults) {
          // Check if the previous message is an assistant with matching tool_use blocks
          const prev = final[final.length - 1];
          if (!prev || prev.role !== "assistant" || !Array.isArray(prev.content)) {
            continue; // Orphaned tool_results — skip
          }
          const prevToolIds = new Set(
            (prev.content as Array<{ type: string; id?: string }>)
              .filter((b) => b.type === "tool_use" && b.id)
              .map((b) => b.id!),
          );
          const allHaveParent = m.content.every((b) => {
            if (typeof b !== "object" || !("type" in b) || b.type !== "tool_result") return true;
            return prevToolIds.has((b as ToolResultBlockParam).tool_use_id);
          });
          if (!allHaveParent) continue; // Orphaned — skip
        }
      }
      final.push(m);
    }

    return final;
  }
}
