import crypto from "crypto";
import type { TimingRun } from "./types";
import { SelfModelStore } from "./store";

interface ChainEvent {
  action: string;
  payload: Record<string, unknown>;
  chain_index?: number;
  occurred_at: string;
}

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  finance: ["invoice", "price", "payment", "cost", "budget", "revenue", "profit", "expense", "tax", "dollar", "sec", "filing"],
  research: ["search", "find", "lookup", "query", "discover", "investigate", "analyze", "explore"],
  communication: ["email", "message", "send", "notify", "alert", "slack", "reply", "contact"],
  engineering: ["code", "debug", "error", "build", "deploy", "test", "compile", "refactor", "function"],
  governance: ["policy", "violation", "audit", "compliance", "risk", "governance", "chain", "hash"],
  legal: ["contract", "agreement", "clause", "regulation", "statute", "filing", "court"],
};

function extractProblemType(content: string): string {
  const lower = content.toLowerCase();
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return domain;
  }
  return "general";
}

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

export class OuterLoop {
  private store: SelfModelStore;
  private running = false;
  private currentRun: {
    run_id: string;
    chain_index_start: number;
    start_time: number;
    problem_signature: string;
    problem_type: string;
    tools_invoked: string[];
    tool_start_times: Map<string, number>;
  } | null = null;

  constructor(store: SelfModelStore) {
    this.store = store;
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    this.running = true;
    const model = this.store.getModel();
    console.log(`[OUTER] Online. Observing inner loop.`);
    console.log(`[OUTER] Self-model: ${model.readiness_tier} (${model.total_runs_observed} runs)`);
  }

  stop(): void {
    this.running = false;
    console.log(`[OUTER] Offline.`);
  }

  async onChainEvent(event: ChainEvent): Promise<void> {
    if (!this.running) return;

    switch (event.action) {
      case "agent_input":
      case "inference_start":
        await this.onInferenceStart(event);
        break;
      case "tool_call_start":
        await this.onToolCallStart(event);
        break;
      case "tool_call_complete":
        await this.onToolCallComplete(event);
        break;
      case "llm_response":
        // Track tool calls within the response
        break;
      case "agent_output":
      case "inference_complete":
        await this.onInferenceComplete(event);
        break;
      case "policy_violation":
        await this.onPolicyViolation(event);
        break;
      case "agent_error":
        await this.onAgentError(event);
        break;
      default:
        // Other events — update coverage
        if (event.payload?.domain) {
          this.store.updateCoverage(event.payload.domain as string, true);
        }
        break;
    }
  }

  private async onInferenceStart(event: ChainEvent): Promise<void> {
    const content = (event.payload?.message as string) ?? (event.payload?.input_hash as string) ?? "";
    const problemType = extractProblemType(content);
    const signature = `${problemType}:${content.slice(0, 100)}`;

    this.currentRun = {
      run_id: crypto.randomUUID(),
      chain_index_start: event.chain_index ?? 0,
      start_time: Date.now(),
      problem_signature: signature,
      problem_type: problemType,
      tools_invoked: [],
      tool_start_times: new Map(),
    };

    // Check if we have a compiled pattern
    const pattern = this.store.findMatchingPattern(signature);
    if (pattern) {
      console.log(`[OUTER] Pattern match: ${signature.slice(0, 40)}... → compiled, ${pattern.solution_path.join(" → ")}`);
    }
  }

  private async onToolCallStart(event: ChainEvent): Promise<void> {
    if (!this.currentRun) return;
    const toolId = (event.payload?.tool_id as string) ?? (event.payload?.tool_invoked as string) ?? "unknown";
    this.currentRun.tool_start_times.set(toolId, Date.now());
  }

  private async onToolCallComplete(event: ChainEvent): Promise<void> {
    if (!this.currentRun) return;
    const toolId = (event.payload?.tool_id as string) ?? (event.payload?.tool_invoked as string) ?? "unknown";
    const toolName = (event.payload?.tool_name as string) ?? toolId;
    const success = (event.payload?.execution_result as string) !== "error";
    const startTime = this.currentRun.tool_start_times.get(toolId);
    const latency = startTime ? Date.now() - startTime : (event.payload?.latency_ms as number) ?? 0;

    this.currentRun.tools_invoked.push(toolId);

    this.store.updateToolPerformance(
      toolId, toolName, latency, success, this.currentRun.problem_type,
    );
  }

  private async onInferenceComplete(event: ChainEvent): Promise<void> {
    if (!this.currentRun) return;

    const solveTime = Date.now() - this.currentRun.start_time;
    const signature = this.currentRun.problem_signature;
    const signatureHash = sha256(signature);
    const existingPattern = this.store.findMatchingPattern(signature);
    const success = (event.payload?.execution_result as string) !== "error";

    // Build timing run
    const run: TimingRun = {
      run_id: this.currentRun.run_id,
      chain_index_start: this.currentRun.chain_index_start,
      chain_index_end: event.chain_index ?? 0,
      problem_signature_hash: signatureHash,
      solve_time_ms: solveTime,
      tools_invoked: this.currentRun.tools_invoked.length,
      pattern_matched: !!existingPattern,
      pattern_hash: existingPattern?.pattern_hash ?? null,
      skipped_reasoning_steps: existingPattern ? existingPattern.solution_path.length : 0,
      timestamp: new Date().toISOString(),
    };

    this.store.addTimingRun(run);

    // Upsert pattern
    this.store.upsertPattern(
      signature,
      this.currentRun.tools_invoked,
      solveTime,
      success,
      this.currentRun.chain_index_start,
    );

    // Update coverage
    this.store.updateCoverage(this.currentRun.problem_type, !!existingPattern);

    // Log
    const model = this.store.getModel();
    const tc = model.timing_curve;
    console.log(`[OUTER] Run #${model.total_runs_observed} complete`);
    console.log(`  Solve time: ${solveTime}ms`);
    console.log(`  Pattern: ${existingPattern ? "matched (compiled)" : "new"}`);
    console.log(`  Tools: ${this.currentRun.tools_invoked.join(", ") || "none"}`);
    console.log(`  Trend: ${tc.trend}`);
    if (tc.learning_velocity !== 0) {
      console.log(`  Velocity: ${tc.learning_velocity > 0 ? "+" : ""}${Math.round(tc.learning_velocity * 100)}% faster`);
    }

    this.currentRun = null;
  }

  private async onPolicyViolation(event: ChainEvent): Promise<void> {
    const reason = (event.payload?.reason as string) ?? "policy violation";
    this.store.recordFailure("policy_block", reason, []);
  }

  private async onAgentError(event: ChainEvent): Promise<void> {
    const error = (event.payload?.error as string) ?? "unknown error";
    const failureType = error.includes("timeout") ? "timeout" as const : "chain_error" as const;
    this.store.recordFailure(failureType, error, []);
  }
}
