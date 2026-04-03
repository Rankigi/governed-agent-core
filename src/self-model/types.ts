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

/* ── Category-Based Pattern Matching ──────────────────── */

export type PatternCategory =
  | "math_calculation"
  | "geography_capital"
  | "geography_fact"
  | "memory_store"
  | "memory_recall"
  | "summarize_text"
  | "explain_concept"
  | "code_task"
  | "web_search_needed"
  | "conversational"
  | "general";

export interface PatternSignature {
  category: PatternCategory;
  keywords: string[];
  tool_hint: string | null;
  label: string;
}

export const PATTERN_SIGNATURES: PatternSignature[] = [
  {
    category: "math_calculation",
    keywords: ["calculate", "what is", "×", "*", "+", "-", "/", "multiply", "divide", "add", "subtract", "sum", "product", "squared", "sqrt", "percent"],
    tool_hint: "calculator",
    label: "Math calculation tasks",
  },
  {
    category: "geography_capital",
    keywords: ["capital of", "capital city", "what is the capital"],
    tool_hint: null,
    label: "Capital city questions",
  },
  {
    category: "geography_fact",
    keywords: ["where is", "which country", "which city", "which continent", "population of", "located in"],
    tool_hint: null,
    label: "Geography fact questions",
  },
  {
    category: "memory_store",
    keywords: ["remember:", "remember that", "save that", "note that", "log that", "fyi:", "store:"],
    tool_hint: "memory_file",
    label: "Store user information",
  },
  {
    category: "memory_recall",
    keywords: ["what did i", "do you remember", "what is my", "recall", "what was", "remind me"],
    tool_hint: null,
    label: "Recall stored information",
  },
  {
    category: "summarize_text",
    keywords: ["summarize:", "summarize this", "tldr", "brief summary", "condense", "in short"],
    tool_hint: null,
    label: "Summarize given text",
  },
  {
    category: "explain_concept",
    keywords: ["what is", "explain", "how does", "why does", "what are", "describe"],
    tool_hint: null,
    label: "Explain a concept",
  },
  {
    category: "code_task",
    keywords: ["write code", "function that", "implement", "refactor", "debug this", "fix this code"],
    tool_hint: null,
    label: "Code generation tasks",
  },
  {
    category: "web_search_needed",
    keywords: ["latest", "current", "today", "recent", "news", "price of", "stock", "weather"],
    tool_hint: "web_search",
    label: "Web search needed",
  },
  {
    category: "conversational",
    keywords: ["hello", "hi", "hey", "how are you", "thanks", "thank you", "bye", "good"],
    tool_hint: null,
    label: "Conversational",
  },
];

export function classifyInput(input: string): PatternCategory {
  const lower = input.toLowerCase();
  let bestCategory: PatternCategory = "general";
  let bestScore = 0;
  for (const sig of PATTERN_SIGNATURES) {
    let score = 0;
    for (const kw of sig.keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = sig.category;
    }
  }
  return bestCategory;
}

export function getCategoryLabel(category: PatternCategory): string {
  const sig = PATTERN_SIGNATURES.find((s) => s.category === category);
  return sig?.label ?? "General tasks";
}

export function getCategoryToolHint(category: PatternCategory): string | null {
  const sig = PATTERN_SIGNATURES.find((s) => s.category === category);
  return sig?.tool_hint ?? null;
}

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
