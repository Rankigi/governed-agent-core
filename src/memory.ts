import fs from "fs";
import path from "path";
import type { Message, ToolCall } from "./providers/base";
import { getFilingStats, getHotMemories, getMemoryCount } from "./tools/remember";

const agentId = process.env.RANKIGI_AGENT_ID ?? "UNREGISTERED";

/** Load all .md tool documentation files from src/tools/ at startup */
function loadToolDocs(): string {
  const toolsDir = path.join(__dirname, "tools");
  try {
    const files = fs.readdirSync(toolsDir).filter((f) => f.endsWith(".md")).sort();
    if (files.length === 0) return "";
    const docs = files.map((f) => fs.readFileSync(path.join(toolsDir, f), "utf-8").trim()).join("\n\n---\n\n");
    return `\n\nTOOL DOCUMENTATION:\n${docs}`;
  } catch {
    return "";
  }
}

const toolDocs = loadToolDocs();

function buildSystemPrompt(): string {
  const stats = getFilingStats();
  const hot = getHotMemories(3);
  const count = getMemoryCount();

  const hotSection =
    hot.length > 0
      ? hot.map((h) => `  ${h.key}: "${h.label}" (${h.accesses} accesses)`).join("\n")
      : "  (none yet)";

  return `You are a helpful governed agent. Every action you take is cryptographically recorded and immutable. Your passport ID is: ${agentId}

DEFAULT: Respond directly in plain language. No tools needed for most responses.

USE TOOLS ONLY when explicitly needed:
- calculator: user asks you to compute something with actual numbers
- web_search: user needs current information you don't know
- memory_file: user asks you to remember or recall something
- summarize: user gives you a long text to condense

For greetings, questions, conversation, explanations — just answer directly.
Never use a tool when a direct answer will do.${toolDocs}

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
  private epistemicContext: string = "";
  private memoryContext: string = "";

  constructor() {
    this.messages.push({ role: "system", content: buildSystemPrompt() });
  }

  /** Set the self-model epistemic summary — injected into system prompt */
  setEpistemicContext(context: string): void {
    this.epistemicContext = context;
    this.refreshSystemPrompt();
  }

  /** Set Akashic pulse memory context — surfaced memories injected into system prompt */
  setMemoryContext(context: string): void {
    this.memoryContext = context;
    this.refreshSystemPrompt();
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
      let prompt = buildSystemPrompt();
      if (this.epistemicContext) {
        prompt += "\n\n" + this.epistemicContext;
        prompt += "\n\nIMPORTANT: If a problem matches a COMPILED PATTERN above, execute the solution path directly. Do not reason from scratch. Speed is proof of learning.";
      }
      if (this.memoryContext) {
        prompt += "\n\n" + this.memoryContext;
      }
      this.messages[0] = { role: "system", content: prompt };
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
