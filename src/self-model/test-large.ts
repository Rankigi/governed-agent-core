/**
 * Self-Model Large Test — Real Ollama Inference
 *
 * 50 runs across 5 domains with real LLM latency.
 * Problems repeat so patterns compile.
 * Prints timing curve every 10 runs.
 */

import { SelfModelStore } from "./store";
import { OuterLoop } from "./outer-loop";
import { printSelfModel } from "./dashboard";

const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "llama3.2:1b";

const PROBLEMS = [
  // Finance (repeats will compile)
  { msg: "What is the current stock price of AAPL and how has it changed this week?", domain: "finance", tools: ["web-search", "calculator"] },
  { msg: "Calculate compound interest on $50,000 at 4.5% over 20 years with monthly compounding", domain: "finance", tools: ["calculator"] },
  { msg: "Search SEC EDGAR for Tesla's latest 10-K annual report and summarize key financials", domain: "finance", tools: ["web-search", "summarize"] },

  // Research
  { msg: "Find the top 5 papers on transformer architecture improvements published in 2025", domain: "research", tools: ["web-search", "summarize"] },
  { msg: "Compare the population growth rates of India and China over the last decade", domain: "research", tools: ["web-search", "calculator"] },

  // Engineering
  { msg: "Debug this TypeScript error: Property 'foo' does not exist on type 'Bar'", domain: "engineering", tools: ["web-search"] },
  { msg: "Write a SQL query to find all users who signed up in the last 30 days and made a purchase", domain: "engineering", tools: ["calculator"] },

  // Communication
  { msg: "Draft a professional email to the board summarizing this quarter's governance audit results", domain: "communication", tools: ["summarize", "remember"] },
  { msg: "Send a Slack notification about the policy violation detected on agent SENTINEL-7", domain: "communication", tools: ["web-search"] },

  // Governance
  { msg: "Check if agent ARBITER-3 complies with the EU AI Act transparency requirements", domain: "governance", tools: ["web-search", "summarize"] },
];

async function ollamaInfer(prompt: string): Promise<{ latency_ms: number; response: string }> {
  const start = Date.now();
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
    }),
  });
  const data = (await res.json()) as { response: string };
  return {
    latency_ms: Date.now() - start,
    response: data.response ?? "",
  };
}

async function run(): Promise<void> {
  console.log("\n╔═══════════════════════════════════════════════╗");
  console.log("║  SELF-MODEL TEST — Real Ollama Inference      ║");
  console.log(`║  Model: ${MODEL.padEnd(37)}║`);
  console.log("║  Runs: 50 across 5 domains                    ║");
  console.log("╚═══════════════════════════════════════════════╝\n");

  const store = new SelfModelStore("test-ollama-agent");
  store.load(null);
  const loop = new OuterLoop(store);
  loop.start();

  const totalRuns = 50;

  for (let i = 0; i < totalRuns; i++) {
    const problem = PROBLEMS[i % PROBLEMS.length];
    const runNum = i + 1;

    console.log(`\n─── Run ${runNum}/${totalRuns}: "${problem.msg.slice(0, 50)}..." ───`);

    // Notify outer loop — inference start
    await loop.onChainEvent({
      action: "agent_input",
      payload: { message: problem.msg, run_id: `run-${i}` },
      occurred_at: new Date().toISOString(),
      chain_index: i * 4,
    });

    // Real Ollama inference — this is where the real latency comes from
    const toolList = problem.tools.join(", ");
    const prompt = `${problem.msg}\n\nAvailable tools: ${toolList}\nGive a brief response in 2-3 sentences.`;

    // Simulate tool calls with real inference
    let totalToolLatency = 0;
    for (let t = 0; t < problem.tools.length; t++) {
      const tool = problem.tools[t];

      await loop.onChainEvent({
        action: "tool_call_start",
        payload: { tool_id: tool, tool_name: tool, run_id: `run-${i}` },
        occurred_at: new Date().toISOString(),
        chain_index: i * 4 + t + 1,
      });

      // Real inference for each tool call
      const toolPrompt = `Tool: ${tool}\nTask: ${problem.msg}\nReturn a brief tool result.`;
      const toolResult = await ollamaInfer(toolPrompt);
      totalToolLatency += toolResult.latency_ms;

      await loop.onChainEvent({
        action: "tool_call_complete",
        payload: {
          tool_id: tool,
          tool_name: tool,
          latency_ms: toolResult.latency_ms,
          execution_result: "success",
          run_id: `run-${i}`,
        },
        occurred_at: new Date().toISOString(),
        chain_index: i * 4 + t + 1,
      });

      console.log(`  Tool ${tool}: ${toolResult.latency_ms}ms`);
    }

    // Final inference — synthesize response
    const finalResult = await ollamaInfer(prompt);
    const totalLatency = totalToolLatency + finalResult.latency_ms;

    console.log(`  Final inference: ${finalResult.latency_ms}ms`);
    console.log(`  Total: ${totalLatency}ms`);

    // Notify outer loop — inference complete with REAL latency
    await loop.onChainEvent({
      action: "inference_complete",
      payload: {
        run_id: `run-${i}`,
        total_solve_time_ms: totalLatency,
        tools_invoked_count: problem.tools.length,
        execution_result: "success",
        skipped_reasoning: false,
      },
      occurred_at: new Date().toISOString(),
      chain_index: i * 4 + 3,
    });

    // Print timing curve every 10 runs
    if (runNum % 10 === 0) {
      console.log(`\n\n========== SELF-MODEL @ Run ${runNum} ==========`);
      printSelfModel(store.getModel());
    }
  }

  // Final report
  console.log("\n\n╔═══════════════════════════════════════════════╗");
  console.log("║           FINAL SELF-MODEL                     ║");
  console.log("╚═══════════════════════════════════════════════╝");
  printSelfModel(store.getModel());

  // Timing curve analysis
  const model = store.getModel();
  const runs = model.timing_curve.runs;
  if (runs.length >= 10) {
    const first10 = runs.slice(0, 10);
    const last10 = runs.slice(-10);
    const firstAvg = Math.round(first10.reduce((s, r) => s + r.solve_time_ms, 0) / 10);
    const lastAvg = Math.round(last10.reduce((s, r) => s + r.solve_time_ms, 0) / 10);
    const improvement = firstAvg > 0 ? Math.round(((firstAvg - lastAvg) / firstAvg) * 100) : 0;

    console.log("\n[TIMING ANALYSIS]");
    console.log(`  First 10 avg: ${firstAvg}ms`);
    console.log(`  Last 10 avg:  ${lastAvg}ms`);
    console.log(`  Improvement:  ${improvement > 0 ? "+" : ""}${improvement}%`);
    console.log(`  Compiled patterns: ${model.timing_curve.compiled_patterns}`);
    console.log(`  Patterns discovered: ${Object.keys(model.pattern_library).length}`);
    console.log(`  Readiness: ${model.readiness_tier}`);
  }
}

run().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
