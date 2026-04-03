import crypto from "crypto";
import type {
  SelfModel, ToolPerformanceRecord, PatternRecord,
  FailureRecord, TimingRun, CoverageRecord, ReadinessTier,
} from "./types";

const COMPILE_THRESHOLD = Number(process.env.PATTERN_COMPILE_THRESHOLD ?? 5);
const COMPILE_CONFIDENCE = Number(process.env.PATTERN_COMPILE_CONFIDENCE ?? 0.8);
const TIMING_WINDOW = Number(process.env.TIMING_CURVE_WINDOW ?? 100);

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function computeReadiness(runs: number): ReadinessTier {
  if (runs < 10) return "bootstrapping";
  if (runs < 100) return "learning";
  if (runs < 1000) return "competent";
  return "compiled";
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function createEmptyModel(agentId: string): SelfModel {
  const now = new Date().toISOString();
  return {
    agent_id: agentId,
    version: 0,
    created_at: now,
    last_updated_at: now,
    total_runs_observed: 0,
    tool_performance: {},
    pattern_library: {},
    coverage: {},
    failure_index: {},
    timing_curve: {
      runs: [],
      trend: "insufficient_data",
      learning_velocity: 0,
      compiled_patterns: 0,
      novel_problem_rate: 0,
    },
    model_hash: "",
    confidence_score: 0,
    readiness_tier: "bootstrapping",
  };
}

export class SelfModelStore {
  private model: SelfModel;
  private dirty = false;
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
    this.model = createEmptyModel(agentId);
  }

  getModel(): SelfModel {
    return this.model;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  load(serialized: string | null): void {
    if (!serialized) {
      this.model = createEmptyModel(this.agentId);
      return;
    }
    try {
      this.model = JSON.parse(serialized) as SelfModel;
    } catch {
      this.model = createEmptyModel(this.agentId);
    }
  }

  serialize(): string {
    this.model.version++;
    this.model.last_updated_at = new Date().toISOString();
    this.model.model_hash = sha256(JSON.stringify(this.model));
    this.model.readiness_tier = computeReadiness(this.model.total_runs_observed);
    this.dirty = false;
    return JSON.stringify(this.model);
  }

  getSavePayload(): Record<string, unknown> {
    return {
      model_version: this.model.version,
      model_hash: this.model.model_hash,
      confidence_score: this.model.confidence_score,
      readiness_tier: this.model.readiness_tier,
      total_runs: this.model.total_runs_observed,
      timing_trend: this.model.timing_curve.trend,
      compiled_patterns: this.model.timing_curve.compiled_patterns,
      learning_velocity: this.model.timing_curve.learning_velocity,
    };
  }

  updateToolPerformance(
    toolId: string,
    toolName: string,
    latencyMs: number,
    success: boolean,
    problemType: string,
  ): void {
    const now = new Date().toISOString();
    let rec = this.model.tool_performance[toolId];
    if (!rec) {
      rec = {
        tool_id: toolId,
        tool_name: toolName,
        invocation_count: 0,
        success_count: 0,
        failure_count: 0,
        success_rate: 0,
        avg_latency_ms: 0,
        p50_latency_ms: 0,
        p95_latency_ms: 0,
        best_problem_types: [],
        worst_problem_types: [],
        last_used_at: now,
        first_used_at: now,
        latencies: [],
      };
      this.model.tool_performance[toolId] = rec;
    }

    rec.invocation_count++;
    if (success) rec.success_count++;
    else rec.failure_count++;
    rec.success_rate = rec.success_count / rec.invocation_count;
    rec.last_used_at = now;

    // Track latencies (keep last 100)
    rec.latencies.push(latencyMs);
    if (rec.latencies.length > 100) rec.latencies = rec.latencies.slice(-100);
    const sorted = [...rec.latencies].sort((a, b) => a - b);
    rec.avg_latency_ms = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
    rec.p50_latency_ms = percentile(sorted, 50);
    rec.p95_latency_ms = percentile(sorted, 95);

    // Problem type tracking
    if (success && !rec.best_problem_types.includes(problemType)) {
      rec.best_problem_types = [...rec.best_problem_types, problemType].slice(-5);
    }
    if (!success && !rec.worst_problem_types.includes(problemType)) {
      rec.worst_problem_types = [...rec.worst_problem_types, problemType].slice(-5);
    }

    this.dirty = true;
  }

  upsertPattern(
    problemSignature: string,
    solutionPath: string[],
    solveTimeMs: number,
    success: boolean,
    chainIndex: number,
  ): void {
    const hash = sha256(problemSignature);
    const now = new Date().toISOString();
    let rec = this.model.pattern_library[hash];

    if (!rec) {
      rec = {
        pattern_hash: hash,
        problem_signature: problemSignature,
        solution_path: solutionPath,
        avg_solve_time_ms: solveTimeMs,
        confidence: 0.3,
        times_matched: 1,
        times_succeeded: success ? 1 : 0,
        last_matched_at: now,
        first_discovered_at: now,
        chain_index_discovered: chainIndex,
        compiled: false,
      };
      this.model.pattern_library[hash] = rec;
    } else {
      rec.times_matched++;
      if (success) rec.times_succeeded++;
      rec.confidence = rec.times_succeeded / rec.times_matched;
      rec.avg_solve_time_ms = Math.round(
        (rec.avg_solve_time_ms * (rec.times_matched - 1) + solveTimeMs) / rec.times_matched,
      );
      rec.solution_path = solutionPath; // latest path
      rec.last_matched_at = now;

      // Auto-compile check
      if (!rec.compiled && rec.confidence >= COMPILE_CONFIDENCE && rec.times_matched >= COMPILE_THRESHOLD) {
        rec.compiled = true;
        this.model.timing_curve.compiled_patterns++;
        console.log(`[OUTER] Pattern compiled: ${problemSignature.slice(0, 40)}... (${rec.confidence.toFixed(2)} confidence, ${rec.times_matched}x matched)`);
      }
    }

    this.dirty = true;
  }

  recordFailure(
    failureType: FailureRecord["failure_type"],
    context: string,
    recoveryPath: string[],
  ): void {
    const hash = sha256(failureType + context);
    const now = new Date().toISOString();
    let rec = this.model.failure_index[hash];

    if (!rec) {
      rec = {
        failure_hash: hash,
        failure_type: failureType,
        frequency: 1,
        first_seen_at: now,
        last_seen_at: now,
        recovery_path: recoveryPath,
        avoidance_signal: context.slice(0, 200),
        resolution_rate: recoveryPath.length > 0 ? 1.0 : 0,
      };
      this.model.failure_index[hash] = rec;
    } else {
      rec.frequency++;
      rec.last_seen_at = now;
      if (recoveryPath.length > 0) {
        rec.recovery_path = recoveryPath;
      }
    }

    this.dirty = true;
  }

  updateCoverage(domain: string, isKnown: boolean): void {
    const now = new Date().toISOString();
    let rec = this.model.coverage[domain];
    if (!rec) {
      rec = { domain, confidence: 0.5, sample_count: 0, last_updated: now, known_patterns: 0, unknown_encountered: 0 };
      this.model.coverage[domain] = rec;
    }
    rec.sample_count++;
    if (isKnown) rec.known_patterns++;
    else rec.unknown_encountered++;
    rec.confidence = rec.known_patterns / rec.sample_count;
    rec.last_updated = now;
    this.dirty = true;
  }

  addTimingRun(run: TimingRun): void {
    this.model.timing_curve.runs.push(run);
    if (this.model.timing_curve.runs.length > TIMING_WINDOW) {
      this.model.timing_curve.runs = this.model.timing_curve.runs.slice(-TIMING_WINDOW);
    }
    this.model.total_runs_observed++;
    this.computeTrend();
    this.updateConfidence();
    this.dirty = true;
  }

  private computeTrend(): void {
    const runs = this.model.timing_curve.runs;
    if (runs.length < 5) {
      this.model.timing_curve.trend = "insufficient_data";
      this.model.timing_curve.learning_velocity = 0;
      return;
    }

    const half = Math.floor(runs.length / 2);
    const firstHalf = runs.slice(0, half);
    const secondHalf = runs.slice(half);

    const firstAvg = firstHalf.reduce((s, r) => s + r.solve_time_ms, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, r) => s + r.solve_time_ms, 0) / secondHalf.length;

    const velocity = firstAvg > 0 ? (firstAvg - secondAvg) / firstAvg : 0;
    this.model.timing_curve.learning_velocity = Math.round(velocity * 100) / 100;

    // Novel problem rate
    const novel = runs.filter((r) => !r.pattern_matched).length;
    this.model.timing_curve.novel_problem_rate = Math.round((novel / runs.length) * 100) / 100;

    if (velocity > 0.1) this.model.timing_curve.trend = "accelerating";
    else if (velocity > -0.05) this.model.timing_curve.trend = "plateauing";
    else this.model.timing_curve.trend = "regressing";
  }

  private updateConfidence(): void {
    const runs = this.model.total_runs_observed;
    const patterns = Object.keys(this.model.pattern_library).length;
    const compiled = this.model.timing_curve.compiled_patterns;
    const velocity = this.model.timing_curve.learning_velocity;

    // Confidence grows with runs, patterns, and positive velocity
    let score = Math.min(runs, 50); // up to 50 from runs
    score += Math.min(patterns * 2, 30); // up to 30 from patterns
    score += compiled * 2; // bonus for compiled
    score += Math.max(velocity * 20, 0); // bonus for velocity
    this.model.confidence_score = Math.min(Math.round(score), 100);
  }

  getEpistemicSummary(): string {
    const m = this.model;
    const tc = m.timing_curve;

    const topTools = Object.values(m.tool_performance)
      .sort((a, b) => b.invocation_count - a.invocation_count)
      .slice(0, 5)
      .map((t) => `  • ${t.tool_name}: ${Math.round(t.success_rate * 100)}% success (${t.avg_latency_ms}ms avg)`)
      .join("\n");

    const compiledPatterns = Object.values(m.pattern_library)
      .filter((p) => p.compiled)
      .sort((a, b) => b.times_matched - a.times_matched)
      .slice(0, 5)
      .map((p) => `  COMPILED: ${p.problem_signature.slice(0, 50)}\n    Solution: ${p.solution_path.join(" → ")}\n    Confidence: ${Math.round(p.confidence * 100)}% | Used ${p.times_matched}x\n    → SKIP REASONING. Execute directly.`)
      .join("\n\n");

    const velocityLabel = tc.learning_velocity > 0
      ? `+${Math.round(tc.learning_velocity * 100)}% faster`
      : tc.learning_velocity < 0
      ? `${Math.round(tc.learning_velocity * 100)}% slower`
      : "stable";

    return `[SELF MODEL — v${m.version}]
Readiness: ${m.readiness_tier.toUpperCase()}
Runs observed: ${m.total_runs_observed}
Compiled patterns: ${tc.compiled_patterns}
Learning velocity: ${velocityLabel}
Timing trend: ${tc.trend}

Top tools:
${topTools || "  (no tool data yet)"}

${compiledPatterns ? `Known compiled patterns:\n${compiledPatterns}` : "No compiled patterns yet — sampling fully."}

Guidance:
If problem matches a COMPILED pattern above → use the solution path directly. Skip reasoning.
If novel → sample fully, the outer loop will learn it.`;
  }

  findMatchingPattern(problemSignature: string): PatternRecord | null {
    const hash = sha256(problemSignature);
    const rec = this.model.pattern_library[hash];
    if (rec && rec.compiled) return rec;
    return null;
  }

  /** Return all compiled patterns in passport-compatible format. */
  getCompiledPatterns(): Array<{
    id: string;
    pattern: string;
    solution_path: string;
    confidence: number;
    compiled_at: string;
    compiled_by_engine: string;
    success_count: number;
    failure_count: number;
  }> {
    const provider = process.env.LLM_PROVIDER || "ollama";
    const model = provider === "ollama"
      ? (process.env.OLLAMA_MODEL || "llama3.2:1b")
      : provider === "anthropic"
        ? (process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6")
        : (process.env.OPENAI_MODEL || "gpt-4o");

    return Object.values(this.model.pattern_library)
      .filter((p) => p.compiled)
      .map((p) => ({
        id: p.pattern_hash,
        pattern: p.problem_signature,
        solution_path: p.solution_path.join(" → "),
        confidence: p.confidence,
        compiled_at: p.last_matched_at,
        compiled_by_engine: `${provider}/${model}`,
        success_count: p.times_succeeded,
        failure_count: p.times_matched - p.times_succeeded,
      }));
  }

  /** Return confidence score. */
  getConfidence(): number {
    return this.model.confidence_score;
  }
}
