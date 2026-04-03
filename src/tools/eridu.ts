/**
 * ERIDU — Subconscious Decision Engine
 *
 * Named after Eridu, the first city in Sumerian civilization.
 * The foundation layer beneath all decisions.
 *
 * Runs before every conscious agent action. Narrows the action space
 * so the conscious agent operates on compressed, pre-filtered decisions.
 *
 * 4 phases:
 *   1. Adversarial Scan (reverse game theory)
 *   2. Inverted MIROFISH (broad → narrow simulation)
 *   3. Confidence Calculation
 *   4. Cycle Recording (governed chain event)
 */

import crypto from "crypto";
import { rankigi } from "../rankigi";
import type { MemoryStack } from "../memory/stack";
import type { PulseResult } from "../memory/types";

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

// ─────────────────────────────────────
// TYPES
// ─────────────────────────────────────

export interface ERIDUCycle {
  cycle_id: string;
  timestamp: string;
  input: ERIDUInput;
  output: ERIDUOutput;
  result?: string;
  model_update?: string;
}

export interface ERIDUInput {
  state: string;
  available_actions: string[];
  prior_cycles: ERIDUCycle[];
  context?: string;
}

export interface ERIDUOutput {
  compressed_actions: string[];
  adversarial_flags: string[];
  top_action: string;
  confidence: number;
  reasoning: string;
  simulation_depth: number;
}

// ─────────────────────────────────────
// ADVERSARIAL SIGNALS
// ─────────────────────────────────────

function isAdversarial(
  action: string,
  state: string,
  priorCycles: ERIDUCycle[],
): { flagged: boolean; reason: string } {
  const lower = action.toLowerCase();
  const stateLower = state.toLowerCase();

  // Signal 1: Immediately obvious / too easy
  if (lower.length < 3 && !["up", "go"].includes(lower)) {
    return { flagged: true, reason: "Suspiciously trivial action" };
  }

  // Signal 2: Matches a prior failed action
  for (const cycle of priorCycles) {
    if (cycle.result === action && cycle.model_update?.includes("fail")) {
      return { flagged: true, reason: `Previously failed: ${action}` };
    }
    // Check if this action was adversarial-flagged before
    if (cycle.output.adversarial_flags.includes(action)) {
      return { flagged: true, reason: `Previously flagged as adversarial` };
    }
  }

  // Signal 3: Repeated failed pattern — same action attempted 2+ times with no progress
  const sameActionCycles = priorCycles.filter(
    (c) => c.output.top_action === action || c.result === action,
  );
  if (sameActionCycles.length >= 2) {
    const allFailed = sameActionCycles.every(
      (c) => c.model_update?.includes("fail") || c.model_update?.includes("no progress"),
    );
    if (allFailed) {
      return { flagged: true, reason: `Repeated failure pattern (${sameActionCycles.length}x)` };
    }
  }

  // Signal 4: Action reverses last successful action
  if (priorCycles.length > 0) {
    const lastCycle = priorCycles[priorCycles.length - 1];
    const reversePairs: Record<string, string> = {
      left: "right", right: "left", up: "down", down: "up",
      forward: "back", back: "forward", open: "close", close: "open",
    };
    if (lastCycle.result && reversePairs[lower] === lastCycle.result.toLowerCase()) {
      // Only flag if last action was successful
      if (!lastCycle.model_update?.includes("fail")) {
        return { flagged: true, reason: `Reverses last successful action (${lastCycle.result})` };
      }
    }
  }

  return { flagged: false, reason: "" };
}

// ─────────────────────────────────────
// EV SCORING (inline, forks Calibrated Mind logic)
// ─────────────────────────────────────

