import dotenv from "dotenv";
dotenv.config();

import { Agent } from "./agent";
import { TelegramInterface } from "./telegram";
import { rankigi } from "./rankigi";
import { SelfModelStore } from "./self-model/store";
import { OuterLoop } from "./self-model/outer-loop";
import { printSelfModel } from "./self-model/dashboard";
import { KairosOuterLoop } from "./kairos/tick";
import { FrustrationDetector } from "./kairos/frustration";
import { createSeal, verifySeal } from "./beliefs/seal";

async function main() {
  console.log("");
  console.log("  RANKIGI Governed Agent");
  console.log("  Born governed. Every action recorded.");
  console.log("");
  console.log(`  Passport: ${process.env.RANKIGI_AGENT_ID ?? "NOT SET"}`);
  console.log("");

  // Validate required env vars
  if (!process.env.RANKIGI_API_KEY) {
    console.error("  ERROR: RANKIGI_API_KEY is required.");
    console.error("  Get yours at: rankigi.com/dashboard/agents/new");
    process.exit(1);
  }

  if (!process.env.RANKIGI_AGENT_ID) {
    console.error("  ERROR: RANKIGI_AGENT_ID is required.");
    console.error("  Get yours at: rankigi.com/dashboard/agents/new");
    process.exit(1);
  }

  // Check for LLM provider
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOllama = !!process.env.OLLAMA_BASE_URL || process.env.LLM_PROVIDER === "ollama";

  if (!hasOpenAI && !hasAnthropic && !hasOllama) {
    console.error("  ERROR: No LLM provider configured.");
    console.error("  Add OPENAI_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_BASE_URL to .env");
    process.exit(1);
  }

  // Test RANKIGI connection
  console.log("  Connecting to RANKIGI layer...");
  const connected = await rankigi.ping();

  if (connected) {
    console.log("  \u2713 Governance layer active");
  } else {
    console.log("  \u26a0 RANKIGI unreachable — events will be buffered locally");
  }

  // Boot agent
  const agent = new Agent();

  // Initialize self-model + outer loop
  const agentId = process.env.RANKIGI_AGENT_ID ?? "UNREGISTERED";
  const selfModelStore = new SelfModelStore(agentId);
  selfModelStore.load(null); // Fresh start — will persist after first run
  const outerLoop = new OuterLoop(selfModelStore);
  outerLoop.start();
  agent.attachSelfModel(selfModelStore, outerLoop);

  if (process.env.SELF_MODEL_VERBOSE === "true") {
    printSelfModel(selfModelStore.getModel());
  }

  const model = selfModelStore.getModel();
  console.log(`  Self-model: v${model.version} | ${model.readiness_tier} | ${model.total_runs_observed} runs`);
  console.log(`  Compiled patterns: ${model.timing_curve.compiled_patterns}`);
  console.log(`  Outer loop: online`);

  // Initialize frustration detector
  const frustration = new FrustrationDetector(rankigi);
  agent.attachFrustration(frustration);

  // Initialize KAIROS proactive tick loop
  const beliefSeal = createSeal();
  const kairos = new KairosOuterLoop(selfModelStore, rankigi, beliefSeal, verifySeal);
  kairos.attachFrustration(frustration);
  kairos.start();
  console.log("  [KAIROS] Proactive outer loop active");

  // Register startup event
  await rankigi.observe({
    action: "agent_startup",
    input: { agent_id: process.env.RANKIGI_AGENT_ID },
    output: {
      governance_connected: connected,
      self_model_version: model.version,
      readiness_tier: model.readiness_tier,
      kairos_enabled: true,
      frustration_detection: true,
    },
    execution_result: "success",
  });

  // Start Telegram interface if configured
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const telegram = new TelegramInterface(agent, kairos, frustration);
    telegram.start();
  } else {
    console.log("  TELEGRAM_BOT_TOKEN not set — Telegram interface skipped");
  }

  console.log("");
  console.log("  Agent ready. All actions governed.");
  console.log("");

  // Periodic buffer flush
  setInterval(() => {
    if (rankigi.getBufferSize() > 0) {
      rankigi.flush();
    }
  }, 30000);

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[SHUTDOWN] Stopping KAIROS...");
    kairos.stop();
    outerLoop.stop();
    console.log("[SHUTDOWN] Agent stopped.");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
