export interface ActionOutcome {
  action_id: string;
  action_description: string;
  predicted_probability: number;
  predicted_value: number;
  predicted_cost_if_wrong: number;
  expected_value: number;
  actual_outcome?: "success" | "failure" | "unknown";
  actual_value?: number;
  calibration_error?: number;
  timestamp: string;
  chain_index: number;
  domain: string;
}

export interface ProbabilityDistribution {
  domain: string;
  action_type: string;
  base_rate: number;
  sample_count: number;
  confidence_in_distribution: number;
  predicted_avg: number;
  actual_avg: number;
  calibration_error: number;
  last_10_success_rate: number;
  last_updated: string;
  first_observed: string;
  outcomes: { predicted: number; actual: 0 | 1 }[];
}

export interface EVCalculation {
  action: string;
  domain: string;
  predicted_probability: number;
  value_if_success: number;
  cost_if_failure: number;
  expected_value: number;
  confidence_floor_passed: boolean;
  risk_threshold_passed: boolean;
  ev_positive: boolean;
  novel_territory: boolean;
  subconscious_veto: boolean;
  should_act: boolean;
  rejection_reason?: string;
  ev_confidence: number;
}

export interface CalibrationRecord {
  domain: string;
  period: string;
  predictions_made: number;
  correct_predictions: number;
  accuracy: number;
  avg_confidence: number;
  avg_actual_rate: number;
  overconfidence_score: number;
  brier_score: number;
}
