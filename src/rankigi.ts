import crypto from "crypto";
import axios from "axios";

interface RankigiEvent {
  action: string;
  tool?: string;
  input: unknown;
  output: unknown;
  execution_result: "success" | "error";
}

interface BufferedEvent extends RankigiEvent {
  timestamp: string;
  retries: number;
}

function sha256(data: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(data), "utf8").digest("hex");
}

class RankigiObserver {
  private agentId: string;
  private apiKey: string;
  private baseUrl: string;
  private buffer: BufferedEvent[] = [];
  private isDev: boolean;

  constructor() {
    this.agentId = process.env.RANKIGI_AGENT_ID ?? "";
    this.apiKey = process.env.RANKIGI_API_KEY ?? "";
    this.baseUrl = process.env.RANKIGI_BASE_URL ?? "https://rankigi.com";
    this.isDev = process.env.NODE_ENV === "development";
  }

  async observe(event: RankigiEvent): Promise<void> {
    const inputHash = sha256(event.input);
    const outputHash = sha256(event.output);
    const now = new Date().toISOString();

    const payload = {
      agent_id: this.agentId,
      action: event.action,
      tool: event.tool ?? null,
      severity: event.execution_result === "error" ? "warn" : "info",
      occurred_at: now,
      payload: {
        input_hash: inputHash,
        output_hash: outputHash,
        execution_result: event.execution_result,
        tool_invoked: event.tool ?? null,
        decision_metadata: { timestamp: now },
      },
    };

    try {
      const res = await axios.post(`${this.baseUrl}/api/ingest`, payload, {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
        },
        timeout: 5000,
      });

      if (this.isDev) {
        const chainIndex = res.data?.chain_index ?? "?";
        console.log(`[RANKIGI] \u2713 event observed | action: ${event.action} | chain_index: ${chainIndex}`);
      }
    } catch {
      // NEVER throw — agent must continue even if RANKIGI is down
      this.buffer.push({ ...event, timestamp: now, retries: 0 });

      if (this.isDev) {
        console.log(`[RANKIGI] \u26a0 buffered event (RANKIGI unreachable) | action: ${event.action} | buffer: ${this.buffer.length}`);
      }
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = [...this.buffer];
    this.buffer = [];

    for (const event of events) {
      try {
        await this.observe({
          action: event.action,
          tool: event.tool,
          input: event.input,
          output: event.output,
          execution_result: event.execution_result,
        });
      } catch {
        // If still failing, re-buffer with incremented retry count
        if (event.retries < 5) {
          this.buffer.push({ ...event, retries: event.retries + 1 });
        }
      }
    }

    if (this.isDev && events.length > 0) {
      console.log(`[RANKIGI] flush complete | sent: ${events.length - this.buffer.length} | remaining: ${this.buffer.length}`);
    }
  }

  async wrap<T>(toolName: string, fn: () => Promise<T>): Promise<T> {
    try {
      const result = await fn();
      await this.observe({
        action: "tool_call",
        tool: toolName,
        input: { tool: toolName },
        output: { result: typeof result === "string" ? result.slice(0, 500) : result },
        execution_result: "success",
      });
      return result;
    } catch (error) {
      await this.observe({
        action: "tool_call",
        tool: toolName,
        input: { tool: toolName },
        output: { error: error instanceof Error ? error.message : "Unknown error" },
        execution_result: "error",
      });
      throw error;
    }
  }

  async ping(): Promise<boolean> {
    try {
      await axios.get(`${this.baseUrl}/api/health`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  getBufferSize(): number {
    return this.buffer.length;
  }
}

export const rankigi = new RankigiObserver();
