import TelegramBot from "node-telegram-bot-api";
import { Agent } from "./agent";

const agentId = process.env.RANKIGI_AGENT_ID ?? "UNREGISTERED";

export class TelegramInterface {
  private bot: TelegramBot;
  private agent: Agent;

  constructor(agent: Agent) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

    this.bot = new TelegramBot(token, { polling: true });
    this.agent = agent;
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
