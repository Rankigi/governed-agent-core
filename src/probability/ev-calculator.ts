import crypto from "crypto";
import type { EVCalculation, ProbabilityDistribution } from "./types";
import type { ProbabilityStore } from "./store";
import type { SelfModelStore } from "../self-model/store";

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

const DEFAULT_RISK_LIMITS: Record<string, number> = {
  finance: 1000,
  governance: 500,
  research: 200,
  engineering: 300,
  communication: 100,
  legal: 2000,
  general: 500,
};

export class EVCalculator {
  private probStore: ProbabilityStore;
  private selfModel: SelfModelStore | null;

  constructor(probStore: ProbabilityStore, selfModel?: SelfModelStore) {
    this.probStore = probStore;
    this.selfModel = selfModel ?? null;
  }

  calculate(
    action: string,
    domain: string,
    valueIfSuccess: number,
    costIfFailure: number,
  ): EVCalculation {
    const dist = this.probStore.getDistribution(domain, action);

    // Blend distribution base_rate with self-model pattern confidence
    const patternConf = this.getPatternConfidence(action, domain);
    const predictedProbability = this.blendProbabilities(dist.base_rate, patternConf, dist.sample_count);

    // Calculate expected value
    const expectedValue = (predictedProbability * valueIfSuccess) - ((1 - predictedProbability) * costIfFailure);

    // Run 5-layer decision stack
    const decision = this.runDecisionStack(predictedProbability, expectedValue, costIfFailure, dist, domain);

    return {
      action,
      domain,
      predicted_probability: predictedProbability,
      value_if_success: valueIfSuccess,
      cost_if_failure: costIfFailure,
      expected_value: expectedValue,
      ...decision,
      ev_confidence: this.computeEVConfidence(dist),
    };
  }

  private runDecisionStack(
    probability: number,
    ev: number,
    costIfFailure: number,
    dist: ProbabilityDistribution,
    domain: string,
  ): Pick<EVCalculation, "confidence_floor_passed" | "risk_threshold_passed" | "ev_positive" | "novel_territory" | "subconscious_veto" | "should_act" | "rejection_reason"> {

    // LAYER 1 — Confidence floor
    const confidenceFloorPassed = dist.confidence_in_distribution >= 0.4;
    if (!confidenceFloorPassed) {
      return {
        confidence_floor_passed: false,
        risk_threshold_passed: false,
        ev_positive: false,
        novel_territory: true,
        subconscious_veto: false,
        should_act: false,
        rejection_reason: `Confidence below floor — only ${dist.sample_count} samples, need more calibration data.`,
      };
    }

    // LAYER 2 — Risk threshold
    const riskLimit = DEFAULT_RISK_LIMITS[domain] ?? DEFAULT_RISK_LIMITS.general;
    const riskThresholdPassed = costIfFailure <= riskLimit;
    if (!riskThresholdPassed) {
      return {
        confidence_floor_passed: true,
        risk_threshold_passed: false,
        ev_positive: false,
        novel_territory: false,
        subconscious_veto: false,
        should_act: false,
        rejection_reason: `Downside $${costIfFailure} exceeds risk limit $${riskLimit} for ${domain}.`,
      };
    }

    // LAYER 3 — EV positive
    const evPositive = ev > 0;
    if (!evPositive) {
      return {
        confidence_floor_passed: true,
        risk_threshold_passed: true,
        ev_positive: false,
        novel_territory: false,
        subconscious_veto: false,
        should_act: false,
        rejection_reason: `Negative EV: ${ev.toFixed(2)}`,
      };
    }

    // LAYER 4 — Novel territory
    const novelTerritory = dist.sample_count < 10;

    // LAYER 5 — Subconscious veto (behavioral drift detection)
    const subconsciousVeto = this.checkSubconsciousVeto(domain, dist);
    if (subconsciousVeto) {
      return {
        confidence_floor_passed: true,
        risk_threshold_passed: true,
        ev_positive: true,
        novel_territory: novelTerritory,
        subconscious_veto: true,
        should_act: false,
        rejection_reason: "Subconscious veto — regime change detected, distribution unstable.",
      };
    }

    // All 5 layers passed
    return {
      confidence_floor_passed: true,
      risk_threshold_passed: true,
      ev_positive: true,
      novel_territory: novelTerritory,
      subconscious_veto: false,
      should_act: true,
    };
  }

  private blendProbabilities(baseRate: number, patternConfidence: number, sampleCount: number): number {
    const baseWeight = Math.min(sampleCount / 50, 1);
    const patternWeight = 1 - baseWeight;
    return (baseRate * baseWeight) + (patternConfidence * patternWeight);
  }

  private getPatternConfidence(action: string, domain: string): number {
    if (!this.selfModel) return 0.5;
    const sig = `${domain}:${action}`;
    const pattern = this.selfModel.findMatchingPattern(sig);
    return pattern?.confidence ?? 0.5;
  }

  private computeEVConfidence(dist: ProbabilityDistribution): number {
    const calibrationFactor = 1 - dist.calibration_error;
    const sampleFactor = Math.min(dist.sample_count / 100, 1);
    return (calibrationFactor * 0.6) + (sampleFactor * 0.4);
  }

  private checkSubconsciousVeto(domain: string, dist: ProbabilityDistribution): boolean {
    return this.probStore.detectRegimeChange(domain, dist.action_type);
  }
}
