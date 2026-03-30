import type { SelfModel } from "./types";

export function printSelfModel(model: SelfModel): void {
  const tc = model.timing_curve;

  const topTools = Object.values(model.tool_performance)
    .sort((a, b) => b.invocation_count - a.invocation_count)
    .slice(0, 5);

  const compiledPatterns = Object.values(model.pattern_library)
    .filter((p) => p.compiled)
    .sort((a, b) => b.times_matched - a.times_matched)
    .slice(0, 5);

  const failures = Object.values(model.failure_index)
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 3);

  const runs = tc.runs;
  const earlyAvg = runs.length >= 10
    ? Math.round(runs.slice(0, Math.floor(runs.length / 2)).reduce((s, r) => s + r.solve_time_ms, 0) / Math.floor(runs.length / 2))
    : 0;
  const recentAvg = runs.length >= 10
    ? Math.round(runs.slice(Math.floor(runs.length / 2)).reduce((s, r) => s + r.solve_time_ms, 0) / (runs.length - Math.floor(runs.length / 2)))
    : 0;

  const velocityLabel = tc.learning_velocity > 0
    ? `+${Math.round(tc.learning_velocity * 100)}%`
    : `${Math.round(tc.learning_velocity * 100)}%`;

  const trendArrow = tc.trend === "accelerating" ? "↓" : tc.trend === "regressing" ? "↑" : "→";

  console.log("");
  console.log("╔═══════════════════════════════╗");
  console.log(`║     SELF-MODEL v${String(model.version).padStart(4)}          ║`);
  console.log("╠═══════════════════════════════╣");
  console.log(`║ Readiness: ${model.readiness_tier.toUpperCase().padEnd(18)}║`);
  console.log(`║ Runs: ${String(model.total_runs_observed).padEnd(8)} Patterns: ${String(Object.keys(model.pattern_library).length).padEnd(4)}║`);
  console.log(`║ Confidence: ${String(model.confidence_score).padEnd(3)}/100            ║`);
  console.log("╠═══════════════════════════════╣");
  console.log("║ TIMING CURVE                  ║");
  console.log(`║ Trend: ${tc.trend.toUpperCase().padEnd(16)} ${trendArrow}      ║`);
  console.log(`║ Velocity: ${velocityLabel.padEnd(12)} faster  ║`);
  if (earlyAvg > 0) {
    console.log(`║ Early avg: ${String(earlyAvg).padEnd(6)}ms          ║`);
    console.log(`║ Recent avg: ${String(recentAvg).padEnd(5)}ms          ║`);
  }
  console.log("╠═══════════════════════════════╣");
  console.log("║ TOP TOOLS                     ║");
  if (topTools.length === 0) {
    console.log("║ (no tool data yet)            ║");
  }
  for (const t of topTools) {
    const rate = `${Math.round(t.success_rate * 100)}%`;
    const lat = `${t.avg_latency_ms}ms`;
    console.log(`║ ${t.tool_name.padEnd(16)} ${rate.padStart(4)} · ${lat.padStart(6)} ║`);
  }
  console.log("╠═══════════════════════════════╣");
  console.log(`║ COMPILED PATTERNS (${String(tc.compiled_patterns).padEnd(3)})        ║`);
  if (compiledPatterns.length === 0) {
    console.log("║ (none compiled yet)           ║");
  }
  for (const p of compiledPatterns) {
    const sig = p.problem_signature.slice(0, 16).padEnd(16);
    const conf = p.confidence.toFixed(2);
    const times = `${p.times_matched}x`;
    console.log(`║ ${sig} ${conf} · ${times.padStart(4)} ║`);
  }
  if (failures.length > 0) {
    console.log("╠═══════════════════════════════╣");
    console.log("║ FAILURE INDEX                 ║");
    for (const f of failures) {
      const rate = `${Math.round(f.resolution_rate * 100)}% R`;
      console.log(`║ ${f.failure_type.padEnd(18)} ${String(f.frequency).padStart(3)}x · ${rate.padStart(5)} ║`);
    }
  }
  console.log("╚═══════════════════════════════╝");
  console.log("");
}
