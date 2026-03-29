import { rankigi } from "../rankigi";
import { createProvider } from "../providers";

export const summarize = {
  name: "summarize",
  description: "Summarize a given text into a concise summary.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to summarize" },
    },
    required: ["text"],
  },
  async execute(args: { text: string }): Promise<string> {
    return rankigi.wrap("summarize", async () => {
      const provider = createProvider();
      const response = await provider.call(
        [
          { role: "system", content: "You are a summarization assistant. Produce a concise summary of the given text." },
          { role: "user", content: `Summarize the following text:\n\n${args.text.slice(0, 8000)}` },
        ],
        [],
      );
      return response.content ?? "Unable to generate summary.";
    });
  },
};
