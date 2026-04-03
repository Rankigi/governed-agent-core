/**
 * Passport Data Layer — Types
 *
 * Memory, patterns, beliefs, and trust belong to the passport forever.
 * The engine is just the reasoning layer. Swap it anytime. Lose nothing.
 */

export interface CompiledPattern {
  id: string;
  /** Original triggering input (legacy) or category id */
  pattern: string;
  /** Category-based matching */
  category: string;
  category_label: string;
  /** Example inputs that triggered this pattern (max 5) */
  example_inputs: string[];
  solution_path: string;
  tool_hint: string | null;
  confidence: number;
  compiled_at: string;
  /** Which engine compiled this pattern */
  compiled_by_engine: string;
  success_count: number;
  failure_count: number;
  /** How many novel inputs this pattern generalized to */
  novel_matches: number;
  last_matched_at: string;
}

export interface EngineRecord {
  /** ollama | anthropic | openai */
  provider: string;
  model: string;
  started_at: string;
  /** null = current engine */
  ended_at: string | null;
  runs_completed: number;
  patterns_compiled: number;
  memory_layers_filed: number;
  final_confidence: number;
  reason_for_switch?: string;
  /** Hash of the brief generated on engine switch */
  transition_brief_hash?: string;
}

export interface TrustSnapshot {
  standing: "good" | "warning" | "suspended" | "revoked";
  compliance_score: number;
  confidence_score: number;
  recorded_at: string;
  chain_index: number;
}

export interface PassportData {
  // Identity — never changes
  passport_id: string;
  passport_hash: string;
  agent_uuid: string;
  org_id: string;
  display_name: string;
  born_at: string;

  // Beliefs — sealed at genesis, never changes regardless of engine
  core_beliefs_hash: string;
  core_beliefs: string[];

  // Memory — survives all engine swaps
  memory_stack_path: string;
  memory_layer_count: number;
  memory_foundation_hash: string;

  // Patterns — survives all engine swaps
  compiled_patterns: CompiledPattern[];

  // Trust — survives all engine swaps
  trust_history: TrustSnapshot[];
  current_trust: TrustSnapshot;

  // Chain state
  chain_index: number;
  last_event_hash: string;
  total_runs: number;

  // Engine (swappable)
  current_engine: EngineRecord;
  engine_history: EngineRecord[];

  // Schema version for migration
  schema_version: number;
  last_updated: string;
}

export interface TransitionBrief {
  brief_id: string;
  generated_at: string;

  from_engine: EngineRecord;
  to_engine: {
    provider: string;
    model: string;
  };

  /** What was learned under old engine */
  learned: {
    total_runs: number;
    patterns_compiled: CompiledPattern[];
    memory_layers: number;
    final_confidence: number;
    pattern_summary: string[];
    weaknesses: string[];
    tool_stats: {
      tool: string;
      success_rate: number;
      avg_ms: number;
    }[];
  };

  /** What the new engine inherits */
  inherits: {
    memory_layers: number;
    compiled_patterns: number;
    core_beliefs: string[];
    trust_standing: string;
    compliance_score: number;
    chain_index: number;
  };

  /** Old engine's parting message to the new one */
  handoff_message: string;

  /** SHA-256 of entire brief, written to chain */
  brief_hash: string;
}
