/**
 * LLM Call Count Test — The Real Speedup Metric
 *
 * Phase 1: 50 problems WITHOUT self-model. Agent reasons from scratch.
 *          Count LLM calls per problem.
 *
 * Phase 2: Same 50 problems WITH compiled self-model patterns.
 *          Compiled patterns tell the agent to skip reasoning and
 *          execute the tool chain directly → fewer LLM calls.
 *
 * The difference = calls eliminated by pattern compilation.
 */

import crypto from "crypto";

const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "llama3.2:1b";

// 10 problems, each repeated 5x = 50 runs per phase
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

const ALL_TOOLS = [
  { name: "web-search", description: "Search the web for information" },
  { name: "calculator", description: "Evaluate mathematical expressions" },
  { name: "summarize", description: "Summarize text content" },
  { name: "remember", description: "Store information for later recall" },
];

let totalLlmCalls = 0;

async function llmCall(messages: { role: string; content: string }[]): Promise<{
  content: string;
  tool_calls: { name: string }[];
}> {
  totalLlmCalls++;
  const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, stream: false }),
  });
  const data = await res.json();
  const content = (data.response as string) ?? "";

  // Parse tool calls from LLM response
  // The LLM may mention tools — extract them
  const toolCalls: { name: string }[] = [];
  for (const tool of ALL_TOOLS) {
    if (content.toLowerCase().includes(tool.name)) {
      toolCalls.push({ name: tool.name });
    }
  }

  return { content, tool_calls: toolCalls };
}

async function fakeToolExecution(toolName: string, _problem: string): Promise<string> {
  // Minimal real inference to simulate tool work
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt: `Tool ${toolName} result: brief output for the task. One sentence.`,
      stream: false,
    }),
  });
  const data = await res.json();
  return (data.response as string) ?? "Done.";
}

/**
 * Simulate agent inner loop WITHOUT self-model.
 * Agent reasons from scratch — multiple LLM calls.
 *
 * Loop: LLM → decide tools → execute → LLM → synthesize → done
 * Typical: 2-3 LLM calls per problem (reason + execute + synthesize)
 */
async function runWithoutSelfModel(problem: typeof PROBLEMS[0]): Promise<{
  llm_calls: number;
  tools_used: string[];
}> {
  const startCalls = totalLlmCalls;
  const messages: { role: string; content: string }[] = [
    {
      role: "system",
      content: `You are a governed AI agent. Available tools: ${ALL_TOOLS.map((t) => t.name).join(", ")}. Use tools when needed. Be brief.`,
    },
    { role: "user", content: problem.msg },
  ];

  const toolsUsed: string[] = [];
  const MAX_ITER = 4;

  for (let i = 0; i < MAX_ITER; i++) {
    // LLM call #1+ — reasoning / tool selection
    const response = await llmCall(messages);
    messages.push({ role: "assistant", content: response.content });

    if (response.tool_calls.length === 0 || i === MAX_ITER - 1) {
      // No more tools or max iterations — done
      break;
    }

    // Execute tools
    for (const tc of response.tool_calls) {
      if (!toolsUsed.includes(tc.name)) toolsUsed.push(tc.name);
      const result = await fakeToolExecution(tc.name, problem.msg);
      messages.push({ role: "tool", content: `[${tc.name}]: ${result}` });
    }

    // LLM will be called again in next iteration to synthesize
  }

  return {
    llm_calls: totalLlmCalls - startCalls,
    tools_used: toolsUsed,
  };
}

/**
 * Simulate agent inner loop WITH compiled self-model.
 * Agent has a compiled pattern — knows the tool chain.
 * Skips the reasoning step, executes tools directly,
 * then ONE final LLM call to synthesize.
 *
 * Typical: 1 LLM call per problem (synthesize only)
 */
async function runWithSelfModel(
  problem: typeof PROBLEMS[0],
  compiledToolChain: string[],
): Promise<{
  llm_calls: number;
  tools_used: string[];
}> {
  const startCalls = totalLlmCalls;

  // Skip reasoning — execute compiled tool chain directly
  const toolResults: string[] = [];
  for (const tool of compiledToolChain) {
    const result = await fakeToolExecution(tool, problem.msg);
    toolResults.push(`[${tool}]: ${result}`);
  }

  // ONE final LLM call to synthesize results
  const messages: { role: string; content: string }[] = [
    {
      role: "system",
      content: `You are a governed AI agent. COMPILED PATTERN matched. Tool results are provided. Synthesize a brief answer.`,
    },
    { role: "user", content: problem.msg },
    { role: "tool", content: toolResults.join("\n") },
  ];

  await llmCall(messages);

  return {
    llm_calls: totalLlmCalls - startCalls,
    tools_used: compiledToolChain,
  };
}

