import TelegramBot from "node-telegram-bot-api";
import { Agent } from "./agent";
import type { KairosOuterLoop } from "./kairos/tick";
import type { FrustrationDetector } from "./kairos/frustration";
import type { MemoryStack } from "./memory/stack";

const agentId = process.env.RANKIGI_AGENT_ID ?? "UNREGISTERED";

export class TelegramInterface {
  private bot: TelegramBot;
  private agent: Agent;
  private kairos: KairosOuterLoop | null;
  private frustration: FrustrationDetector | null;
  private memoryStack: MemoryStack | null;

  constructor(
    agent: Agent,
    kairos?: KairosOuterLoop | null,
    frustration?: FrustrationDetector | null,
    memoryStack?: MemoryStack | null,
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

    this.bot = new TelegramBot(token, { polling: true });
    this.agent = agent;
    this.kairos = kairos ?? null;
    this.frustration = frustration ?? null;
    this.memoryStack = memoryStack ?? null;
  }

  start(): void {
    this.bot.onText(/\/start/, (msg) => {
      this.bot.sendMessage(
        msg.chat.id,
        `Agent ${agentId} online.\nGoverned by RANKIGI.\nEvery action is recorded.\n\nWhat do you need?`,
      );
    });

    this.bot.onText(/\/status/, (msg) => {
      this.bot.sendMessage(
        msg.chat.id,
        `Passport: ${agentId}\nStatus: ACTIVE\nGoverned: YES\nDashboard: rankigi.com`,
      );
    });

    // /kairos — show KAIROS daily log
    this.bot.onText(/\/kairos/, (msg) => {
      if (!this.kairos) {
        this.bot.sendMessage(msg.chat.id, "KAIROS not enabled.");
        return;
      }

      const log = this.kairos.getDailyLog();
      const tickNum = this.kairos.getTickNumber();
      const acted = log.filter((l) => l.includes("— acted:")).length;
      const deferred = log.filter((l) => l.includes("— deferred:")).length;
      const alerts = log.filter((l) => l.includes("ALERT")).length;
      const recent = log.slice(-5).reverse();

      const text = [
        "KAIROS DAILY LOG",
        "────────────────",
        `Ticks: ${tickNum}`,
        `Actions taken: ${acted}`,
        `Deferred: ${deferred}`,
        `Alerts: ${alerts}`,
        "",
        "Recent:",
        ...recent.map((l) => l),
      ].join("\n");

      this.bot.sendMessage(msg.chat.id, text);
    });

    // /frustration — show frustration state
    this.bot.onText(/\/frustration/, (msg) => {
      if (!this.frustration) {
        this.bot.sendMessage(msg.chat.id, "Frustration detector not enabled.");
        return;
      }

      const state = this.frustration.getState();
      const toolLine = state.recent_tools.length > 0
        ? state.recent_tools.join(" → ")
        : "(no tool calls)";

      // Detect tool loop risk
      const last3 = state.recent_tools.slice(-3);
      const toolLoopRisk =
        last3.length === 3 && last3.every((t) => t === last3[0]);

      // Confidence trend
      const confLine = state.confidence_trend.length > 0
        ? state.confidence_trend.join(" → ")
        : "(no data)";
      const confDrop =
        state.confidence_trend.length >= 5
          ? state.confidence_trend[0] - state.confidence_trend[state.confidence_trend.length - 1]
          : 0;

      const lines = [
        "FRUSTRATION STATE",
        "─────────────────",
        `Run: ${state.run_index}`,
        "",
        "Recent tools:",
        `  ${toolLine}`,
      ];

      if (toolLoopRisk) {
        lines.push(`  ⚠ Tool loop risk: ${last3[0]}`);
      }

      lines.push(
        "",
        `Confidence trend (last ${state.confidence_trend.length}):`,
        `  ${confLine}`,
      );

      if (confDrop >= 20) {
        lines.push(`  🔴 Confidence collapse: -${confDrop} pts`);
      }

      lines.push(
        "",
        `Output stall: ${state.output_stall_risk ? "⚠ RISK" : "NONE"}`,
      );

      this.bot.sendMessage(msg.chat.id, lines.join("\n"));
    });

    // /prime — full agent status including memory stack
    this.bot.onText(/\/prime/, (msg) => {
      const selfLines = [
        "AGENT PRIME",
        "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
        `Passport: ${agentId}`,
        `Status: ACTIVE`,
        `Governed: YES`,
        "",
      ];

      // Memory Stack section
      if (this.memoryStack) {
        const layerCount = this.memoryStack.getLayerCount();
        const foundHash = this.memoryStack.getFoundationHash();
        const indexKb = Math.round(this.memoryStack.getIndexSizeBytes() / 1024);

        selfLines.push("[MEMORY STACK]");
        selfLines.push(`\u25c8 Layers: ${layerCount}`);
        selfLines.push(`\u25c8 Foundation: ${foundHash ? foundHash.slice(0, 8) + "..." : "none"}`);
        selfLines.push(`\u25c8 Index size: ${indexKb}kb`);
        selfLines.push(`\u25c8 Pulse ready: YES`);
        selfLines.push("");
      } else {
        selfLines.push("[MEMORY STACK]");
        selfLines.push("\u25c8 Not initialized");
        selfLines.push("");
      }

      // KAIROS section
      if (this.kairos) {
        const log = this.kairos.getDailyLog();
        const tickNum = this.kairos.getTickNumber();
        selfLines.push("[KAIROS]");
        selfLines.push(`\u25c8 Ticks: ${tickNum}`);
        selfLines.push(`\u25c8 Actions today: ${log.filter((l) => l.includes("acted")).length}`);
        selfLines.push("");
      }

      // Frustration section
      if (this.frustration) {
        const state = this.frustration.getState();
        selfLines.push("[FRUSTRATION]");
        selfLines.push(`\u25c8 Output stall: ${state.output_stall_risk ? "\u26a0 RISK" : "NONE"}`);
        selfLines.push("");
      }

      this.bot.sendMessage(msg.chat.id, selfLines.join("\n"));
    });

    // /pulse <query> — manual pulse against the memory stack
    this.bot.onText(/\/pulse\s+(.+)/, async (msg, match) => {
      if (!this.memoryStack) {
        this.bot.sendMessage(msg.chat.id, "Memory stack not initialized.");
        return;
      }

      const query = match?.[1] ?? "";
      if (!query) {
        this.bot.sendMessage(msg.chat.id, "Usage: /pulse <query>");
        return;
      }

      const result = await this.memoryStack.pulse(query, {
        max_surface: 5,
        min_resonance: 20,
      });

      const lines = [
        `PULSE \u2014 "${query}"`,
        "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
        `${result.pulse_ms}ms | ${result.total_layers_pulsed} layers pulsed`,
        "",
      ];

      if (result.resonant_layers.length > 0) {
        lines.push(`RESONANT (${result.resonant_layers.length}):`);
        for (const r of result.resonant_layers) {
          const summary = result.surfaced.find(
            (s) => s.index.layer_hash === r.layer_hash,
          )?.content.summary ?? "(not surfaced)";
          lines.push(`\u25c8 [${r.resonance_score}] ${r.layer_type} #${r.run_index}`);
          lines.push(`  "${summary.slice(0, 60)}"`);
          lines.push(`  Keys: ${r.keys_matched.join(", ")}`);
          lines.push("");
        }
      } else {
        lines.push("No resonant layers found.");
        lines.push("");
      }

      // Estimate tokens saved
      const totalContentBytes = result.surfaced.reduce(
        (s, l) => s + l.index.content_size_bytes, 0,
      );
      const deltaBytes = result.surfaced.reduce(
        (s, l) => s + l.index.delta_size_bytes, 0,
      );
      const tokensSaved = Math.round((totalContentBytes - deltaBytes) / 4);

      lines.push(`Surfaced: ${result.layers_surfaced} layers`);
      lines.push(`Tokens saved: ~${tokensSaved.toLocaleString()} vs full load`);
      lines.push(`Compression: ${result.compression_ratio}%`);

      this.bot.sendMessage(msg.chat.id, lines.join("\n"));
    });

    this.bot.on("message", async (msg) => {
      if (!msg.text || msg.text.startsWith("/")) return;

      const chatId = msg.chat.id;

      try {
        await this.bot.sendChatAction(chatId, "typing");
        const response = await this.agent.run(msg.text);
        await this.bot.sendMessage(chatId, response);
      } catch (error) {
        console.error("[TELEGRAM] Error:", error);
        await this.bot.sendMessage(
          chatId,
          "An error occurred. It has been logged to RANKIGI.",
        );
      }
    });

    console.log("[TELEGRAM] Bot started. Listening for messages.");
  }
}
