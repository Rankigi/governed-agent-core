/**
 * Self-Model Test Simulation
 *
 * Simulates 20 inner loop runs to verify the timing curve builds correctly.
 * Runs 1-5:  Novel problems → outer loop learns → slow
 * Runs 6-10: Repeat patterns → start matching → faster
 * Runs 11-15: Mix of known + novel → compiled patterns → stabilize
 * Runs 16-20: Mostly compiled → direct execution → near minimum
 */

import { SelfModelStore } from "./store";
import { OuterLoop } from "./outer-loop";
import { printSelfModel } from "./dashboard";

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const PROBLEMS = [
  { msg: "What is the current price of AAPL stock?", type: "finance" },
  { msg: "Search SEC EDGAR for Tesla 10-K filings", type: "finance" },
  { msg: "Calculate the compound interest on $10,000 at 5% for 10 years", type: "finance" },
  { msg: "Send a summary email of today's governance report", type: "communication" },
  { msg: "Debug the authentication error in the login module", type: "engineering" },
];

const TOOLS = ["web-search", "calculator", "remember", "summarize"];

async function simulate(): Promise<void> {
  console.log("\n[TEST] Self-Model Simulation — 20 runs\n");

  const store = new SelfModelStore("test-agent-001");
  store.load(null);
  const loop = new OuterLoop(store);
  loop.start();

  for (let i = 0; i < 20; i++) {
    const problem = PROBLEMS[i % PROBLEMS.length];
    const isNovel = i < 5 || (i >= 10 && i % 3 === 0);
    const baseLatency = isNovel ? 8000 + Math.random() * 12000 : 1000 + Math.random() * 3000;

    console.log(`\n--- Run ${i + 1}/20: "${problem.msg.slice(0, 40)}..." ---`);

    // Simulate inference start
    await loop.onChainEvent({
      action: "agent_input",
      payload: { message: problem.msg, run_id: `run-${i}` },
      occurred_at: new Date().toISOString(),
      chain_index: i * 3,
    });

    // Simulate 1-3 tool calls
    const toolCount = Math.min(1 + Math.floor(Math.random() * 3), TOOLS.length);
    for (let t = 0; t < toolCount; t++) {
      const tool = TOOLS[t % TOOLS.length];
      const toolLatency = 50 + Math.random() * 300;

      await loop.onChainEvent({
        action: "tool_call_start",
        payload: { tool_id: tool, tool_name: tool, run_id: `run-${i}` },
        occurred_at: new Date().toISOString(),
        chain_index: i * 3 + t + 1,
      });

      await sleep(10); // simulate work

      await loop.onChainEvent({
        action: "tool_call_complete",
        payload: {
          tool_id: tool,
          tool_name: tool,
          latency_ms: toolLatency,
          execution_result: Math.random() > 0.1 ? "success" : "error",
          run_id: `run-${i}`,
        },
        occurred_at: new Date().toISOString(),
        chain_index: i * 3 + t + 1,
      });
    }

    // Simulate inference complete
    await sleep(10);
    await loop.onChainEvent({
      action: "inference_complete",
      payload: {
        run_id: `run-${i}`,
        total_solve_time_ms: baseLatency,
        tools_invoked_count: toolCount,
        execution_result: "success",
        skipped_reasoning: !isNovel,
      },
      occurred_at: new Date().toISOString(),
      chain_index: i * 3 + 2,
    });
  }

  // Print final self-model
  console.log("\n\n========== FINAL SELF-MODEL ==========");
  printSelfModel(store.getModel());

  // Assertions
  const model = store.getModel();
  const runs = model.timing_curve.runs;
  const firstRun = runs[0];
  const lastRun = runs[runs.length - 1];

  console.log("\n[TEST] Assertions:");
  console.log(`  Run 20 solve_time (${lastRun.solve_time_ms}ms) < Run 1 solve_time (${firstRun.solve_time_ms}ms): ${lastRun.solve_time_ms < firstRun.solve_time_ms ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`  Compiled patterns > 0: ${model.timing_curve.compiled_patterns > 0 ? "✓ PASS" : "✗ FAIL (may need more runs)"}`);
  console.log(`  Learning velocity > 0: ${model.timing_curve.learning_velocity > 0 ? `✓ PASS (${Math.round(model.timing_curve.learning_velocity * 100)}%)` : "✗ FAIL"}`);
  console.log(`  Trend !== 'insufficient_data': ${model.timing_curve.trend !== "insufficient_data" ? `✓ PASS (${model.timing_curve.trend})` : "✗ FAIL"}`);
  console.log(`  Total runs: ${model.total_runs_observed}`);
  console.log(`  Patterns discovered: ${Object.keys(model.pattern_library).length}`);
  console.log(`  Readiness: ${model.readiness_tier}`);
  console.log("");
}

simulate().catch(console.error);
