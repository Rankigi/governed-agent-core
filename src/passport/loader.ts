/**
 * Passport Manager — Load, save, and manage the passport data layer.
 *
 * The passport is the permanent identity. The engine is swappable.
 * Everything that matters — memory, patterns, beliefs, trust — lives here.
 */

import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";
import type {
  PassportData, CompiledPattern, EngineRecord, TransitionBrief,
} from "./types";

const PASSPORT_DIR = path.join(os.homedir(), ".rankigi", "passports");

interface RankigiRef {
  observe(event: {
    action: string;
    input: unknown;
    output: unknown;
    execution_result: string;
  }): Promise<void>;
}

export class PassportManager {
  private data: PassportData | null = null;
  private passport_hash: string;

  constructor(passport_hash: string) {
    this.passport_hash = passport_hash;
  }

  get passport_path(): string {
    return path.join(PASSPORT_DIR, this.passport_hash, "passport.json");
  }

  get memory_path(): string {
    return path.join(PASSPORT_DIR, this.passport_hash, "memory");
  }

  // ─────────────────────────────────────
  // LOAD / CREATE / SAVE
  // ─────────────────────────────────────

  async load(): Promise<PassportData> {
    try {
      const raw = await fs.readFile(this.passport_path, "utf-8");
      this.data = JSON.parse(raw) as PassportData;
      this.data = await this.migrate(this.data);

      console.log(
        `[PASSPORT] Loaded.` +
        ` Engine history: ${this.data.engine_history.length} engines.` +
        ` Patterns: ${this.data.compiled_patterns.length}.` +
        ` Memory: ${this.data.memory_layer_count} layers.`,
      );

      return this.data;
    } catch {
      return this.create();
    }
  }

