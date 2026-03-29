import axios from "axios";
import { rankigi } from "../rankigi";

export const webSearch = {
  name: "web_search",
  description: "Search the web for information. Returns top results.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
    },
    required: ["query"],
  },
  async execute(args: { query: string }): Promise<string> {
    return rankigi.wrap("web_search", async () => {
      const res = await axios.get("https://api.duckduckgo.com/", {
        params: { q: args.query, format: "json", no_redirect: 1 },
        timeout: 10000,
      });

      const data = res.data;
      const results: string[] = [];

      if (data.Abstract) {
        results.push(`Summary: ${data.Abstract}`);
      }

      if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics.slice(0, 3)) {
          if (topic.Text) {
            results.push(`- ${topic.Text}`);
          }
        }
      }

      return results.length > 0
        ? results.join("\n\n")
        : `No results found for "${args.query}". Try a different query.`;
    });
  },
};
