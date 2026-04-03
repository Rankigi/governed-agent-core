import dotenv from "dotenv";
dotenv.config();

import { createHash } from "crypto";
import readline from "readline";
import { Agent } from "./agent";
import { TelegramInterface } from "./telegram";
import { rankigi } from "./rankigi";
import { SelfModelStore } from "./self-model/store";
import { OuterLoop } from "./self-model/outer-loop";
import { printSelfModel } from "./self-model/dashboard";
import { KairosOuterLoop } from "./kairos/tick";
import { FrustrationDetector } from "./kairos/frustration";
import { createSeal, verifySeal, getSealHash } from "./beliefs/seal";
import { MemoryStack } from "./memory/stack";
import { CORE_BELIEFS } from "./beliefs/core-beliefs";
import { handleCommand, type CommandContext } from "./commands/handler";
import { PassportManager } from "./passport/loader";

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

  // Initialize passport data layer
  const agentId = process.env.RANKIGI_AGENT_ID ?? "UNREGISTERED";
  const passport_hash = process.env.PASSPORT_HASH
    || createHash("sha256").update(agentId).digest("hex").slice(0, 16);

  const passport = new PassportManager(passport_hash, rankigi);
  const passportData = await passport.load();

  // Seal beliefs into passport on first boot
  if (!passportData.core_beliefs_hash) {
    const beliefSealForPassport = createSeal();
    const beliefsHash = getSealHash(beliefSealForPassport);
    await passport.sealBeliefs(
      CORE_BELIEFS.map((b) => b.title),
      beliefsHash,
    );
    console.log("  [PASSPORT] Beliefs sealed at genesis");
  }

  console.log(`  [PASSPORT] ${passportData.display_name} | Hash: ${passport_hash.slice(0, 8)}...`);
  console.log(`  [PASSPORT] Engine: ${passportData.current_engine.provider}/${passportData.current_engine.model}`);
  console.log(`  [PASSPORT] Total runs (all engines): ${passportData.total_runs} | Patterns: ${passportData.compiled_patterns.length}`);

  // Detect actual engine from .env
  const actualProvider = process.env.LLM_PROVIDER
    || (hasAnthropic ? "anthropic" : hasOpenAI ? "openai" : "ollama");
  const actualModel = actualProvider === "ollama"
    ? (process.env.OLLAMA_MODEL || "llama3.2:1b")
    : actualProvider === "anthropic"
      ? (process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6")
      : (process.env.OPENAI_MODEL || "gpt-4o");

  // Auto-switch engine if passport says different provider than .env
  const passportEngine = passportData.current_engine;
  if (passportEngine.provider !== actualProvider || passportEngine.model !== actualModel) {
    console.log(`  [PASSPORT] Engine mismatch: passport=${passportEngine.provider}/${passportEngine.model} env=${actualProvider}/${actualModel}`);
    await passport.switchEngine(
      actualProvider,
      actualModel,
      `Auto-detected engine change on startup (${passportEngine.provider}/${passportEngine.model} → ${actualProvider}/${actualModel})`,
      rankigi,
    );
    console.log(`  [PASSPORT] Engine switched to ${actualProvider}/${actualModel}`);
  }

  // Boot agent
  const agent = new Agent();
  const selfModelStore = new SelfModelStore(agentId);
  selfModelStore.load(null); // Fresh in-memory — patterns loaded from passport below

  // Inject compiled patterns from passport into self-model
  const passportPatterns = passport.get().compiled_patterns;
  if (passportPatterns.length > 0) {
    selfModelStore.loadPatterns(passportPatterns);
    console.log(`  [SELF-MODEL] Loaded ${passportPatterns.length} compiled patterns from passport`);
  }

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

  // Initialize Akashic Pulse Memory stack — stored inside passport
  const memoryStack = new MemoryStack(agentId, passportData.memory_stack_path, rankigi);
  await memoryStack.initialize();

  // Create foundation layer on first startup
  if (!memoryStack.hasFoundation()) {
    const passportHash = agentId; // Agent passport ID as genesis reference
    await memoryStack.file(
      {
        summary: "Foundation layer. Agent genesis context.",
        delta: {
          agent_id: agentId,
          passport_hash: passportHash,
          core_beliefs: CORE_BELIEFS.map((b) => b.title),
          genesis_at: new Date().toISOString(),
          model: process.env.LLM_PROVIDER ?? "auto",
        },
      },
      "foundation",
      undefined,
      0,
    );
    console.log("  [MEMORY] Foundation layer created at genesis");
  }

  agent.attachMemoryStack(memoryStack);
  agent.attachPassport(passport);

  // Wire ERIDU to pulse memory for prior context
  const { attachMemory: attachERIDUMemory } = await import("./tools/eridu");
  attachERIDUMemory(memoryStack);

  // Sync memory stats into passport
  const stackSize = memoryStack.getLayerCount();
  const foundationHash = memoryStack.getFoundationHash();
  await passport.updateMemoryStats(stackSize, foundationHash ?? "");
  console.log(`  [MEMORY] Stack: ${stackSize} layers | Foundation: ${foundationHash?.slice(0, 8)}...`);
  console.log("  [MEMORY] Pulse ready: YES");

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
      memory_stack_layers: stackSize,
      memory_foundation: foundationHash?.slice(0, 8),
      pulse_ready: true,
      passport_hash: passport_hash.slice(0, 8),
      passport_engine: `${passportData.current_engine.provider}/${passportData.current_engine.model}`,
      passport_total_runs: passportData.total_runs,
      passport_patterns: passportData.compiled_patterns.length,
    },
    execution_result: "success",
  });

  // Build shared command context
  const cmdCtx: CommandContext = {
    agent,
    kairos,
    frustration,
    memoryStack,
    selfModelStore,
    passport,
  };

  // Start Telegram interface if configured
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const telegram = new TelegramInterface(cmdCtx);
    telegram.start();
  } else {
    console.log("  TELEGRAM_BOT_TOKEN not set — Telegram interface skipped");
  }

  console.log("");
  console.log("  Agent ready. All actions governed.");
  console.log("");

  // Terminal readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  rl.prompt();

  rl.on("line", async (input) => {
    const trimmed = input.trim();
    if (trimmed) {
      try {
        const response = await handleCommand(trimmed, cmdCtx);
        if (response) console.log(response);
      } catch (err) {
        console.error("[ERROR]", err);
      }
    }
    rl.prompt();
  });

  rl.on("close", async () => {
    console.log("\n[SHUTDOWN] Readline closed. Saving patterns...");
    const patterns = selfModelStore.getCompiledPatterns();
    await passport.updateAfterRun({
      new_patterns: patterns,
      memory_layers_filed: memoryStack.getLayerCount(),
      confidence: selfModelStore.getConfidence(),
      chain_index: 0,
      last_event_hash: "",
    });
    console.log(`[SHUTDOWN] Saved. Patterns: ${patterns.length}`);
    kairos.stop();
    outerLoop.stop();
    process.exit(0);
  });

  // Periodic buffer flush
  setInterval(() => {
    if (rankigi.getBufferSize() > 0) {
      rankigi.flush();
    }
  }, 30000);

  // Graceful shutdown — save patterns before exit
  process.on("SIGINT", async () => {
    console.log("\n[SHUTDOWN] Saving patterns to passport...");

    const patterns = selfModelStore.getCompiledPatterns();
    await passport.updateAfterRun({
      new_patterns: patterns,
      memory_layers_filed: memoryStack.getLayerCount(),
      confidence: selfModelStore.getConfidence(),
      chain_index: 0,
      last_event_hash: "",
    });

    console.log(`[SHUTDOWN] Saved. Patterns: ${patterns.length}`);

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
