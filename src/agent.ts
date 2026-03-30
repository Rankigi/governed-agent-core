import crypto from "crypto";
import { createProvider, type BaseLLMProvider } from "./providers";
import { Memory } from "./memory";
import { getToolDefinitions, executeTool } from "./tools";
import { rankigi } from "./rankigi";
import type { SelfModelStore } from "./self-model/store";
import type { OuterLoop } from "./self-model/outer-loop";

const MAX_ITERATIONS = 10;

export class Agent {
  private provider: BaseLLMProvider;
  private memory: Memory;
  private selfModelStore: SelfModelStore | null = null;
  private outerLoop: OuterLoop | null = null;
  private runCounter = 0;

  constructor() {
    this.provider = createProvider();
    this.memory = new Memory();
    console.log(`[AGENT] Provider: ${this.provider.name} | Model: ${this.provider.model}`);
  }

  /** Attach the self-model for epistemic injection */
  attachSelfModel(store: SelfModelStore, loop: OuterLoop): void {
    this.selfModelStore = store;
    this.outerLoop = loop;
  }

  async run(userMessage: string): Promise<string> {
    const runId = crypto.randomUUID();
    const runStart = Date.now();
    this.runCounter++;
    const toolsUsed: string[] = [];

    // 1. Refresh system prompt with self-model epistemic summary
    if (this.selfModelStore) {
      this.memory.setEpistemicContext(this.selfModelStore.getEpistemicSummary());
    }

    // 2. Add user message to memory
    this.memory.addUserMessage(userMessage);

    // 3. Observe user input + notify outer loop
    const inputEvent = {
      action: "agent_input",
      input: { message: userMessage },
      output: {},
      execution_result: "success" as const,
    };
    await rankigi.observe(inputEvent);
    await this.outerLoop?.onChainEvent({
      action: "agent_input",
      payload: { message: userMessage, run_id: runId },
      occurred_at: new Date().toISOString(),
    });

    // 4. Check for compiled pattern
    let hasCompiledPattern = false;
    if (this.selfModelStore) {
      const sig = userMessage.slice(0, 100);
      const pattern = this.selfModelStore.findMatchingPattern(`general:${sig}`);
      if (pattern) {
        hasCompiledPattern = true;
        console.log(`[AGENT] Compiled pattern found — executing directly`);
      }
    }

    // 5. Reasoning loop
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.provider.call(
        this.memory.getMessages(),
        getToolDefinitions(),
      );

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

        const outputEvent = {
          action: "agent_output",
          input: { message: userMessage },
          output: { response: content.slice(0, 500) },
          execution_result: "success" as const,
        };
        await rankigi.observe(outputEvent);

        // Notify outer loop — inference complete
        await this.outerLoop?.onChainEvent({
          action: "inference_complete",
          payload: {
            run_id: runId,
            total_solve_time_ms: Date.now() - runStart,
            tools_invoked_count: toolsUsed.length,
            execution_result: "success",
            skipped_reasoning: hasCompiledPattern,
          },
          occurred_at: new Date().toISOString(),
        });

        return content;
      }

      // Tool calls — execute each
      this.memory.addAssistantMessage(response.content ?? "", response.tool_calls);

      for (const toolCall of response.tool_calls) {
        const toolStart = Date.now();

        // Notify outer loop — tool call start
        await this.outerLoop?.onChainEvent({
          action: "tool_call_start",
          payload: { tool_id: toolCall.name, tool_name: toolCall.name, run_id: runId },
          occurred_at: new Date().toISOString(),
        });

        const result = await executeTool(toolCall.name, toolCall.arguments);
        this.memory.addToolResult(toolCall.id, result);
        toolsUsed.push(toolCall.name);

        const toolLatency = Date.now() - toolStart;

        // Notify outer loop — tool call complete
        await this.outerLoop?.onChainEvent({
          action: "tool_call_complete",
          payload: {
            tool_id: toolCall.name,
            tool_name: toolCall.name,
            latency_ms: toolLatency,
            execution_result: result.startsWith("Error") ? "error" : "success",
            run_id: runId,
          },
          occurred_at: new Date().toISOString(),
        });
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

    // Notify outer loop — inference complete with error
    await this.outerLoop?.onChainEvent({
      action: "inference_complete",
      payload: {
        run_id: runId,
        total_solve_time_ms: Date.now() - runStart,
        tools_invoked_count: toolsUsed.length,
        execution_result: "error",
        skipped_reasoning: false,
      },
      occurred_at: new Date().toISOString(),
    });

    return fallback;
  }
}
