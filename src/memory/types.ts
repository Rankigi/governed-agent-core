/**
 * Akashic Pulse Memory — Type Definitions
 *
 * Three components:
 *   1. MemoryLayer — delta-compressed, hash-chained, immutable
 *   2. ResonanceIndex — lightweight lookup, loaded at startup
 *   3. PulseResult — what comes back from a broadcast signal
 */

export interface ResonanceIndex {
  /** SHA-256 of full layer content */
  layer_hash: string;

  /** Parent layer hash. null = foundation layer (root of tree) */
  parent_hash: string | null;

  layer_type:
    | "foundation"   // Base knowledge, rarely changes
    | "task_history"  // What happened in past runs
    | "pattern"       // Compiled behavioral patterns
    | "belief"        // Core beliefs (sealed)
    | "session";      // Current session context

  created_at: string;

  /** Which run created this layer */
  run_index: number;

  /**
   * THE RESONANCE KEYS
   * Words/concepts that make this layer light up during pulse.
   * Extracted from layer content by subconscious on filing.
   * Max 50 keys per layer.
   */
  keys: string[];

  /** Size metadata */
  content_size_bytes: number;
  delta_size_bytes: number;
  compression_ratio: number;

  /** Layers that reference this one as parent */
  child_hashes: string[];
}

export interface MemoryLayer {
  index: ResonanceIndex;

  /** Full content — only loaded when surfaced after pulse */
  content: {
    /** What this layer contains in plain language */
    summary: string;

    /** What changed from parent — not full content, just diff */
    delta: Record<string, unknown>;

    /** Optional: compressed raw text */
    raw_context?: string;

    /** Patterns compiled this layer */
    compiled_patterns?: string[];

    /** Confidence at time of filing */
    confidence_snapshot?: number;

    /** Tool performance snapshot */
    tool_outcomes?: {
      tool: string;
      success_rate: number;
      avg_ms: number;
    }[];
  };

  /** The RANKIGI chain event that recorded this layer being filed */
  chain_event_id?: string;
}

export interface PulseResult {
  query: string;

  /** How fast the pulse completed (ms) */
  pulse_ms: number;

  resonant_layers: {
    layer_hash: string;
    layer_type: string;
    resonance_score: number; // 0-100
    keys_matched: string[];
    run_index: number;
  }[];

  /** Layers loaded after pulse — only highest resonance */
  surfaced: MemoryLayer[];

  total_layers_pulsed: number;
  layers_surfaced: number;

  /** tokens_surfaced / tokens_if_full */
  compression_ratio: number;
}
