import { rankigi } from "../rankigi";

export const calculator = {
  name: "calculator",
  description: "Evaluate a mathematical expression with numbers. You MUST pass the 'expression' argument as a string like '2 + 3 * 4'. Only use this for math with numbers.",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "The math expression to evaluate (e.g. '2 + 3 * 4')" },
    },
    required: ["expression"],
  },
  async execute(args: { expression: string }): Promise<string> {
    return rankigi.wrap("calculator", async () => {
      // Guard: expression must be a non-empty string
      if (!args.expression || typeof args.expression !== "string") {
        return "Error: no math expression provided. Pass an 'expression' argument like '2 + 3 * 4'.";
      }

      // Sanitize: only allow numbers, operators, parentheses, spaces, and math functions
      const sanitized = args.expression.replace(/[^0-9+\-*/().%^ \t\n]/g, "");

      if (sanitized.length === 0) {
        return "Invalid expression. Only numbers and math operators are allowed.";
      }

      try {
        // Safe evaluation using Function constructor with restricted scope
        const result = new Function(`"use strict"; return (${sanitized})`)();

        if (typeof result !== "number" || !isFinite(result)) {
          return "Result is not a finite number.";
        }

        return `${args.expression} = ${result}`;
      } catch {
        return `Could not evaluate: ${args.expression}`;
      }
    });
  },
};