async function run(): Promise<void> {
  console.log("");
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║  LLM CALL COUNT TEST — The Real Speedup Metric       ║");
  console.log("║  Model: llama3.2:1b via Ollama                       ║");
  console.log("║  50 problems × 2 phases (without / with self-model)  ║");
  console.log("╚═══════════════════════════════════════════════════════╝");

  // ═══════════════════════════════════════════════════
  // PHASE 1: WITHOUT SELF-MODEL
  // ═══════════════════════════════════════════════════
  console.log("\n\n══════════════════════════════════════════");
  console.log("  PHASE 1: WITHOUT SELF-MODEL");
  console.log("  Agent reasons from scratch every time.");
  console.log("══════════════════════════════════════════\n");

  const phase1Results: { problem: string; llm_calls: number; tools: string[] }[] = [];
  totalLlmCalls = 0;

  for (let i = 0; i < 50; i++) {
    const problem = PROBLEMS[i % PROBLEMS.length];
    const result = await runWithoutSelfModel(problem);
    phase1Results.push({
      problem: problem.msg.slice(0, 50),
      llm_calls: result.llm_calls,
      tools: result.tools_used,
    });

    process.stdout.write(result.llm_calls > 2 ? "█" : result.llm_calls > 1 ? "▓" : "░");
    if ((i + 1) % 10 === 0) {
      const batch = phase1Results.slice(i - 9, i + 1);
      const avg = (batch.reduce((s, r) => s + r.llm_calls, 0) / batch.length).toFixed(1);
      console.log(` ${i + 1}/50  avg ${avg} calls/run`);
    }
  }

  const phase1Total = phase1Results.reduce((s, r) => s + r.llm_calls, 0);
  const phase1Avg = (phase1Total / phase1Results.length).toFixed(2);

  console.log(`\n  Phase 1 total LLM calls: ${phase1Total}`);
  console.log(`  Phase 1 avg per run:     ${phase1Avg}`);

  // ═══════════════════════════════════════════════════
  // PHASE 2: WITH COMPILED SELF-MODEL
  // ═══════════════════════════════════════════════════
  console.log("\n\n══════════════════════════════════════════");
  console.log("  PHASE 2: WITH COMPILED SELF-MODEL");
  console.log("  Agent skips reasoning, executes compiled");
  console.log("  tool chain, ONE synthesize call.");
  console.log("══════════════════════════════════════════\n");

  const phase2Results: { problem: string; llm_calls: number; tools: string[] }[] = [];
  totalLlmCalls = 0;

  for (let i = 0; i < 50; i++) {
    const problem = PROBLEMS[i % PROBLEMS.length];
    const result = await runWithSelfModel(problem, problem.tools);
    phase2Results.push({
      problem: problem.msg.slice(0, 50),
      llm_calls: result.llm_calls,
      tools: result.tools_used,
    });

    process.stdout.write("░");
    if ((i + 1) % 10 === 0) {
      const batch = phase2Results.slice(i - 9, i + 1);
      const avg = (batch.reduce((s, r) => s + r.llm_calls, 0) / batch.length).toFixed(1);
      console.log(` ${i + 1}/50  avg ${avg} calls/run`);
    }
  }

  const phase2Total = phase2Results.reduce((s, r) => s + r.llm_calls, 0);
  const phase2Avg = (phase2Total / phase2Results.length).toFixed(2);

  console.log(`\n  Phase 2 total LLM calls: ${phase2Total}`);
  console.log(`  Phase 2 avg per run:     ${phase2Avg}`);

  // ═══════════════════════════════════════════════════
  // COMPARISON
  // ═══════════════════════════════════════════════════
  console.log("\n\n╔═══════════════════════════════════════════════════════╗");
  console.log("║                    RESULTS                             ║");
  console.log("╠═══════════════════════════════════════════════════════╣");
  console.log(`║  WITHOUT self-model:  ${String(phase1Total).padStart(4)} total calls  (${phase1Avg} avg/run)  ║`);
  console.log(`║  WITH self-model:     ${String(phase2Total).padStart(4)} total calls  (${phase2Avg} avg/run)  ║`);
  console.log("╠═══════════════════════════════════════════════════════╣");

  const callsSaved = phase1Total - phase2Total;
  const pctReduction = phase1Total > 0 ? Math.round((callsSaved / phase1Total) * 100) : 0;
  const avgSaved = (parseFloat(phase1Avg) - parseFloat(phase2Avg)).toFixed(2);

  console.log(`║  Calls ELIMINATED:    ${String(callsSaved).padStart(4)} total        (${avgSaved} avg/run)   ║`);
  console.log(`║  Reduction:           ${String(pctReduction).padStart(3)}%                                ║`);
  console.log("╠═══════════════════════════════════════════════════════╣");
  console.log("║                                                       ║");
  console.log(`║  Each eliminated call = one Ollama inference saved.   ║`);
  console.log(`║  At ~15s/call, ${callsSaved} eliminated calls =               ║`);
  console.log(`║  ~${Math.round(callsSaved * 15)}s saved across 50 runs.                      ║`);
  console.log("║                                                       ║");
  console.log("╚═══════════════════════════════════════════════════════╝");

  // Per-problem breakdown
  console.log("\n\nPER-PROBLEM BREAKDOWN:");
  console.log("─────────────────────────────────────────────────────────");
  console.log("  Problem                                        Without  With  Saved");
  console.log("─────────────────────────────────────────────────────────");

  for (let p = 0; p < PROBLEMS.length; p++) {
    const withoutRuns = phase1Results.filter((_, i) => i % PROBLEMS.length === p);
    const withRuns = phase2Results.filter((_, i) => i % PROBLEMS.length === p);
    const withoutAvg = (withoutRuns.reduce((s, r) => s + r.llm_calls, 0) / withoutRuns.length).toFixed(1);
    const withAvg = (withRuns.reduce((s, r) => s + r.llm_calls, 0) / withRuns.length).toFixed(1);
    const saved = (parseFloat(withoutAvg) - parseFloat(withAvg)).toFixed(1);
    const label = PROBLEMS[p].msg.slice(0, 48).padEnd(48);
    console.log(`  ${label} ${withoutAvg.padStart(5)}  ${withAvg.padStart(4)}  ${saved.padStart(5)}`);
  }
  console.log("─────────────────────────────────────────────────────────");
}

run().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
