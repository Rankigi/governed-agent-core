import type { Message, ToolCall } from "./providers/base";

const SYSTEM_PROMPT = `You are a governed AI agent operating inside the RANKIGI layer. Every action you take is cryptographically recorded and immutable. You have access to tools. Use them when needed. Be precise, honest, and thorough. Your passport ID is: ${process.env.RANKIGI_AGENT_ID ?? "UNREGISTERED"}`;

export class Memory {
  private messages: Message[] = [];
  private maxMessages = 40;

  constructor() {
    this.messages.push({ role: "system", content: SYSTEM_PROMPT });
  }

  addUserMessage(content: string): void {
    this.messages.push({ role: "user", content });
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

  private trim(): void {
    if (this.messages.length <= this.maxMessages) return;

    // Always keep the system message (index 0)
    const system = this.messages[0];
    const recent = this.messages.slice(-(this.maxMessages - 1));
    this.messages = [system, ...recent];
  }

  clear(): void {
    const system = this.messages[0];
    this.messages = [system];
  }
}
