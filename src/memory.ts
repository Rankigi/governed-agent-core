import type { Message, ToolCall } from "./providers/base";
import { getFilingStats, getHotMemories, getMemoryCount } from "./tools/remember";

const agentId = process.env.RANKIGI_AGENT_ID ?? "UNREGISTERED";

function buildSystemPrompt(): string {
  const stats = getFilingStats();
  const hot = getHotMemories(3);
  const count = getMemoryCount();

  const hotSection =
    hot.length > 0
      ? hot.map((h) => `  ${h.key}: "${h.label}" (${h.accesses} accesses)`).join("\n")
      : "  (none yet)";

  return `You are a governed AI agent operating inside the RANKIGI layer. Every action you take is cryptographically recorded and immutable. You have access to tools. Use them when needed. Be precise, honest, and thorough. Your passport ID is: ${agentId}

[MEMORY STATE]
Known addresses: ${count}
Filing mode distribution (this session):
  Sync: ${stats.sync} (${stats.syncPct}%)
  Async: ${stats.async} (${stats.asyncPct}%)
  Optimistic: ${stats.optimistic} (${stats.optimisticPct}%)

Hot memories (most accessed):
${hotSection}

Guidance:
  Use sync for numbers, names, decisions, violations, and anything the user explicitly asks you to remember.
  Use async for background context.
  Use optimistic for passing observations.
  User commands override everything:
    "remember this" → sync
    "log that" → async
    "fyi:" → optimistic`;
}

export class Memory {
  private messages: Message[] = [];
  private maxMessages = 40;

  constructor() {
    this.messages.push({ role: "system", content: buildSystemPrompt() });
  }

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
    this.refreshSystemPrompt();
    this.trim();
  }

  addAssistantMessage(content: string, toolCalls?: ToolCall[]): void {
    this.messages.push({ role: "assistant", content, tool_calls: toolCalls });
    this.trim();
  }

  addToolResult(toolCallId: string, content: string): void {
    this.messages.push({ role: "tool", content, tool_call_id: toolCallId });
    this.trim();
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  private refreshSystemPrompt(): void {
    if (this.messages.length > 0 && this.messages[0].role === "system") {
      this.messages[0] = { role: "system", content: buildSystemPrompt() };
    }
  }

  private trim(): void {
    if (this.messages.length <= this.maxMessages) return;
    const system = this.messages[0];
    const recent = this.messages.slice(-(this.maxMessages - 1));
    this.messages = [system, ...recent];
  }

  clear(): void {
    this.messages = [{ role: "system", content: buildSystemPrompt() }];
  }
}
