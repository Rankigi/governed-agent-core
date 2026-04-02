import crypto from "crypto";
import { createProvider, type BaseLLMProvider } from "./providers";
import { Memory } from "./memory";
import { getToolDefinitions, executeTool } from "./tools";
import { rankigi } from "./rankigi";
import type { SelfModelStore } from "./self-model/store";
import type { OuterLoop } from "./self-model/outer-loop";
import type { FrustrationDetector } from "./kairos/frustration";
import type { MemoryStack } from "./memory/stack";
import type { PassportManager } from "./passport/loader";

const MAX_ITERATIONS = 10;

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

export class Agent {
  private provider: BaseLLMProvider;
  private memory: Memory;
  private selfModelStore: SelfModelStore | null = null;
  private outerLoop: OuterLoop | null = null;
  private frustration: FrustrationDetector | null = null;
  private memoryStack: MemoryStack | null = null;
  private passport: PassportManager | null = null;
  private lastLayerHash: string | null = null;
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

  /** Attach the frustration detector */
  attachFrustration(detector: FrustrationDetector): void {
    this.frustration = detector;
  }

  /** Attach the Akashic Pulse Memory stack */
  attachMemoryStack(stack: MemoryStack): void {
    this.memoryStack = stack;
  }

  /** Attach the passport data layer */
  attachPassport(pm: PassportManager): void {
    this.passport = pm;
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

    // 2. PULSE memory for context before processing
    if (this.memoryStack) {
      const pulse = await this.memoryStack.pulse(userMessage, {
        max_surface: 3,
        min_resonance: 25,
      });

      if (pulse.surfaced.length > 0) {
        const memory_context = pulse.surfaced
          .map((l) => l.content.summary)
          .join("\n");

        this.memory.setMemoryContext(
          `[MEMORY \u2014 ${pulse.pulse_ms}ms]\n${memory_context}`,
        );

        console.log(
          `[PULSE] Found ${pulse.surfaced.length} relevant memories in ${pulse.pulse_ms}ms`,
        );
      }
    }

    // 3. Add user message to memory
    this.memory.addUserMessage(userMessage);

    // 4. Observe user input + notify outer loop
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

    // 5. Check for compiled pattern
    let hasCompiledPattern = false;
    if (this.selfModelStore) {
      const sig = userMessage.slice(0, 100);
      const pattern = this.selfModelStore.findMatchingPattern(`general:${sig}`);
      if (pattern) {
        hasCompiledPattern = true;
        console.log(`[AGENT] Compiled pattern found — executing directly`);
      }
    }

    // 6. Reasoning loop
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

        // Frustration: record output hash
        if (this.frustration) {
          const outputHash = sha256(content);
          this.frustration.recordOutput(outputHash);
        }

        // Frustration: record confidence after run
        if (this.frustration && this.selfModelStore) {
          this.frustration.recordConfidence(
            this.selfModelStore.getModel().confidence_score,
          );
        }

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

        // Subconscious files the run to Akashic memory
        if (this.memoryStack) {
          const confidenceSnapshot = this.selfModelStore
            ? this.selfModelStore.getModel().confidence_score
            : undefined;

          const toolOutcomes = this.selfModelStore
            ? Object.values(this.selfModelStore.getModel().tool_performance)
                .filter((t) => toolsUsed.includes(t.tool_id))
                .map((t) => ({
                  tool: t.tool_name,
                  success_rate: t.success_rate,
                  avg_ms: t.avg_latency_ms,
                }))
            : undefined;

          const filed = await this.memoryStack.file(
            {
              summary: `Run ${this.runCounter}: ${userMessage.slice(0, 100)}`,
              delta: {
                tools_used: toolsUsed,
                outcome: "success",
                solve_time_ms: Date.now() - runStart,
                had_compiled_pattern: hasCompiledPattern,
              },
              confidence_snapshot: confidenceSnapshot,
              tool_outcomes: toolOutcomes,
            },
            "task_history",
            this.lastLayerHash ?? undefined,
            this.runCounter,
          );
          this.lastLayerHash = filed.index.layer_hash;
        }

        // Update passport after every run
        if (this.passport) {
          await this.passport.updateAfterRun({
            new_patterns: [],
            memory_layers_filed: this.memoryStack ? 1 : 0,
            confidence: this.selfModelStore?.getModel().confidence_score ?? 0,
            chain_index: 0,
            last_event_hash: "",
          });
        }

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

        // Frustration: record tool call
        if (this.frustration) {
          this.frustration.recordToolCall(toolCall.name);
        }

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

    // Frustration: record output hash for the fallback too
    if (this.frustration) {
      this.frustration.recordOutput(sha256(fallback));
      if (this.selfModelStore) {
        this.frustration.recordConfidence(
          this.selfModelStore.getModel().confidence_score,
        );
      }
    }

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
