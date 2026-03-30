import type { ActionOutcome } from "./types";
import type { ProbabilityStore } from "./store";

export class CalibrationEngine {
  private probStore: ProbabilityStore;

  constructor(probStore: ProbabilityStore) {
    this.probStore = probStore;
  }

  onOutcome(
    actionId: string,
    domain: string,
    actionType: string,
    predictedProbability: number,
    actualOutcome: "success" | "failure",
    actualValue: number,
    chainIndex: number,
  ): { calibrationWarning: boolean; regimeChanged: boolean; calibrationError: number } {
    const calibrationError = Math.abs(
      predictedProbability - (actualOutcome === "success" ? 1 : 0),
    );

    const outcome: ActionOutcome = {
      action_id: actionId,
      action_description: actionType,
      predicted_probability: predictedProbability,
      predicted_value: actualValue,
      predicted_cost_if_wrong: 0,
      expected_value: 0,
      actual_outcome: actualOutcome,
      actual_value: actualValue,
      calibration_error: calibrationError,
      timestamp: new Date().toISOString(),
      chain_index: chainIndex,
      domain,
    };

    this.probStore.recordOutcome(outcome);

    // Check calibration health
    const dist = this.probStore.getDistribution(domain, actionType);
    const calibrationWarning = dist.calibration_error > 0.15;

    if (calibrationWarning) {
      const direction = dist.predicted_avg > dist.actual_avg ? "overconfident" : "underconfident";
      console.log(`[CALIBRATED MIND] Warning: ${domain}/${actionType} is ${direction} (error: ${dist.calibration_error.toFixed(3)})`);
    }

    // Check for regime change
    const regimeChanged = this.probStore.detectRegimeChange(domain, actionType);
    if (regimeChanged) {
      console.log(`[CALIBRATED MIND] Regime change: ${domain}/${actionType} base_rate=${dist.base_rate.toFixed(2)} but last_10=${dist.last_10_success_rate.toFixed(2)}`);
    }

    return { calibrationWarning, regimeChanged, calibrationError };
  }

  computeBrierScore(outcomes: ActionOutcome[]): number {
    if (outcomes.length === 0) return 0.25;
    const sum = outcomes.reduce((acc, o) => {
      const actual = o.actual_outcome === "success" ? 1 : 0;
      return acc + Math.pow(o.predicted_probability - actual, 2);
    }, 0);
    return sum / outcomes.length;
  }
}
