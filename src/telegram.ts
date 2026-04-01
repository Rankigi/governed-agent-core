import TelegramBot from "node-telegram-bot-api";
import { handleCommand, type CommandContext } from "./commands/handler";

export class TelegramInterface {
  private bot: TelegramBot;
  private ctx: CommandContext;

  constructor(ctx: CommandContext) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

    this.bot = new TelegramBot(token, { polling: true });
    this.ctx = ctx;
  }

  start(): void {
    this.bot.on("message", async (msg) => {
      if (!msg.text) return;

      const chatId = msg.chat.id;

      try {
        if (!msg.text.startsWith("/")) {
          await this.bot.sendChatAction(chatId, "typing");
        }
        const response = await handleCommand(msg.text, this.ctx);
        if (response) {
          await this.bot.sendMessage(chatId, response);
        }
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
