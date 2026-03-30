import type { ActionOutcome, ProbabilityDistribution, CalibrationRecord } from "./types";

function makeKey(domain: string, actionType: string): string {
  return `${domain}:${actionType}`;
}

function createEmptyDist(domain: string, actionType: string): ProbabilityDistribution {
  const now = new Date().toISOString();
  return {
    domain,
    action_type: actionType,
    base_rate: 0.5,
    sample_count: 0,
    confidence_in_distribution: 0,
    predicted_avg: 0,
    actual_avg: 0,
    calibration_error: 0,
    last_10_success_rate: 0.5,
    last_updated: now,
    first_observed: now,
    outcomes: [],
  };
}

export class ProbabilityStore {
  private distributions: Map<string, ProbabilityDistribution> = new Map();
  private allOutcomes: ActionOutcome[] = [];

  load(serialized: string | null): void {
    if (!serialized) return;
    try {
      const data = JSON.parse(serialized) as {
        distributions: [string, ProbabilityDistribution][];
        outcomes: ActionOutcome[];
      };
      this.distributions = new Map(data.distributions);
      this.allOutcomes = data.outcomes ?? [];
    } catch { /* start fresh */ }
  }

  serialize(): string {
    return JSON.stringify({
      distributions: Array.from(this.distributions.entries()),
      outcomes: this.allOutcomes.slice(-500), // keep last 500
    });
  }

  getDistribution(domain: string, actionType: string): ProbabilityDistribution {
    const key = makeKey(domain, actionType);
    let dist = this.distributions.get(key);
    if (!dist) {
      dist = createEmptyDist(domain, actionType);
      this.distributions.set(key, dist);
    }
    return dist;
  }

  recordOutcome(outcome: ActionOutcome): void {
    this.allOutcomes.push(outcome);
    const key = makeKey(outcome.domain, outcome.action_description);
    let dist = this.distributions.get(key);
    if (!dist) {
      dist = createEmptyDist(outcome.domain, outcome.action_description);
      this.distributions.set(key, dist);
    }

    const actual = outcome.actual_outcome === "success" ? 1 : 0;
    dist.outcomes.push({ predicted: outcome.predicted_probability, actual });
    if (dist.outcomes.length > 200) dist.outcomes = dist.outcomes.slice(-200);

    dist.sample_count++;
    dist.last_updated = new Date().toISOString();

    // Recalculate base_rate
    const successCount = dist.outcomes.filter((o) => o.actual === 1).length;
    dist.base_rate = successCount / dist.outcomes.length;

    // Confidence grows with samples: 0 at 0, ~0.5 at 10, ~0.8 at 30, ~0.95 at 100
    dist.confidence_in_distribution = 1 - Math.exp(-dist.sample_count / 20);

    // Calibration: avg predicted vs avg actual
    dist.predicted_avg = dist.outcomes.reduce((s, o) => s + o.predicted, 0) / dist.outcomes.length;
    dist.actual_avg = dist.outcomes.reduce((s, o) => s + o.actual, 0) / dist.outcomes.length;
    dist.calibration_error = Math.abs(dist.predicted_avg - dist.actual_avg);

    // Last 10 success rate
    const last10 = dist.outcomes.slice(-10);
    dist.last_10_success_rate = last10.reduce((s, o) => s + o.actual, 0) / last10.length;
  }

  seedFromCorpus(corpus: { domain: string; action_type: string; historical_success_rate: number; sample_count: number }[]): void {
    for (const entry of corpus) {
      const key = makeKey(entry.domain, entry.action_type);
      const dist = createEmptyDist(entry.domain, entry.action_type);
      dist.base_rate = entry.historical_success_rate;
      dist.sample_count = entry.sample_count;
      dist.confidence_in_distribution = 1 - Math.exp(-entry.sample_count / 20);
      dist.predicted_avg = entry.historical_success_rate;
      dist.actual_avg = entry.historical_success_rate;
      dist.calibration_error = 0;
      dist.last_10_success_rate = entry.historical_success_rate;

      // Seed synthetic outcomes for the distribution
      for (let i = 0; i < Math.min(entry.sample_count, 100); i++) {
        const success = Math.random() < entry.historical_success_rate;
        dist.outcomes.push({ predicted: entry.historical_success_rate, actual: success ? 1 : 0 });
      }

      this.distributions.set(key, dist);
    }
  }

  detectRegimeChange(domain: string, actionType: string): boolean {
    const dist = this.getDistribution(domain, actionType);
    if (dist.sample_count < 15) return false;
    const delta = Math.abs(dist.base_rate - dist.last_10_success_rate);
    return delta > 0.2;
  }

  getCalibrationReport(domain: string): CalibrationRecord {
    const domainOutcomes = this.allOutcomes.filter((o) => o.domain === domain);
    const n = domainOutcomes.length;
    if (n === 0) {
      return { domain, period: "all_time", predictions_made: 0, correct_predictions: 0, accuracy: 0, avg_confidence: 0, avg_actual_rate: 0, overconfidence_score: 0, brier_score: 0.25 };
    }

    const correct = domainOutcomes.filter((o) => {
      if (!o.actual_outcome) return false;
      const predicted_success = o.predicted_probability >= 0.5;
      return predicted_success === (o.actual_outcome === "success");
    }).length;

    const avgConf = domainOutcomes.reduce((s, o) => s + o.predicted_probability, 0) / n;
    const avgActual = domainOutcomes.filter((o) => o.actual_outcome === "success").length / n;

    // Brier score
    const brier = domainOutcomes.reduce((s, o) => {
      const actual = o.actual_outcome === "success" ? 1 : 0;
      return s + Math.pow(o.predicted_probability - actual, 2);
    }, 0) / n;

    return {
      domain,
      period: "all_time",
      predictions_made: n,
      correct_predictions: correct,
      accuracy: correct / n,
      avg_confidence: avgConf,
      avg_actual_rate: avgActual,
      overconfidence_score: avgConf - avgActual,
      brier_score: brier,
    };
  }

  getAllDistributions(): ProbabilityDistribution[] {
    return Array.from(this.distributions.values());
  }

  getOutcomeCount(): number {
    return this.allOutcomes.length;
  }
}
