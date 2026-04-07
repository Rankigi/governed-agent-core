/**
 * MemOS Client — RANKIGI-governed sidecar wrapper.
 *
 * MemOS is an external Python memory service running at localhost:8000.
 * Every operation is wrapped with rankigi.observe() so RANKIGI sees
 * what MemOS is doing — MemOS itself is unmodified and unaware.
 *
 * If MemOS is unreachable, callers should fall back to the Akashic
 * Pulse memory stack. This client never throws on connection failure;
 * `isAvailable()` returns false instead.
 */

import crypto from "crypto";
import { rankigi } from "../rankigi";

// ── Helpers ────────────────────────────────────────────────────────────────

function sha256Hex(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function canonical(obj: unknown): string {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonical).join(",") + "]";
  }
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    "{" +
    sortedKeys
      .map((k) => JSON.stringify(k) + ":" + canonical((obj as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface MemOSMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface MemOSAddResponse {
  status?: string;
  memory_id?: string;
  [key: string]: unknown;
}

export interface MemOSTextMemory {
  content?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface MemOSSearchResponse {
  text_mem?: MemOSTextMemory[];
  graph_mem?: unknown[];
  [key: string]: unknown;
}

// ── Client ─────────────────────────────────────────────────────────────────

export class MemOSClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly userPrefix: string;
  private available = false;

  constructor() {
    this.baseUrl = (process.env.MEMOS_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");
    this.apiKey = process.env.MEMOS_API_KEY ?? "";
    this.userPrefix = process.env.MEMOS_USER_PREFIX ?? "rankigi-agent-";
  }

  /** Check if the MemOS service is reachable. Caches result on first call. */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      this.available = res.ok;
      return this.available;
    } catch {
      // Try root path as a secondary check — some MemOS builds don't expose /health
      try {
        const res2 = await fetch(`${this.baseUrl}/`, {
          method: "GET",
          signal: AbortSignal.timeout(2000),
        });
        this.available = res2.ok;
        return this.available;
      } catch {
        this.available = false;
        return false;
      }
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  private mapAgentId(agentId: string): string {
    if (agentId.startsWith(this.userPrefix)) return agentId;
    return `${this.userPrefix}${agentId}`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  /**
   * Register a new memory cube for an agent.
   * Wrapped with rankigi.observe(memory_cube_create).
   */
  async createUser(agentId: string): Promise<{ ok: boolean; user_id: string }> {
    const userId = this.mapAgentId(agentId);

    // RANKIGI observes the registration intent first.
    await rankigi.observe({
      action: "memory_cube_create",
      input: { user_id: userId },
      output: { status: "created" },
      execution_result: "success",
    });

    try {
      const res = await fetch(`${this.baseUrl}/create/user`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ user_id: userId }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        // 409 = already exists, treat as success
        if (res.status !== 409) {
          console.log(`[MEMOS] createUser non-OK: ${res.status}`);
        }
      }
      this.available = true;
      return { ok: true, user_id: userId };
    } catch (err) {
      this.available = false;
      console.log(
        `[MEMOS] createUser failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false, user_id: userId };
    }
  }

  /**
   * Add messages to MemOS for a given agent + conversation.
   * Wrapped with rankigi.observe(memory_cube_write).
   */
  async add(
    messages: MemOSMessage[],
    agentId: string,
    conversationId: string,
  ): Promise<MemOSAddResponse | null> {
    const userId = this.mapAgentId(agentId);
    const inputHash = sha256Hex(canonical({ messages, userId, conversationId }));

    let data: MemOSAddResponse | null = null;
    let outputHash = "";
    let executionResult: "success" | "error" = "success";

    try {
      const res = await fetch(`${this.baseUrl}/add/message`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          messages,
          user_id: userId,
          conversation_id: conversationId,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        executionResult = "error";
        outputHash = sha256Hex({ error: `status_${res.status}` });
      } else {
        data = (await res.json()) as MemOSAddResponse;
        outputHash = sha256Hex(canonical(data));
      }
      this.available = res.ok;
    } catch (err) {
      this.available = false;
      executionResult = "error";
      outputHash = sha256Hex({ error: String(err) });
    }

    // RANKIGI observes the write — MemOS never knows.
    await rankigi.observe({
      action: "memory_cube_write",
      input: {
        hash: inputHash,
        message_count: messages.length,
        user_id: userId,
        conversation_id: conversationId,
      },
      output: {
        hash: outputHash,
        status: data?.status ?? (executionResult === "success" ? "ok" : "failed"),
      },
      execution_result: executionResult,
    });

    if (executionResult === "success" && data) {
      console.log(`[MEMOS] Memory filed → ${conversationId}`);
      console.log(`[RANKIGI] memory_cube_write → chain event filed`);
    }

    return data;
  }

  /**
   * Search MemOS for relevant memories for a query.
   * Wrapped with rankigi.observe(memory_pulse).
   */
  async search(
    query: string,
    agentId: string,
    conversationId: string,
  ): Promise<MemOSSearchResponse | null> {
    const userId = this.mapAgentId(agentId);
    const inputHash = sha256Hex(canonical({ query, userId, conversationId }));

    let data: MemOSSearchResponse | null = null;
    let outputHash = "";
    let executionResult: "success" | "error" = "success";

    try {
      const res = await fetch(`${this.baseUrl}/search/memory`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          query,
          user_id: userId,
          conversation_id: conversationId,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        executionResult = "error";
        outputHash = sha256Hex({ error: `status_${res.status}` });
      } else {
        data = (await res.json()) as MemOSSearchResponse;
        outputHash = sha256Hex(canonical(data));
      }
      this.available = res.ok;
    } catch (err) {
      this.available = false;
      executionResult = "error";
      outputHash = sha256Hex({ error: String(err) });
    }

    const recalled = data?.text_mem?.length ?? 0;

    // RANKIGI observes the pulse — even on failure.
    await rankigi.observe({
      action: "memory_pulse",
      input: { hash: inputHash, query },
      output: {
        hash: outputHash,
        memories_recalled: recalled,
      },
      execution_result: executionResult,
    });

    if (executionResult === "success") {
      console.log(`[MEMOS] Pulse → ${recalled} memories recalled`);
      console.log(`[RANKIGI] memory_pulse → chain event filed`);
    }

    return data;
  }

  /** Extract recalled memory text into a single context string for the LLM prompt. */
  static extractContext(result: MemOSSearchResponse | null): string {
    if (!result || !Array.isArray(result.text_mem) || result.text_mem.length === 0) {
      return "";
    }
    const parts: string[] = [];
    for (const m of result.text_mem) {
      if (typeof m.content === "string" && m.content.trim().length > 0) {
        parts.push(m.content.trim());
      }
    }
    return parts.join("\n");
  }
}

export const memosClient = new MemOSClient();
