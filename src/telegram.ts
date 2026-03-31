import TelegramBot from "node-telegram-bot-api";
import { Agent } from "./agent";
import type { KairosOuterLoop } from "./kairos/tick";
import type { FrustrationDetector } from "./kairos/frustration";

const agentId = process.env.RANKIGI_AGENT_ID ?? "UNREGISTERED";

export class TelegramInterface {
  private bot: TelegramBot;
  private agent: Agent;
  private kairos: KairosOuterLoop | null;
  private frustration: FrustrationDetector | null;

  constructor(
    agent: Agent,
    kairos?: KairosOuterLoop | null,
    frustration?: FrustrationDetector | null,
  ) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

    this.bot = new TelegramBot(token, { polling: true });
    this.agent = agent;
    this.kairos = kairos ?? null;
    this.frustration = frustration ?? null;
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