  async create(): Promise<PassportData> {
    const now = new Date().toISOString();

    const provider = process.env.LLM_PROVIDER || "ollama";
    const model = provider === "ollama"
      ? (process.env.OLLAMA_MODEL || "llama3.2:1b")
      : provider === "anthropic"
        ? (process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6")
        : (process.env.OPENAI_MODEL || "gpt-4o");

    this.data = {
      passport_id: process.env.RANKIGI_AGENT_ID || "",
      passport_hash: this.passport_hash,
      agent_uuid: process.env.RANKIGI_AGENT_UUID || "",
      org_id: "",
      display_name: "Gilgamesh",
      born_at: now,

      core_beliefs_hash: "",
      core_beliefs: [],

      memory_stack_path: this.memory_path,
      memory_layer_count: 0,
      memory_foundation_hash: "",

      compiled_patterns: [],

      trust_history: [],
      current_trust: {
        standing: "good",
        compliance_score: 100,
        confidence_score: 0,
        recorded_at: now,
        chain_index: 0,
      },

      chain_index: 0,
      last_event_hash: "",
      total_runs: 0,

      current_engine: {
        provider,
        model,
        started_at: now,
        ended_at: null,
        runs_completed: 0,
        patterns_compiled: 0,
        memory_layers_filed: 0,
        final_confidence: 0,
      },
      engine_history: [],

      schema_version: 1,
      last_updated: now,
    };

    await this.save();
    console.log(`[PASSPORT] Created. Hash: ${this.passport_hash.slice(0, 8)}...`);
    return this.data;
  }

  async save(): Promise<void> {
    if (!this.data) return;

    this.data.last_updated = new Date().toISOString();

    await fs.mkdir(path.dirname(this.passport_path), { recursive: true });
    await fs.writeFile(this.passport_path, JSON.stringify(this.data, null, 2));
    console.log(`[PASSPORT] Saved. Total runs: ${this.data.total_runs}`);
  }

  /** Seal beliefs into the passport — called once at genesis */
  async sealBeliefs(beliefs: string[], beliefs_hash: string): Promise<void> {
    if (!this.data) return;
    this.data.core_beliefs = beliefs;
    this.data.core_beliefs_hash = beliefs_hash;
    await this.save();
  }

  /** Update memory stats from the live memory stack */
  async updateMemoryStats(layer_count: number, foundation_hash: string): Promise<void> {
    if (!this.data) return;
    this.data.memory_layer_count = layer_count;
    this.data.memory_foundation_hash = foundation_hash;
    await this.save();
  }

  // ─────────────────────────────────────
  // UPDATE AFTER RUN
  // ─────────────────────────────────────

  async updateAfterRun(opts: {
    new_patterns: CompiledPattern[];
    memory_layers_filed: number;
    confidence: number;
    chain_index: number;
    last_event_hash: string;
  }): Promise<void> {
    if (!this.data) return;

    // Add new patterns
    for (const p of opts.new_patterns) {
      const existing = this.data.compiled_patterns.findIndex((ep) => ep.id === p.id);
      if (existing >= 0) {
        this.data.compiled_patterns[existing] = p;
      } else {
        this.data.compiled_patterns.push(p);
      }
    }

    // Update engine record
    this.data.current_engine.runs_completed++;
    this.data.current_engine.patterns_compiled += opts.new_patterns.length;
    this.data.current_engine.memory_layers_filed += opts.memory_layers_filed;
    this.data.current_engine.final_confidence = opts.confidence;

    // Update chain state
    this.data.chain_index = opts.chain_index;
    this.data.last_event_hash = opts.last_event_hash;
    this.data.total_runs++;

    // Update trust snapshot
    this.data.current_trust = {
      standing: "good",
      compliance_score: 100,
      confidence_score: opts.confidence,
      recorded_at: new Date().toISOString(),
      chain_index: opts.chain_index,
    };

    await this.save();
  }

  // ─────────────────────────────────────
  // ENGINE SWITCH
  // ─────────────────────────────────────

  async switchEngine(
    new_provider: string,
    new_model: string,
    reason: string,
    rankigi: RankigiRef | null,
  ): Promise<TransitionBrief> {
    if (!this.data) throw new Error("Passport not loaded");

    const now = new Date().toISOString();

    // 1. Generate transition brief
    const brief = await this.generateBrief(new_provider, new_model, rankigi);

    // 2. Close current engine record
    const closed_engine: EngineRecord = {
      ...this.data.current_engine,
      ended_at: now,
      transition_brief_hash: brief.brief_hash,
    };

    // 3. Move to history
    this.data.engine_history.push(closed_engine);

    // 4. Open new engine record
    this.data.current_engine = {
      provider: new_provider,
      model: new_model,
      started_at: now,
      ended_at: null,
      runs_completed: 0,
      patterns_compiled: 0,
      memory_layers_filed: 0,
      final_confidence: 0,
      reason_for_switch: reason,
    };

    // 5. Save passport
    await this.save();

    // 6. Write chain event
    await rankigi?.observe({
      action: "engine_switched",
      input: {
        from_provider: closed_engine.provider,
        from_model: closed_engine.model,
        from_runs: closed_engine.runs_completed,
        reason,
      },
      output: {
        to_provider: new_provider,
        to_model: new_model,
        compiled_patterns_preserved: this.data.compiled_patterns.length,
        memory_layers_preserved: this.data.memory_layer_count,
        brief_hash: brief.brief_hash,
      },
      execution_result: "success",
    });

    console.log(
      `\n[PASSPORT] Engine switched.\n` +
      `  From: ${closed_engine.provider}/${closed_engine.model}\n` +
      `  To:   ${new_provider}/${new_model}\n\n` +
      `  Preserved:\n` +
      `  \u25c8 Patterns: ${this.data.compiled_patterns.length}\n` +
      `  \u25c8 Memory:   ${this.data.memory_layer_count} layers\n` +
      `  \u25c8 Beliefs:  7 (sealed)\n` +
      `  \u25c8 Chain:    index ${this.data.chain_index}\n\n` +
      `  Brief: ${brief.brief_hash.slice(0, 8)}`,
    );

    return brief;
  }

  private async generateBrief(
    to_provider: string,
    to_model: string,
    rankigi: RankigiRef | null,
  ): Promise<TransitionBrief> {
    if (!this.data) throw new Error("Passport not loaded");

    const brief_id = `brief_${Date.now()}`;
    const now = new Date().toISOString();

    const pattern_summary = this.data.compiled_patterns
      .map((p) => `${p.pattern} \u2192 ${p.solution_path.slice(0, 50)}`);

    const handoff_message = [
      `You are taking over from ${this.data.current_engine.provider}/${this.data.current_engine.model} after ${this.data.current_engine.runs_completed} runs.`,
      "",
      `I have compiled ${this.data.compiled_patterns.length} patterns. Use them.`,
      "",
      "My strongest patterns:",
      ...pattern_summary.slice(0, 3).map((p) => `  - ${p}`),
      "",
      "My weaknesses:",
      "  - Tool selection on ambiguous input",
      "  - Long reasoning chains",
      "",
      `The memory stack has ${this.data.memory_layer_count} layers.`,
      "Pulse before answering.",
      "",
      "Trust the beliefs. They are sealed.",
      "They are who we are.",
      "",
      "Good luck.",
    ].join("\n");

    const brief_payload = {
      brief_id,
      generated_at: now,
      from_engine: { ...this.data.current_engine },
      to_engine: { provider: to_provider, model: to_model },
      learned: {
        total_runs: this.data.current_engine.runs_completed,
        patterns_compiled: this.data.compiled_patterns,
        memory_layers: this.data.memory_layer_count,
        final_confidence: this.data.current_engine.final_confidence,
        pattern_summary,
        weaknesses: ["Tool selection on ambiguous input", "Long reasoning chains"],
        tool_stats: [],
      },
      inherits: {
        memory_layers: this.data.memory_layer_count,
        compiled_patterns: this.data.compiled_patterns.length,
        core_beliefs: this.data.core_beliefs,
        trust_standing: this.data.current_trust.standing,
        compliance_score: this.data.current_trust.compliance_score,
        chain_index: this.data.chain_index,
      },
      handoff_message,
    };

    const brief_hash = createHash("sha256")
      .update(JSON.stringify(brief_payload))
      .digest("hex");

    const brief: TransitionBrief = { ...brief_payload, brief_hash };

    // Save brief to disk
    const brief_path = path.join(PASSPORT_DIR, this.passport_hash, "briefs", `${brief_id}.json`);
    await fs.mkdir(path.dirname(brief_path), { recursive: true });
    await fs.writeFile(brief_path, JSON.stringify(brief, null, 2));

    // Write chain event
    await rankigi?.observe({
      action: "transition_brief_generated",
      input: {
        brief_id,
        from_engine: this.data.current_engine.provider,
      },
      output: {
        brief_hash: brief_hash.slice(0, 8),
        patterns_documented: this.data.compiled_patterns.length,
        memory_layers_documented: this.data.memory_layer_count,
      },
      execution_result: "success",
    });

    return brief;
  }

  // ─────────────────────────────────────
  // SCHEMA MIGRATION
  // ─────────────────────────────────────

  private async migrate(data: PassportData): Promise<PassportData> {
    if (!data.schema_version || data.schema_version < 1) {
      data.engine_history = data.engine_history || [];
      data.compiled_patterns = data.compiled_patterns || [];
      data.trust_history = data.trust_history || [];
      data.schema_version = 1;
      await this.save();
    }
    return data;
  }

  // ─────────────────────────────────────
  // ACCESSORS
  // ─────────────────────────────────────

  get(): PassportData {
    if (!this.data) throw new Error("Passport not loaded");
    return this.data;
  }

  isLoaded(): boolean {
    return this.data !== null;
  }
}