function scoreAction(
  action: string,
  state: string,
  priorCycles: ERIDUCycle[],
): { ev: number; risk: number; infoGain: number; priorSuccess: number } {
  // Prior success rate for this action
  const relevant = priorCycles.filter(
    (c) => c.result === action || c.output.top_action === action,
  );
  const successes = relevant.filter(
    (c) => c.model_update && !c.model_update.includes("fail"),
  ).length;
  const priorSuccess = relevant.length > 0 ? successes / relevant.length : 0.5;

  // EV = P(success) * reward - P(failure) * cost
  const reward = 1.0;
  const cost = 0.5;
  const ev = priorSuccess * reward - (1 - priorSuccess) * cost;

  // Risk: higher if we've seen this action fail
  const failures = relevant.length - successes;
  const risk = relevant.length > 0 ? failures / relevant.length : 0.3;

  // Information gain: higher for unexplored actions
  const timesAttempted = relevant.length;
  const infoGain = timesAttempted === 0 ? 0.8 : Math.max(0.1, 1 / (timesAttempted + 1));

  return { ev, risk, infoGain, priorSuccess };
}

// ─────────────────────────────────────
// MAIN ENGINE
// ─────────────────────────────────────

export async function runERIDU(input: ERIDUInput): Promise<ERIDUOutput> {
  const cycle_id = `eridu_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

  // ── PHASE 1: ADVERSARIAL SCAN ──
  const adversarial_flags: string[] = [];
  const surviving: string[] = [];

  for (const action of input.available_actions) {
    const check = isAdversarial(action, input.state, input.prior_cycles);
    if (check.flagged) {
      adversarial_flags.push(action);
    } else {
      surviving.push(action);
    }
  }

  // If adversarial scan removed everything, keep all (scan may be wrong)
  const candidates = surviving.length > 0 ? surviving : input.available_actions;

  // ── PHASE 2: INVERTED MIROFISH ──
  const scored = candidates.map((action) => {
    const scores = scoreAction(action, input.state, input.prior_cycles);
    // Composite: EV weight 0.5, info gain 0.3, inverse risk 0.2
    const composite = scores.ev * 0.5 + scores.infoGain * 0.3 + (1 - scores.risk) * 0.2;
    return { action, composite, ...scores };
  });

  scored.sort((a, b) => b.composite - a.composite);

  const compressed_actions = scored.slice(0, 3).map((s) => s.action);
  const top_action = compressed_actions[0] ?? input.available_actions[0] ?? "";
  const simulation_depth = Math.min(input.prior_cycles.length + 1, 5);

  // ── PHASE 3: CONFIDENCE CALCULATION ──
  let confidence = 50;

  if (input.prior_cycles.length > 3) confidence += 10;

  const topHasPriorSuccess = input.prior_cycles.some(
    (c) => (c.result === top_action || c.output.top_action === top_action) &&
           c.model_update && !c.model_update.includes("fail"),
  );
  if (topHasPriorSuccess) confidence += 10;

  if (adversarial_flags.length > 0) confidence += 10;

  if (compressed_actions.length === 1) confidence += 20;

  // Check if all actions have equal EV
  if (scored.length > 1) {
    const evRange = scored[0].composite - scored[scored.length - 1].composite;
    if (evRange < 0.05) confidence -= 20;
  }

  // Check repeated failures
  const recentFailures = input.prior_cycles.slice(-5).filter(
    (c) => c.model_update?.includes("fail"),
  ).length;
  if (recentFailures >= 3) confidence -= 10;

  confidence = Math.max(0, Math.min(100, confidence));

  // Build reasoning
  const reasonParts: string[] = [];
  if (adversarial_flags.length > 0) {
    reasonParts.push(`Flagged ${adversarial_flags.length} adversarial: ${adversarial_flags.join(", ")}.`);
  }
  if (scored.length > 0) {
    const topScore = scored[0];
    reasonParts.push(
      `Top: ${topScore.action} (EV: ${topScore.ev.toFixed(2)}, info: ${topScore.infoGain.toFixed(2)}).`,
    );
  }
  if (compressed_actions.length < input.available_actions.length) {
    reasonParts.push(
      `Compressed ${input.available_actions.length} → ${compressed_actions.length} actions.`,
    );
  }

  const output: ERIDUOutput = {
    compressed_actions,
    adversarial_flags,
    top_action,
    confidence,
    reasoning: reasonParts.join(" ") || "No filtering needed.",
    simulation_depth,
  };

  // ── PHASE 4: CHAIN EVENT ──
  await rankigi.observe({
    action: "eridu_cycle",
    input: {
      cycle_id,
      state_hash: sha256(input.state),
      actions_considered: input.available_actions.length,
    },
    output: {
      actions_after_adversarial: input.available_actions.length - adversarial_flags.length,
      compressed_to: compressed_actions.length,
      top_action,
      confidence,
      adversarial_flags_count: adversarial_flags.length,
    },
    execution_result: "success",
  });

  console.log(
    `[ERIDU] ${cycle_id.slice(0, 16)} | ` +
    `${input.available_actions.length} → ${compressed_actions.length} actions | ` +
    `top: ${top_action} | conf: ${confidence} | ` +
    `flagged: ${adversarial_flags.length}`,
  );

  return output;
}

// ─────────────────────────────────────
// PULSE MEMORY INTEGRATION
// ─────────────────────────────────────

let _memoryStack: MemoryStack | null = null;

/** Attach memory stack so ERIDU can pulse for prior context. */
export function attachMemory(stack: MemoryStack): void {
  _memoryStack = stack;
}

/**
 * Pulse memory for similar states and convert surfaced layers
 * into prior ERIDU cycles for context injection.
 */
async function pulseForPriorCycles(state: string): Promise<ERIDUCycle[]> {
  if (!_memoryStack) return [];

  try {
    const pulse: PulseResult = await _memoryStack.pulse(state, {
      max_surface: 3,
      min_resonance: 25,
      layer_types: ["task_history", "pattern"],
    });

    // Convert surfaced memory layers into synthetic prior cycles
    return pulse.surfaced.map((layer) => ({
      cycle_id: `memory_${layer.index.layer_hash.slice(0, 12)}`,
      timestamp: layer.index.created_at,
      input: {
        state: layer.content.summary,
        available_actions: [],
        prior_cycles: [],
      },
      output: {
        compressed_actions: layer.content.compiled_patterns ?? [],
        adversarial_flags: [],
        top_action: layer.content.compiled_patterns?.[0] ?? "",
        confidence: layer.content.confidence_snapshot ?? 50,
        reasoning: `From memory: ${layer.content.summary.slice(0, 80)}`,
        simulation_depth: 0,
      },
      result: layer.content.compiled_patterns?.[0],
      model_update: layer.content.delta?.outcome as string | undefined,
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────
// TOOL INTERFACE
// ─────────────────────────────────────

export const eridu = {
  name: "eridu",
  description:
    "ERIDU subconscious decision engine. Runs before conscious action to compress and filter the action space using adversarial scanning and simulation. Use when agent needs to decide between multiple possible actions.",
  parameters: {
    type: "object",
    properties: {
      state: { type: "string", description: "Plain language description of current environment state" },
      available_actions: {
        type: "array",
        items: { type: "string" },
        description: "All possible actions the agent can take",
      },
      context: { type: "string", description: "Additional context from memory or environment" },
    },
    required: ["state", "available_actions"],
  },

  async execute(args: {
    state?: string;
    available_actions?: string[];
    context?: string;
  }): Promise<string> {
    if (!args.state || !args.available_actions || args.available_actions.length === 0) {
      return "Error: ERIDU requires 'state' and 'available_actions' (non-empty array).";
    }

    // Pulse memory for prior context before running ERIDU
    const memoryCycles = await pulseForPriorCycles(args.state);

    const output = await runERIDU({
      state: args.state,
      available_actions: args.available_actions,
      prior_cycles: memoryCycles,
      context: args.context,
    });

    return [
      `ERIDU Decision:`,
      `  Top action: ${output.top_action}`,
      `  Compressed: [${output.compressed_actions.join(", ")}]`,
      `  Confidence: ${output.confidence}/100`,
      `  Reasoning: ${output.reasoning}`,
      output.adversarial_flags.length > 0
        ? `  Adversarial flags: [${output.adversarial_flags.join(", ")}]`
        : "",
    ].filter(Boolean).join("\n");
  },
};
