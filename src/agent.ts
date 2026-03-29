import { createProvider, type BaseLLMProvider } from "./providers";
import { Memory } from "./memory";
import { getToolDefinitions, executeTool } from "./tools";
import { rankigi } from "./rankigi";

const MAX_ITERATIONS = 10;

export class Agent {
  private provider: BaseLLMProvider;
  private memory: Memory;

  constructor() {
    this.provider = createProvider();
    this.memory = new Memory();

    console.log(`[AGENT] Provider: ${this.provider.name} | Model: ${this.provider.model}`);
  }

  async run(userMessage: string): Promise<string> {
    // 1. Add user message to memory
    this.memory.addUserMessage(userMessage);

    // 2. Observe user input
    await rankigi.observe({
      action: "agent_input",
      input: { message: userMessage },
      output: {},
      execution_result: "success",
    });

    // 3. Reasoning loop
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.provider.call(
        this.memory.getMessages(),
        getToolDefinitions(),
      );

      // Observe LLM response
      await rankigi.observe({
        action: "llm_response",
        input: { iteration: i + 1, message_count: this.memory.getMessages().length },
        output: {
          content: response.content?.slice(0, 500),
          tool_calls: response.tool_calls.map((tc) => tc.name),
          model: response.model,
          tokens: response.usage,
        },
        execution_result: "success",
      });

      // No tool calls — final response
      if (response.tool_calls.length === 0) {
        const content = response.content ?? "";
        this.memory.addAssistantMessage(content);

        await rankigi.observe({
          action: "agent_output",
          input: { message: userMessage },
          output: { response: content.slice(0, 500) },
          execution_result: "success",
        });

        return content;
      }

      // Tool calls — execute each and continue loop
      this.memory.addAssistantMessage(response.content ?? "", response.tool_calls);

      for (const toolCall of response.tool_calls) {
        const result = await executeTool(toolCall.name, toolCall.arguments);
        this.memory.addToolResult(toolCall.id, result);
      }
    }

    // Max iterations reached
    const fallback = "I was unable to complete this task within the allowed steps.";
    this.memory.addAssistantMessage(fallback);

    await rankigi.observe({
      action: "agent_output",
      input: { message: userMessage },
      output: { response: fallback, reason: "max_iterations" },
      execution_result: "error",
    });

    return fallback;
  }
}
