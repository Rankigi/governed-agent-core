import { rankigi } from "../rankigi";

const store = new Map<string, string>();

export const remember = {
  name: "remember",
  description: "Store or recall a note. Use operation 'set' to save a value under a key, or 'get' to retrieve it.",
  parameters: {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["set", "get"], description: "Whether to set or get a value" },
      key: { type: "string", description: "The key to store or retrieve" },
      value: { type: "string", description: "The value to store (only for set operation)" },
    },
    required: ["operation", "key"],
  },
  async execute(args: { operation: string; key: string; value?: string }): Promise<string> {
    return rankigi.wrap("remember", async () => {
      if (args.operation === "set") {
        store.set(args.key, args.value ?? "");
        return `Stored: "${args.key}" = "${args.value}"`;
      }

      if (args.operation === "get") {
        const value = store.get(args.key);
        return value !== undefined
          ? `Recalled: "${args.key}" = "${value}"`
          : `No value stored for key "${args.key}"`;
      }

      return `Unknown operation: ${args.operation}`;
    });
  },
};
