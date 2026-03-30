/**
 * Calibrated Mind Test Suite
 * Tests probability distributions, EV calculations, decision stack, calibration, and regime detection.
 */

import { ProbabilityStore } from "./store";
import { EVCalculator } from "./ev-calculator";
import { CalibrationEngine } from "./calibration";
import { BASE_RATES } from "./corpus/base-rates";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

function test1_coldStart() {
  console.log("\n── Test 1: Cold start distribution ──");
  const store = new ProbabilityStore();
  store.load(null);

  const dist = store.getDistribution("finance", "calculator");
  assert(dist.base_rate === 0.5, `base_rate = ${dist.base_rate} (expected 0.5)`);
  assert(dist.sample_count === 0, `sample_count = ${dist.sample_count} (expected 0)`);
  assert(dist.confidence_in_distribution < 0.4, `confidence = ${dist.confidence_in_distribution.toFixed(3)} (expected < 0.4)`);
}

function test2_evCalculation() {
  console.log("\n── Test 2: EV calculation ──");
  const store = new ProbabilityStore();
  store.load(null);

  // Seed some data so confidence is above floor
  for (let i = 0; i < 20; i++) {
    store.recordOutcome({
      action_id: `a${i}`, action_description: "web_search", predicted_probability: 0.8,
      predicted_value: 100, predicted_cost_if_wrong: 20, expected_value: 0,
      actual_outcome: Math.random() > 0.2 ? "success" : "failure", actual_value: 100,
      timestamp: new Date().toISOString(), chain_index: i, domain: "research",
    });
  }

  const calc = new EVCalculator(store);
  const ev = calc.calculate("web_search", "research", 100, 20);

  assert(typeof ev.expected_value === "number", `EV calculated: ${ev.expected_value.toFixed(2)}`);
  assert(typeof ev.predicted_probability === "number", `Probability: ${(ev.predicted_probability * 100).toFixed(1)}%`);
  assert(typeof ev.should_act === "boolean", `Decision: ${ev.should_act ? "ACT" : "REJECT"}`);
  assert(ev.ev_confidence > 0, `EV confidence: ${(ev.ev_confidence * 100).toFixed(0)}%`);
}

function test3_decisionStack() {
  console.log("\n── Test 3: Decision stack (5 layers) ──");

  // Case A: Confidence below floor (no data)
  const storeA = new ProbabilityStore();
  storeA.load(null);
  const calcA = new EVCalculator(storeA);
  const evA = calcA.calculate("unknown_action", "finance", 100, 20);
  assert(!evA.should_act, `Case A (no data): REJECT — ${evA.rejection_reason}`);
  assert(!evA.confidence_floor_passed, "Case A: confidence_floor_passed = false");

  // Case B: Cost exceeds risk limit
  const storeB = new ProbabilityStore();
  storeB.load(null);
  storeB.seedFromCorpus([{ domain: "finance", action_type: "expensive_trade", historical_success_rate: 0.9, sample_count: 100 }]);
  const calcB = new EVCalculator(storeB);
  const evB = calcB.calculate("expensive_trade", "finance", 500, 50000); // cost way over limit
  assert(!evB.should_act, `Case B (high risk): REJECT — ${evB.rejection_reason}`);
  assert(!evB.risk_threshold_passed, "Case B: risk_threshold_passed = false");

  // Case C: Negative EV
  const storeC = new ProbabilityStore();
  storeC.load(null);
  storeC.seedFromCorpus([{ domain: "finance", action_type: "bad_bet", historical_success_rate: 0.2, sample_count: 100 }]);
  const calcC = new EVCalculator(storeC);
  const evC = calcC.calculate("bad_bet", "finance", 10, 100); // low prob, high cost
  assert(!evC.should_act, `Case C (neg EV): REJECT — ${evC.rejection_reason}`);
  assert(!evC.ev_positive, "Case C: ev_positive = false");

  // Case D: All pass
  const storeD = new ProbabilityStore();
  storeD.load(null);
  storeD.seedFromCorpus([{ domain: "finance", action_type: "calculator", historical_success_rate: 0.94, sample_count: 200 }]);
  const calcD = new EVCalculator(storeD);
  const evD = calcD.calculate("calculator", "finance", 100, 10);
  assert(evD.should_act, `Case D (all pass): ACT ✓ — EV: ${evD.expected_value.toFixed(2)}`);
  assert(evD.confidence_floor_passed, "Case D: confidence_floor_passed = true");
  assert(evD.risk_threshold_passed, "Case D: risk_threshold_passed = true");
  assert(evD.ev_positive, "Case D: ev_positive = true");
}

