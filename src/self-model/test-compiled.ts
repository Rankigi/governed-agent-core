/**
 * Post-Compilation Speed Test — 200 runs using ONLY compiled patterns.
 *
 * All 10 problems repeat. No novel problems.
 * Measures whether compiled pattern recognition reduces outer loop overhead.
 * Real Ollama inference on every run.
 *
 * Prints average every 25 runs to show the curve.
 */

import { SelfModelStore } from "./store";
import { OuterLoop } from "./outer-loop";

const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "llama3.2:1b";

// Same 10 problems from the original test — all already compiled
const PROBLEMS = [
  { msg: "What is the current stock price of AAPL and how has it changed this week?", tools: ["web-search", "calculator"] },
  { msg: "Calculate compound interest on $50,000 at 4.5% over 20 years with monthly compounding", tools: ["calculator"] },
  { msg: "Search SEC EDGAR for Tesla's latest 10-K annual report and summarize key financials", tools: ["web-search", "summarize"] },
  { msg: "Find the top 5 papers on transformer architecture improvements published in 2025", tools: ["web-search", "summarize"] },
  { msg: "Compare the population growth rates of India and China over the last decade", tools: ["web-search", "calculator"] },
  { msg: "Debug this TypeScript error: Property 'foo' does not exist on type 'Bar'", tools: ["web-search"] },
  { msg: "Write a SQL query to find all users who signed up in the last 30 days and made a purchase", tools: ["calculator"] },
  { msg: "Draft a professional email to the board summarizing this quarter's governance audit results", tools: ["summarize", "remember"] },
  { msg: "Send a Slack notification about the policy violation detected on agent SENTINEL-7", tools: ["web-search"] },
  { msg: "Check if agent ARBITER-3 complies with the EU AI Act transparency requirements", tools: ["web-search", "summarize"] },
];

async function ollamaInfer(prompt: string): Promise<number> {
  const start = Date.now();
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, stream: false }),
  });
  await res.json();
  return Date.now() - start;
}

