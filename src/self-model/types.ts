export interface ToolPerformanceRecord {
  tool_id: string;
  tool_name: string;
  invocation_count: number;
  success_count: number;
  failure_count: number;
  success_rate: number;
  avg_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  best_problem_types: string[];
  worst_problem_types: string[];
  last_used_at: string;
  first_used_at: string;
  latencies: number[]; // raw values for percentile calc
}

export interface PatternRecord {
  pattern_hash: string;
  problem_signature: string;
  solution_path: string[];
  avg_solve_time_ms: number;
  confidence: number;
  times_matched: number;
  times_succeeded: number;
  last_matched_at: string;
  first_discovered_at: string;
  chain_index_discovered: number;
  compiled: boolean;
}

export interface CoverageRecord {
  domain: string;
  confidence: number;
  sample_count: number;
  last_updated: string;
  known_patterns: number;
  unknown_encountered: number;
}

export interface FailureRecord {
  failure_hash: string;
  failure_type: "tool_unavailable" | "timeout" | "hallucination" | "policy_block" | "unknown_pattern" | "chain_error";
  frequency: number;
  first_seen_at: string;
  last_seen_at: string;
  recovery_path: string[];
  avoidance_signal: string;
  resolution_rate: number;
}

export interface TimingRun {
  run_id: string;
  chain_index_start: number;
  chain_index_end: number;
  problem_signature_hash: string;
  solve_time_ms: number;
  tools_invoked: number;
  pattern_matched: boolean;
  pattern_hash: string | null;
  skipped_reasoning_steps: number;
  timestamp: string;
}

export interface TimingCurve {
  runs: TimingRun[];
  trend: "accelerating" | "plateauing" | "regressing" | "insufficient_data";
  learning_velocity: number;
  compiled_patterns: number;
  novel_problem_rate: number;
}

export type ReadinessTier = "bootstrapping" | "learning" | "competent" | "compiled";

export interface SelfModel {
  agent_id: string;
  version: number;
  created_at: string;
  last_updated_at: string;
  total_runs_observed: number;
  tool_performance: Record<string, ToolPerformanceRecord>;
  pattern_library: Record<string, PatternRecord>;
  coverage: Record<string, CoverageRecord>;
  failure_index: Record<string, FailureRecord>;
  timing_curve: TimingCurve;
  model_hash: string;
  confidence_score: number;
  readiness_tier: ReadinessTier;
}