function test4_calibrationUpdate() {
  console.log("\n── Test 4: Calibration update ──");
  const store = new ProbabilityStore();
  store.load(null);
  const engine = new CalibrationEngine(store);

  for (let i = 0; i < 20; i++) {
    const success = i < 10; // 10 success, 10 failure
    engine.onOutcome(`a${i}`, "research", "web_search", 0.7, success ? "success" : "failure", 100, i);
  }

  const dist = store.getDistribution("research", "web_search");
  assert(Math.abs(dist.base_rate - 0.5) < 0.05, `base_rate ≈ 0.5 (actual: ${dist.base_rate.toFixed(3)})`);
  assert(dist.sample_count === 20, `sample_count = ${dist.sample_count}`);
  assert(dist.calibration_error >= 0, `calibration_error = ${dist.calibration_error.toFixed(3)}`);

  const report = store.getCalibrationReport("research");
  assert(report.predictions_made === 20, `predictions_made = ${report.predictions_made}`);
  assert(report.brier_score > 0 && report.brier_score < 1, `brier_score = ${report.brier_score.toFixed(3)}`);
}

function test5_regimeChange() {
  console.log("\n── Test 5: Regime change detection ──");
  const store = new ProbabilityStore();
  store.load(null);

  // Seed with high success rate
  store.seedFromCorpus([{ domain: "finance", action_type: "calculator", historical_success_rate: 0.8, sample_count: 50 }]);

  // Now record 10 failures in a row
  for (let i = 0; i < 10; i++) {
    store.recordOutcome({
      action_id: `fail${i}`, action_description: "calculator", predicted_probability: 0.8,
      predicted_value: 100, predicted_cost_if_wrong: 20, expected_value: 0,
      actual_outcome: "failure", actual_value: 0,
      timestamp: new Date().toISOString(), chain_index: 100 + i, domain: "finance",
    });
  }

  const dist = store.getDistribution("finance", "calculator");
  assert(dist.last_10_success_rate === 0, `last_10_success_rate = ${dist.last_10_success_rate} (expected 0)`);

  const changed = store.detectRegimeChange("finance", "calculator");
  assert(changed, `regime_change_detected = ${changed}`);
}

function test6_corpusSeeding() {
  console.log("\n── Test 6: Corpus seeding ──");
  const store = new ProbabilityStore();
  store.load(null);
  store.seedFromCorpus(BASE_RATES);

  const finCalc = store.getDistribution("finance", "calculator");
  assert(finCalc.base_rate > 0.8, `finance/calculator base_rate = ${finCalc.base_rate.toFixed(3)} (expected > 0.8)`);
  assert(finCalc.sample_count > 0, `sample_count = ${finCalc.sample_count}`);
  assert(finCalc.confidence_in_distribution > 0.5, `confidence = ${finCalc.confidence_in_distribution.toFixed(3)} (expected > 0.5 after seeding)`);

  const all = store.getAllDistributions();
  assert(all.length === BASE_RATES.length, `${all.length} distributions loaded (expected ${BASE_RATES.length})`);
}

function test7_calibrateReport() {
  console.log("\n── Test 7: Calibration report ──");
  const store = new ProbabilityStore();
  store.load(null);
  const engine = new CalibrationEngine(store);

  // Record mixed outcomes
  for (let i = 0; i < 30; i++) {
    const success = Math.random() > 0.3;
    engine.onOutcome(`r${i}`, "governance", "policy_check", 0.85, success ? "success" : "failure", 100, i);
  }

  const report = store.getCalibrationReport("governance");
  assert(report.predictions_made === 30, `predictions: ${report.predictions_made}`);
  assert(report.brier_score >= 0 && report.brier_score <= 1, `brier: ${report.brier_score.toFixed(3)}`);
  assert(typeof report.overconfidence_score === "number", `overconfidence: ${report.overconfidence_score.toFixed(3)}`);
  assert(typeof report.accuracy === "number", `accuracy: ${(report.accuracy * 100).toFixed(1)}%`);

  console.log(`\n  [CALIBRATION REPORT]`);
  console.log(`  Domain: ${report.domain}`);
  console.log(`  Predictions: ${report.predictions_made}`);
  console.log(`  Accuracy: ${(report.accuracy * 100).toFixed(1)}%`);
  console.log(`  Avg confidence: ${(report.avg_confidence * 100).toFixed(1)}%`);
  console.log(`  Brier score: ${report.brier_score.toFixed(3)}`);
  console.log(`  Overconfidence: ${report.overconfidence_score > 0 ? "+" : ""}${(report.overconfidence_score * 100).toFixed(1)}%`);
}

// Run all tests
console.log("\n╔═══════════════════════════════════════╗");
console.log("║   CALIBRATED MIND — Test Suite        ║");
console.log("╚═══════════════════════════════════════╝");

test1_coldStart();
test2_evCalculation();
test3_decisionStack();
test4_calibrationUpdate();
test5_regimeChange();
test6_corpusSeeding();
test7_calibrateReport();

console.log(`\n═══════════════════════════════════════`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════\n`);

if (failed > 0) process.exit(1);