async function run(): Promise<void> {
  console.log("");
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║  POST-COMPILATION SPEED TEST                      ║");
  console.log("║  200 runs · 10 compiled patterns · real inference ║");
  console.log(`║  Model: ${MODEL.padEnd(41)}║`);
  console.log("╚═══════════════════════════════════════════════════╝");
  console.log("");

  // Bootstrap store with the 10 compiled patterns from prior test
  const store = new SelfModelStore("test-compiled-agent");
  store.load(null);
  const loop = new OuterLoop(store);
  loop.start();

  // Seed patterns by running each problem 5x quickly (just upsert, no LLM)
  // This simulates having the 50-run history already compiled
  console.log("[SETUP] Seeding 10 compiled patterns from prior test...");
  for (let seed = 0; seed < 5; seed++) {
    for (const p of PROBLEMS) {
      store.upsertPattern(
        `general:${p.msg.slice(0, 100)}`,
        p.tools,
        20000, // avg from prior test
        true,
        seed * 10,
      );
    }
  }
  console.log(`[SETUP] Patterns: ${Object.keys(store.getModel().pattern_library).length}`);
  console.log(`[SETUP] Compiled: ${store.getModel().timing_curve.compiled_patterns}`);
  console.log("");

  const TOTAL = 200;
  const BUCKET = 25;
  const bucketTimes: number[][] = [];
  let currentBucket: number[] = [];

  for (let i = 0; i < TOTAL; i++) {
    const problem = PROBLEMS[i % PROBLEMS.length];
    const runNum = i + 1;

    // Notify outer loop — start
    await loop.onChainEvent({
      action: "agent_input",
      payload: { message: problem.msg, run_id: `compiled-${i}` },
      occurred_at: new Date().toISOString(),
      chain_index: 1000 + i * 3,
    });

    // Real inference — tool calls
    let totalMs = 0;
    for (const tool of problem.tools) {
      await loop.onChainEvent({
        action: "tool_call_start",
        payload: { tool_id: tool, tool_name: tool, run_id: `compiled-${i}` },
        occurred_at: new Date().toISOString(),
        chain_index: 1000 + i * 3 + 1,
      });

      const toolMs = await ollamaInfer(`Tool: ${tool}\nTask: ${problem.msg}\nBrief result.`);
      totalMs += toolMs;

      await loop.onChainEvent({
        action: "tool_call_complete",
        payload: { tool_id: tool, tool_name: tool, latency_ms: toolMs, execution_result: "success", run_id: `compiled-${i}` },
        occurred_at: new Date().toISOString(),
        chain_index: 1000 + i * 3 + 1,
      });
    }

    // Final inference
    const finalMs = await ollamaInfer(`${problem.msg}\nTools: ${problem.tools.join(", ")}\nBrief answer.`);
    totalMs += finalMs;

    // Notify outer loop — complete
    await loop.onChainEvent({
      action: "inference_complete",
      payload: { run_id: `compiled-${i}`, total_solve_time_ms: totalMs, tools_invoked_count: problem.tools.length, execution_result: "success", skipped_reasoning: true },
      occurred_at: new Date().toISOString(),
      chain_index: 1000 + i * 3 + 2,
    });

    currentBucket.push(totalMs);

    // Print progress dot
    if (runNum % 10 === 0) {
      process.stdout.write(` ${runNum}`);
    } else {
      process.stdout.write(".");
    }

    // Print bucket summary every 25 runs
    if (runNum % BUCKET === 0) {
      const avg = Math.round(currentBucket.reduce((a, b) => a + b, 0) / currentBucket.length);
      const min = Math.min(...currentBucket);
      const max = Math.max(...currentBucket);
      const bucketNum = bucketTimes.length + 1;
      const rangeStart = (bucketNum - 1) * BUCKET + 1;
      const rangeEnd = bucketNum * BUCKET;

      console.log("");
      console.log(`  Runs ${String(rangeStart).padStart(3)}-${String(rangeEnd).padStart(3)}:  avg ${String(avg).padStart(6)}ms  |  min ${String(min).padStart(6)}ms  |  max ${String(max).padStart(6)}ms`);

      bucketTimes.push([...currentBucket]);
      currentBucket = [];
    }
  }

  // Final summary
  const model = store.getModel();
  const allRuns = model.timing_curve.runs;
  const allTimes = allRuns.map((r) => r.solve_time_ms);

  console.log("");
  console.log("═══════════════════════════════════════════════════");
  console.log("  TIMING CURVE — POST-COMPILATION");
  console.log("═══════════════════════════════════════════════════");

  for (let b = 0; b < bucketTimes.length; b++) {
    const bucket = bucketTimes[b];
    const avg = Math.round(bucket.reduce((a, c) => a + c, 0) / bucket.length);
    const bar = "█".repeat(Math.max(1, Math.round(avg / 1000)));
    const rangeStart = b * BUCKET + 1;
    const rangeEnd = (b + 1) * BUCKET;
    console.log(`  ${String(rangeStart).padStart(3)}-${String(rangeEnd).padStart(3)}: ${String(avg).padStart(6)}ms  ${bar}`);
  }

  const globalAvg = Math.round(allTimes.reduce((a, b) => a + b, 0) / allTimes.length);
  const globalMin = Math.min(...allTimes);
  const globalMax = Math.max(...allTimes);

  console.log("");
  console.log(`  Global avg:  ${globalAvg}ms`);
  console.log(`  Global min:  ${globalMin}ms`);
  console.log(`  Global max:  ${globalMax}ms`);
  console.log(`  Total runs:  ${model.total_runs_observed}`);
  console.log(`  Compiled:    ${model.timing_curve.compiled_patterns} patterns`);
  console.log(`  Trend:       ${model.timing_curve.trend}`);
  console.log(`  Velocity:    ${model.timing_curve.learning_velocity > 0 ? "+" : ""}${Math.round(model.timing_curve.learning_velocity * 100)}%`);
  console.log(`  Confidence:  ${model.confidence_score}/100`);
  console.log("");
}

run().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
