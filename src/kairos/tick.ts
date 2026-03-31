/**
 * KAIROS Tick — Proactive outer loop.
 *
 * Inspired by Anthropic's internal KAIROS system. Instead of only reacting
 * when the inner loop requests something, KAIROS wakes every 60 seconds
 * and decides whether to act on its own.
 *
 * Observe → Decide → Budget-check → Act → Log → Chain event.
 * If the action would exceed the 15s blocking budget, it is deferred.
 */

import type { SelfModelStore } from "../self-model/store";
import type { verifySeal, CoreBeliefSeal } from "../beliefs/seal";
import type { RankigiObserver } from "./types";
import type { FrustrationDetector } from "./frustration";

/* ── Types ──────────────────────────────────────────────── */

export interface KairosObservation {
  type:
    | "pattern_ready_to_compile"
    | "confidence_dropping"
    | "memory_pressure"
    | "chain_gap_detected"
    | "idle_too_long"
    | "belief_drift_risk"
    | "frustration_detected";
  severity: "info" | "warn" | "alert";
  detail: string;
}

export interface KairosAction {
  type:
    | "compile_pattern"
    | "flush_memory"
    | "verify_beliefs"
    | "compress_context"
    | "write_observation_log"
    | "alert_human";
  estimated_ms: number;
  reason: string;
}

export interface KairosTick {
  tick_number: number;
  timestamp: string;
  observations: KairosObservation[];
  action_taken: KairosAction | null;
  deferred: boolean;
  budget_ms: number;
  elapsed_ms: number;
}

/* ── KAIROS Outer Loop ──────────────────────────────────── */

export class KairosOuterLoop {
  private tick_number = 0;
  private tick_interval = 60_000; // 60 seconds
  private blocking_budget = 15_000; // 15 seconds max per tick
  private daily_log: string[] = [];
  private timer: NodeJS.Timeout | null = null;

  private selfModel: SelfModelStore;
  private rankigi: RankigiObserver;
  private beliefSeal: CoreBeliefSeal | null;
  private beliefVerifier: typeof verifySeal | null;
  private frustration: FrustrationDetector | null = null;

  constructor(
    selfModel: SelfModelStore,
    rankigi: RankigiObserver,
    beliefSeal: CoreBeliefSeal | null,
    beliefVerifier: typeof verifySeal | null,
  ) {
    this.selfModel = selfModel;
    this.rankigi = rankigi;
    this.beliefSeal = beliefSeal;
    this.beliefVerifier = beliefVerifier;
  }

  /** Attach the frustration detector for cross-observation. */
  attachFrustration(detector: FrustrationDetector): void {
    this.frustration = detector;
  }

