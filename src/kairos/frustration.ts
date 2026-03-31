/**
 * Frustration Detection — tracks agent-side frustration signals.
 *
 * Inspired by Anthropic's telemetry that tracks frustration in Claude Code,
 * but flipped: we track frustration from the AGENT side, not the human side.
 *
 * Three signals:
 *   1. TOOL LOOP — same tool called 3+ times consecutively without progress
 *   2. OUTPUT STALL — identical output hash produced twice in a row
 *   3. CONFIDENCE COLLAPSE — confidence drops 20+ points across 5 consecutive runs
 *
 * Each signal writes immediately to the RANKIGI hash chain.
 */

import type { RankigiObserver } from "./types";

/* ── Types ──────────────────────────────────────────────── */

export interface FrustrationSignal {
  type: "tool_loop" | "output_stall" | "confidence_collapse";
  severity: "warn" | "alert";
  detail: string;
  run_index: number;
  timestamp: string;
}

export interface FrustrationState {
  run_index: number;
  recent_tools: string[];
  confidence_trend: number[];
  output_stall_risk: boolean;
}

/* ── Detector ───────────────────────────────────────────── */

export class FrustrationDetector {
  private tool_call_history: string[] = [];
  private output_hash_history: string[] = [];
  private confidence_history: number[] = [];
  private run_index = 0;
  private rankigi: RankigiObserver;

  constructor(rankigi: RankigiObserver) {
    this.rankigi = rankigi;
  }

  /**
   * Call after every tool use.
   * Returns a signal if tool loop is detected (same tool 3x in a row).
   */
  recordToolCall(tool_name: string): FrustrationSignal | null {
    this.tool_call_history.push(tool_name);

    // Keep last 10
    if (this.tool_call_history.length > 10) {
      this.tool_call_history.shift();
    }

    // Check: last 3 calls all the same tool?
    const last3 = this.tool_call_history.slice(-3);
    if (last3.length === 3 && last3.every((t) => t === tool_name)) {
      return this.flag({
        type: "tool_loop",
        severity: "warn",
        detail: `Tool loop detected: ${tool_name} called 3x consecutively`,
        run_index: this.run_index,
        timestamp: new Date().toISOString(),
      });
    }

    return null;
  }

  /**
   * Call after every agent output.
   * Returns a signal if output hash matches the previous one exactly.
   */
  recordOutput(output_hash: string): FrustrationSignal | null {
    const prev =
      this.output_hash_history.length > 0
        ? this.output_hash_history[this.output_hash_history.length - 1]
        : null;

    this.output_hash_history.push(output_hash);

    // Keep last 20
    if (this.output_hash_history.length > 20) {
      this.output_hash_history.shift();
    }

    // Check: identical output produced twice?
    if (prev && prev === output_hash) {
      return this.flag({
        type: "output_stall",
        severity: "warn",
        detail: "Output stall: identical output hash produced twice",
        run_index: this.run_index,
        timestamp: new Date().toISOString(),
      });
    }

    return null;
  }

  /**
   * Call after every run completes with the current confidence score.
   * Returns a signal if confidence drops 20+ points over last 5 runs.
   */
  recordConfidence(confidence: number): FrustrationSignal | null {
    this.run_index++;
    this.confidence_history.push(confidence);

    // Keep last 10
    if (this.confidence_history.length > 10) {
      this.confidence_history.shift();
    }

    // Check: confidence collapse (need 5 data points)
    if (this.confidence_history.length >= 5) {
      const last5 = this.confidence_history.slice(-5);
      const drop = last5[0] - last5[last5.length - 1];

      if (drop >= 20) {
        return this.flag({
          type: "confidence_collapse",
          severity: "alert",
          detail: `Confidence collapsed ${drop} points over last 5 runs (${last5[0]} → ${last5[last5.length - 1]})`,
          run_index: this.run_index,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return null;
  }

  /** Get current frustration state for KAIROS observation. */
  getState(): FrustrationState {
    const lastTwo = this.output_hash_history.slice(-2);
    const stallRisk =
      lastTwo.length === 2 && lastTwo[0] === lastTwo[1];

    return {
      run_index: this.run_index,
      recent_tools: this.tool_call_history.slice(-5),
      confidence_trend: this.confidence_history.slice(-5),
      output_stall_risk: stallRisk,
    };
  }

  /* ── Internal: Flag + Chain Event ───────────────────────── */

  private flag(signal: FrustrationSignal): FrustrationSignal {
    const icon = signal.severity === "alert" ? "🔴" : "🟡";
    console.log(`\n[FRUSTRATION] ${icon} ${signal.detail}`);

    // Write to chain — non-blocking (fire and forget)
    this.rankigi
      .observe({
        action: "frustration_detected",
        input: { signal_type: signal.type, run_index: signal.run_index },
        output: {
          severity: signal.severity,
          detail: signal.detail,
        },
        execution_result: "success",
      })
      .catch(() => {
        // RANKIGI down — no-op, sidecar is passive
      });

    return signal;
  }
}
