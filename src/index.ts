import dotenv from "dotenv";
dotenv.config();

import { Agent } from "./agent";
import { TelegramInterface } from "./telegram";
import { rankigi } from "./rankigi";

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

  // Register startup event
  await rankigi.observe({
    action: "agent_startup",
    input: { agent_id: process.env.RANKIGI_AGENT_ID },
    output: { governance_connected: connected },
    execution_result: "success",
  });

  // Start Telegram interface if configured
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const telegram = new TelegramInterface(agent);
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
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