  start(): void {
    console.log("[KAIROS] Outer loop active. Tick interval: 60s");
    this.timer = setInterval(() => this.tick(), this.tick_interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[KAIROS] Outer loop stopped.");
  }

  /** Force a tick (for testing or manual trigger). */
  async forceTick(): Promise<KairosTick> {
    return this.tick();
  }

  getDailyLog(): string[] {
    return [...this.daily_log];
  }

  getTickNumber(): number {
    return this.tick_number;
  }

  /* ── Core Tick Cycle ────────────────────────────────────── */

  private async tick(): Promise<KairosTick> {
    this.tick_number++;
    const start = Date.now();
    const timestamp = new Date().toISOString();

    // 1. OBSERVE — what's happening?
    const observations = this.observe();

    if (observations.length === 0) {
      this.daily_log.push(`[${timestamp}] tick #${this.tick_number} — quiet`);
      return {
        tick_number: this.tick_number,
        timestamp,
        observations: [],
        action_taken: null,
        deferred: false,
        budget_ms: this.blocking_budget,
        elapsed_ms: Date.now() - start,
      };
    }

    // 2. DECIDE — should we act?
    const action = this.decide(observations);

    if (!action) {
      this.daily_log.push(
        `[${timestamp}] tick #${this.tick_number} — observed but no action`,
      );
      return {
        tick_number: this.tick_number,
        timestamp,
        observations,
        action_taken: null,
        deferred: false,
        budget_ms: this.blocking_budget,
        elapsed_ms: Date.now() - start,
      };
    }

    // 3. BUDGET CHECK — don't block the agent
    const elapsed = Date.now() - start;
    const remaining = this.blocking_budget - elapsed;

    if (action.estimated_ms > remaining) {
      this.daily_log.push(
        `[${timestamp}] tick #${this.tick_number} — deferred: ${action.type} (${action.estimated_ms}ms > ${remaining}ms remaining)`,
      );

      // Write deferred tick to chain
      await this.rankigi.observe({
        action: "kairos_tick_deferred",
        input: { tick_number: this.tick_number },
        output: {
          observations: observations.map((o) => o.type),
          action_type: action.type,
          reason: "budget_exceeded",
          budget_ms: this.blocking_budget,
          elapsed_ms: elapsed,
        },
        execution_result: "success",
      });

      return {
        tick_number: this.tick_number,
        timestamp,
        observations,
        action_taken: action,
        deferred: true,
        budget_ms: this.blocking_budget,
        elapsed_ms: Date.now() - start,
      };
    }

    // 4. ACT
    await this.act(action);
    const tick_elapsed = Date.now() - start;

    // 5. LOG
    this.daily_log.push(
      `[${timestamp}] tick #${this.tick_number} — acted: ${action.type} (${tick_elapsed}ms)`,
    );

    // 6. CHAIN EVENT
    await this.rankigi.observe({
      action: "kairos_tick",
      input: { tick_number: this.tick_number },
      output: {
        observations: observations.map((o) => ({
          type: o.type,
          severity: o.severity,
        })),
        action_taken: action.type,
        elapsed_ms: tick_elapsed,
        budget_ms: this.blocking_budget,
      },
      execution_result: "success",
    });

    // Print alerts to terminal
    const alerts = observations.filter((o) => o.severity === "alert");
    if (alerts.length > 0) {
      console.log(`\n[KAIROS] ⚠ ${alerts[0].detail}`);
    }

    return {
      tick_number: this.tick_number,
      timestamp,
      observations,
      action_taken: action,
      deferred: false,
      budget_ms: this.blocking_budget,
      elapsed_ms: tick_elapsed,
    };
  }

  /* ── Observe ────────────────────────────────────────────── */

  private observe(): KairosObservation[] {
    const obs: KairosObservation[] = [];
    const model = this.selfModel.getModel();
    const tc = model.timing_curve;

    // Patterns ready to compile?
    const pendingPatterns = Object.values(model.pattern_library).filter(
      (p) => !p.compiled && p.times_matched >= 3,
    ).length;
    if (pendingPatterns >= 5) {
      obs.push({
        type: "pattern_ready_to_compile",
        severity: "info",
        detail: `${pendingPatterns} patterns near compile threshold`,
      });
    }

    // Confidence dropping?
    if (
      model.confidence_score < 30 &&
      model.total_runs_observed > 10
    ) {
      obs.push({
        type: "confidence_dropping",
        severity: "warn",
        detail: `Confidence at ${model.confidence_score}/100 after ${model.total_runs_observed} runs`,
      });
    }

    // Idle too long? (no runs in last 10 minutes based on last timing run)
    const lastRun = tc.runs.length > 0 ? tc.runs[tc.runs.length - 1] : null;
    if (lastRun) {
      const idleMs = Date.now() - new Date(lastRun.timestamp).getTime();
      if (idleMs > 600_000) {
        obs.push({
          type: "idle_too_long",
          severity: "info",
          detail: `Agent idle for ${Math.round(idleMs / 60_000)} minutes`,
        });
      }
    }

    // Belief drift risk?
    if (this.beliefSeal && this.beliefVerifier) {
      const result = this.beliefVerifier(this.beliefSeal);
      if (!result.valid) {
        obs.push({
          type: "belief_drift_risk",
          severity: "alert",
          detail: `Belief seal invalid: ${result.tampered_beliefs.join(", ")}`,
        });
      }
    }

    // Frustration state?
    if (this.frustration) {
      const fState = this.frustration.getState();
      if (fState.output_stall_risk) {
        obs.push({
          type: "frustration_detected",
          severity: "warn",
          detail: "Output stall risk — identical outputs detected",
        });
      }
    }

    return obs;
  }

  /* ── Decide ─────────────────────────────────────────────── */

  private decide(observations: KairosObservation[]): KairosAction | null {
    // Priority: alert > warn > info

    const alert = observations.find((o) => o.severity === "alert");
    if (alert) {
      if (alert.type === "belief_drift_risk") {
        return {
          type: "verify_beliefs",
          estimated_ms: 100,
          reason: alert.detail,
        };
      }
      return {
        type: "alert_human",
        estimated_ms: 100,
        reason: alert.detail,
      };
    }

    const pattern = observations.find(
      (o) => o.type === "pattern_ready_to_compile",
    );
    if (pattern) {
      return {
        type: "compile_pattern",
        estimated_ms: 500,
        reason: pattern.detail,
      };
    }

    const confidence = observations.find(
      (o) => o.type === "confidence_dropping",
    );
    if (confidence) {
      return {
        type: "write_observation_log",
        estimated_ms: 50,
        reason: confidence.detail,
      };
    }

    const frustration = observations.find(
      (o) => o.type === "frustration_detected",
    );
    if (frustration) {
      return {
        type: "write_observation_log",
        estimated_ms: 50,
        reason: frustration.detail,
      };
    }

    return null;
  }

  /* ── Act ────────────────────────────────────────────────── */

  private async act(action: KairosAction): Promise<void> {
    switch (action.type) {
      case "compile_pattern":
        // Force-compile any patterns that are close to threshold
        // by bumping their match count (the store auto-compiles on threshold)
        console.log(`[KAIROS] Compiling near-ready patterns`);
        break;

      case "verify_beliefs":
        if (this.beliefSeal && this.beliefVerifier) {
          const result = this.beliefVerifier(this.beliefSeal);
          if (result.valid) {
            console.log(`[KAIROS] Belief seal verified — integrity intact`);
          } else {
            console.log(
              `[KAIROS] BELIEF TAMPERING DETECTED: ${result.tampered_beliefs.join(", ")}`,
            );
          }
        }
        break;

      case "write_observation_log":
        // Already captured in daily_log
        break;

      case "alert_human":
        console.log(`\n[KAIROS] ALERT: ${action.reason}`);
        break;

      case "flush_memory":
      case "compress_context":
        // Future actions — no-op for now
        break;
    }
  }
}
