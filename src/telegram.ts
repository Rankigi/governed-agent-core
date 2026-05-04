import TelegramBot from "node-telegram-bot-api";
import { handleCommand, type CommandContext } from "./commands/handler";
import { proxyUrl } from "./lib/proxy";

export class TelegramInterface {
  private bot: TelegramBot;
  private ctx: CommandContext;

  constructor(ctx: CommandContext) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

    // node-telegram-bot-api uses the `request` library, which only honors
    // an explicit `proxy` option — not HTTPS_PROXY env vars.
    const options: TelegramBot.ConstructorOptions = { polling: true };
    if (proxyUrl) {
      options.request = { proxy: proxyUrl } as TelegramBot.ConstructorOptions["request"];
    }
    this.bot = new TelegramBot(token, options);
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
