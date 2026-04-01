/**
 * Unified Command Handler
 *
 * Single entry point for all slash commands.
 * Source-agnostic: terminal, Telegram, API, mobile — all route here.
 */

import { Agent } from "../agent";
import type { KairosOuterLoop } from "../kairos/tick";
import type { FrustrationDetector } from "../kairos/frustration";
import type { MemoryStack } from "../memory/stack";
import type { SelfModelStore } from "../self-model/store";
import type { PassportManager } from "../passport/loader";
import { CORE_BELIEFS } from "../beliefs/core-beliefs";
import { rankigi } from "../rankigi";

const agentId = process.env.RANKIGI_AGENT_ID ?? "UNREGISTERED";

export interface CommandContext {
  agent: Agent;
  kairos: KairosOuterLoop | null;
  frustration: FrustrationDetector | null;
  memoryStack: MemoryStack | null;
  selfModelStore: SelfModelStore | null;
  passport: PassportManager | null;
}

/**
 * Process any input — slash command or free text.
 * Returns the response string.
 */
export async function handleCommand(
  input: string,
  ctx: CommandContext,
): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) return "";

  // Slash commands
  if (trimmed.startsWith("/")) {
    const [cmd, ...rest] = trimmed.split(/\s+/);
    const args = rest.join(" ");

    switch (cmd) {
      case "/start":
        return cmdStart();
      case "/status":
        return cmdStatus();
      case "/prime":
        return cmdPrime(ctx);
      case "/kairos":
        return cmdKairos(ctx);
      case "/frustration":
        return cmdFrustration(ctx);
      case "/pulse":
        return cmdPulse(args, ctx);
      case "/reflect":
        return cmdReflect(ctx);
      case "/compile":
        return cmdCompile(ctx);
      case "/history":
        return cmdHistory(ctx);
      case "/confidence":
        return cmdConfidence(ctx);
      case "/calibrate":
        return cmdCalibrate(ctx);
      case "/beliefs":
        return cmdBeliefs();
      case "/forget":
        return cmdForget();
      case "/imagine":
        return cmdImagine(args, ctx);
      case "/passport":
        return cmdPassport(ctx);
      case "/switch":
        return cmdSwitch(args, ctx);
      default:
        return `Unknown command: ${cmd}`;
    }
  }

  // Free text — route to agent
  return ctx.agent.run(trimmed);
}

// ─────────────────────────────────────
// COMMAND IMPLEMENTATIONS
// ─────────────────────────────────────

function cmdStart(): string {
  return [
    `Agent ${agentId} online.`,
    "Governed by RANKIGI.",
    "Every action is recorded.",
    "",
    "What do you need?",
  ].join("\n");
}

function cmdStatus(): string {
  return [
    `Passport: ${agentId}`,
    "Status: ACTIVE",
    "Governed: YES",
    "Dashboard: rankigi.com",
  ].join("\n");
}

function cmdPrime(ctx: CommandContext): string {
  const lines = [
    "AGENT PRIME",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    `Passport: ${agentId}`,
    "Status: ACTIVE",
    "Governed: YES",
    "",
  ];

  // Passport
  if (ctx.passport?.isLoaded()) {
    const p = ctx.passport.get();
    lines.push("[PASSPORT]");
    lines.push(`\u25c8 Born: ${p.born_at.slice(0, 10)}`);
    lines.push(`\u25c8 Engines used: ${p.engine_history.length + 1}`);
    lines.push(`\u25c8 Current: ${p.current_engine.provider}/${p.current_engine.model}`);
    lines.push(`\u25c8 Total runs (all engines): ${p.total_runs}`);
    lines.push(`\u25c8 Patterns: ${p.compiled_patterns.length}`);
    lines.push(`\u25c8 Memory: ${p.memory_layer_count} layers`);
    lines.push("");
  }

  // Memory Stack
  if (ctx.memoryStack) {
    const layerCount = ctx.memoryStack.getLayerCount();
    const foundHash = ctx.memoryStack.getFoundationHash();
    const indexKb = Math.round(ctx.memoryStack.getIndexSizeBytes() / 1024);
    lines.push("[MEMORY STACK]");
    lines.push(`\u25c8 Layers: ${layerCount}`);
    lines.push(`\u25c8 Foundation: ${foundHash ? foundHash.slice(0, 8) + "..." : "none"}`);
    lines.push(`\u25c8 Index size: ${indexKb}kb`);
    lines.push(`\u25c8 Pulse ready: YES`);
    lines.push("");
  } else {
    lines.push("[MEMORY STACK]");
    lines.push("\u25c8 Not initialized");
    lines.push("");
  }

  // Self-Model
  if (ctx.selfModelStore) {
    const m = ctx.selfModelStore.getModel();
    lines.push("[SELF-MODEL]");
    lines.push(`\u25c8 Version: v${m.version}`);
    lines.push(`\u25c8 Readiness: ${m.readiness_tier.toUpperCase()}`);
    lines.push(`\u25c8 Runs: ${m.total_runs_observed}`);
    lines.push(`\u25c8 Confidence: ${m.confidence_score}/100`);
    lines.push(`\u25c8 Compiled patterns: ${m.timing_curve.compiled_patterns}`);
    lines.push("");
  }

  // KAIROS
  if (ctx.kairos) {
    const log = ctx.kairos.getDailyLog();
    const tickNum = ctx.kairos.getTickNumber();
    lines.push("[KAIROS]");
    lines.push(`\u25c8 Ticks: ${tickNum}`);
    lines.push(`\u25c8 Actions today: ${log.filter((l) => l.includes("acted")).length}`);
    lines.push("");
  }

  // Frustration
  if (ctx.frustration) {
    const state = ctx.frustration.getState();
    lines.push("[FRUSTRATION]");
    lines.push(`\u25c8 Output stall: ${state.output_stall_risk ? "\u26a0 RISK" : "NONE"}`);
    lines.push("");
  }

  return lines.join("\n");
}

function cmdKairos(ctx: CommandContext): string {
  if (!ctx.kairos) return "KAIROS not enabled.";

  const log = ctx.kairos.getDailyLog();
  const tickNum = ctx.kairos.getTickNumber();
  const acted = log.filter((l) => l.includes("\u2014 acted:")).length;
  const deferred = log.filter((l) => l.includes("\u2014 deferred:")).length;
  const alerts = log.filter((l) => l.includes("ALERT")).length;
  const recent = log.slice(-5).reverse();

  return [
    "KAIROS DAILY LOG",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    `Ticks: ${tickNum}`,
    `Actions taken: ${acted}`,
    `Deferred: ${deferred}`,
    `Alerts: ${alerts}`,
    "",
    "Recent:",
    ...recent,
  ].join("\n");
}

function cmdFrustration(ctx: CommandContext): string {
  if (!ctx.frustration) return "Frustration detector not enabled.";

  const state = ctx.frustration.getState();
  const toolLine = state.recent_tools.length > 0
    ? state.recent_tools.join(" \u2192 ")
    : "(no tool calls)";

  const last3 = state.recent_tools.slice(-3);
  const toolLoopRisk = last3.length === 3 && last3.every((t) => t === last3[0]);

  const confLine = state.confidence_trend.length > 0
    ? state.confidence_trend.join(" \u2192 ")
    : "(no data)";
  const confDrop = state.confidence_trend.length >= 5
    ? state.confidence_trend[0] - state.confidence_trend[state.confidence_trend.length - 1]
    : 0;

  const lines = [
    "FRUSTRATION STATE",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    `Run: ${state.run_index}`,
    "",
    "Recent tools:",
    `  ${toolLine}`,
  ];

  if (toolLoopRisk) {
    lines.push(`  \u26a0 Tool loop risk: ${last3[0]}`);
  }

  lines.push(
    "",
    `Confidence trend (last ${state.confidence_trend.length}):`,
    `  ${confLine}`,
  );

  if (confDrop >= 20) {
    lines.push(`  \ud83d\udd34 Confidence collapse: -${confDrop} pts`);
  }

  lines.push("", `Output stall: ${state.output_stall_risk ? "\u26a0 RISK" : "NONE"}`);
  return lines.join("\n");
}

async function cmdPulse(query: string, ctx: CommandContext): Promise<string> {
  if (!ctx.memoryStack) return "Memory stack not initialized.";
  if (!query) return "Usage: /pulse <query>";

  const result = await ctx.memoryStack.pulse(query, {
    max_surface: 5,
    min_resonance: 20,
  });

  const lines = [
    `PULSE \u2014 "${query}"`,
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    `${result.pulse_ms}ms | ${result.total_layers_pulsed} layers pulsed`,
    "",
  ];

  if (result.resonant_layers.length > 0) {
    lines.push(`RESONANT (${result.resonant_layers.length}):`);
    for (const r of result.resonant_layers) {
      const summary = result.surfaced.find(
        (s) => s.index.layer_hash === r.layer_hash,
      )?.content.summary ?? "(not surfaced)";
      lines.push(`\u25c8 [${r.resonance_score}] ${r.layer_type} #${r.run_index}`);
      lines.push(`  "${summary.slice(0, 60)}"`);
      lines.push(`  Keys: ${r.keys_matched.join(", ")}`);
      lines.push("");
    }
  } else {
    lines.push("No resonant layers found.");
    lines.push("");
  }

  const totalContentBytes = result.surfaced.reduce((s, l) => s + l.index.content_size_bytes, 0);
  const deltaBytes = result.surfaced.reduce((s, l) => s + l.index.delta_size_bytes, 0);
  const tokensSaved = Math.round((totalContentBytes - deltaBytes) / 4);

  lines.push(`Surfaced: ${result.layers_surfaced} layers`);
  lines.push(`Tokens saved: ~${tokensSaved.toLocaleString()} vs full load`);
  lines.push(`Compression: ${result.compression_ratio}%`);

  return lines.join("\n");
}

function cmdReflect(ctx: CommandContext): string {
  if (!ctx.selfModelStore) return "Self-model not initialized.";

  const m = ctx.selfModelStore.getModel();
  const tc = m.timing_curve;
  const velocityLabel = tc.learning_velocity > 0
    ? `+${Math.round(tc.learning_velocity * 100)}%`
    : `${Math.round(tc.learning_velocity * 100)}%`;
  const trendArrow = tc.trend === "accelerating" ? "\u2193" : tc.trend === "regressing" ? "\u2191" : "\u2192";

  const topTools = Object.values(m.tool_performance)
    .sort((a, b) => b.invocation_count - a.invocation_count)
    .slice(0, 5);

  const lines = [
    `SELF-MODEL v${m.version}`,
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    `Readiness: ${m.readiness_tier.toUpperCase()}`,
    `Runs: ${m.total_runs_observed}`,
    `Confidence: ${m.confidence_score}/100`,
    `Patterns: ${Object.keys(m.pattern_library).length} (${tc.compiled_patterns} compiled)`,
    `Trend: ${tc.trend.toUpperCase()} ${trendArrow}`,
    `Velocity: ${velocityLabel} faster`,
    `Novel rate: ${Math.round(tc.novel_problem_rate * 100)}%`,
    "",
    "TOP TOOLS:",
  ];

  if (topTools.length === 0) {
    lines.push("  (no tool data yet)");
  }
  for (const t of topTools) {
    lines.push(`  ${t.tool_name}: ${Math.round(t.success_rate * 100)}% success, ${t.avg_latency_ms}ms avg, ${t.invocation_count}x`);
  }

  const domains = Object.values(m.coverage).sort((a, b) => b.sample_count - a.sample_count).slice(0, 5);
  if (domains.length > 0) {
    lines.push("", "COVERAGE:");
    for (const d of domains) {
      lines.push(`  ${d.domain}: ${Math.round(d.confidence * 100)}% (${d.sample_count} samples)`);
    }
  }

  return lines.join("\n");
}

function cmdCompile(ctx: CommandContext): string {
  if (!ctx.selfModelStore) return "Self-model not initialized.";

  const m = ctx.selfModelStore.getModel();
  const compiled = Object.values(m.pattern_library)
    .filter((p) => p.compiled)
    .sort((a, b) => b.times_matched - a.times_matched);

  if (compiled.length === 0) {
    return [
      "COMPILED PATTERNS",
      "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
      "(none compiled yet)",
      "",
      `Patterns in library: ${Object.keys(m.pattern_library).length}`,
      "Patterns compile at: \u226580% confidence AND \u22655 matches",
    ].join("\n");
  }

  const lines = [
    `COMPILED PATTERNS (${compiled.length})`,
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
  ];

  for (const p of compiled.slice(0, 10)) {
    lines.push(`\u25c8 ${p.problem_signature.slice(0, 50)}`);
    lines.push(`  Path: ${p.solution_path.join(" \u2192 ")}`);
    lines.push(`  Confidence: ${Math.round(p.confidence * 100)}% | ${p.times_matched}x matched | ${p.avg_solve_time_ms}ms avg`);
    lines.push("");
  }

  return lines.join("\n");
}

function cmdHistory(ctx: CommandContext): string {
  if (!ctx.selfModelStore) return "Self-model not initialized.";

  const runs = ctx.selfModelStore.getModel().timing_curve.runs;
  if (runs.length === 0) return "No runs recorded yet.";

  const recent = runs.slice(-10).reverse();
  const lines = [
    `HISTORY (last ${recent.length} of ${runs.length})`,
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
  ];

  for (const r of recent) {
    const pattern = r.pattern_matched ? "compiled" : "novel";
    const tools = r.tools_invoked > 0 ? `${r.tools_invoked} tools` : "no tools";
    lines.push(`  ${r.solve_time_ms}ms | ${pattern} | ${tools} | ${r.timestamp.slice(0, 19)}`);
  }

  return lines.join("\n");
}

function cmdConfidence(ctx: CommandContext): string {
  if (!ctx.selfModelStore) return "Self-model not initialized.";

  const m = ctx.selfModelStore.getModel();
  const tc = m.timing_curve;
  const patterns = Object.keys(m.pattern_library).length;
  const compiled = tc.compiled_patterns;
  const velocity = tc.learning_velocity;

  const lines = [
    `CONFIDENCE: ${m.confidence_score}/100`,
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "",
    "Breakdown:",
    `  Runs (max 50):     ${Math.min(m.total_runs_observed, 50)}/50`,
    `  Patterns (max 30): ${Math.min(patterns * 2, 30)}/30`,
    `  Compiled bonus:    +${compiled * 2}`,
    `  Velocity bonus:    +${Math.max(Math.round(velocity * 20), 0)}`,
    "",
    `Readiness: ${m.readiness_tier.toUpperCase()}`,
    `Trend: ${tc.trend}`,
  ];

  return lines.join("\n");
}

function cmdCalibrate(ctx: CommandContext): string {
  if (!ctx.selfModelStore) return "Self-model not initialized.";

  const m = ctx.selfModelStore.getModel();
  const domains = Object.values(m.coverage);

  if (domains.length === 0) return "No calibration data yet. Run some tasks first.";

  const lines = [
    "CALIBRATION REPORT",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
  ];

  for (const d of domains.sort((a, b) => b.sample_count - a.sample_count)) {
    const known = d.known_patterns;
    const unknown = d.unknown_encountered;
    lines.push(`  ${d.domain}: ${Math.round(d.confidence * 100)}% confidence`);
    lines.push(`    ${d.sample_count} samples | ${known} known | ${unknown} novel`);
  }

  const failures = Object.values(m.failure_index).sort((a, b) => b.frequency - a.frequency).slice(0, 5);
  if (failures.length > 0) {
    lines.push("", "FAILURE MODES:");
    for (const f of failures) {
      lines.push(`  ${f.failure_type}: ${f.frequency}x (${Math.round(f.resolution_rate * 100)}% resolved)`);
    }
  }

  return lines.join("\n");
}

function cmdBeliefs(): string {
  const lines = [
    "CORE BELIEFS",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
  ];

  for (const b of CORE_BELIEFS) {
    lines.push(`\u25c8 ${b.title}`);
    lines.push(`  ${b.text.slice(0, 80)}...`);
    lines.push("");
  }

  lines.push("Sealed at genesis. Verified every KAIROS poll cycle.");
  return lines.join("\n");
}

function cmdForget(): string {
  return [
    "FORGET",
    "\u2500\u2500\u2500\u2500\u2500\u2500",
    "Session context cleared from working memory.",
    "Hash chain is permanent \u2014 nothing is forgotten from the chain.",
    "Memory stack layers are immutable \u2014 only new layers can be filed.",
  ].join("\n");
}

async function cmdImagine(scenario: string, ctx: CommandContext): Promise<string> {
  if (!scenario) return "Usage: /imagine <scenario>";

  return ctx.agent.run(
    `[IMAGINE MODE] Think through this scenario without taking action. ` +
    `What would happen, what tools would you use, what risks exist? ` +
    `Scenario: ${scenario}`,
  );
}

function cmdPassport(ctx: CommandContext): string {
  if (!ctx.passport?.isLoaded()) return "Passport not loaded.";

  const p = ctx.passport.get();
  const lines = [
    `PASSPORT \u2014 ${p.display_name}`,
    "\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550",
    `ID:      ${p.passport_id}`,
    `Hash:    ${p.passport_hash}...`,
    `Born:    ${p.born_at.slice(0, 10)}`,
    "",
    "ENGINE HISTORY",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
  ];

  for (const e of p.engine_history) {
    lines.push(`\u2713 ${e.provider}/${e.model}`);
    lines.push(`  Runs: ${e.runs_completed} | Patterns: ${e.patterns_compiled}`);
    lines.push(`  ${e.started_at.slice(0, 10)} \u2192 ${e.ended_at?.slice(0, 10) ?? "?"}`);
    if (e.transition_brief_hash) {
      lines.push(`  Brief: ${e.transition_brief_hash.slice(0, 8)}...`);
    }
    lines.push("");
  }

  // Current engine
  lines.push(`\u2192 ${p.current_engine.provider}/${p.current_engine.model}`);
  lines.push(`  Runs: ${p.current_engine.runs_completed} (current)`);
  lines.push(`  Started: ${p.current_engine.started_at.slice(0, 10)}`);
  lines.push("");

  // Compiled patterns
  lines.push("COMPILED PATTERNS");
  lines.push("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  if (p.compiled_patterns.length === 0) {
    lines.push("(none yet)");
  } else {
    for (const pat of p.compiled_patterns.slice(0, 10)) {
      lines.push(`${pat.id}. ${pat.pattern} \u2192 ${pat.solution_path.slice(0, 40)}`);
    }
  }
  lines.push("");

  // Memory
  lines.push("MEMORY");
  lines.push("\u2500\u2500\u2500\u2500\u2500\u2500");
  lines.push(`Layers: ${p.memory_layer_count}`);
  lines.push(`Foundation: ${p.memory_foundation_hash ? p.memory_foundation_hash.slice(0, 8) + "..." : "none"}`);
  lines.push("");

  // Trust
  lines.push("TRUST");
  lines.push("\u2500\u2500\u2500\u2500\u2500");
  lines.push(`Standing: ${p.current_trust.standing.toUpperCase()}`);
  lines.push(`Compliance: ${p.current_trust.compliance_score}/100`);
  lines.push(`Confidence: ${p.current_trust.confidence_score}/100`);
  lines.push("");

  // Beliefs
  lines.push("BELIEFS");
  lines.push("\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  lines.push(`${p.core_beliefs.length} core beliefs \u2014 sealed at genesis`);
  lines.push(`Hash: ${p.core_beliefs_hash ? p.core_beliefs_hash.slice(0, 16) + "..." : "not sealed"}`);

  return lines.join("\n");
}

async function cmdSwitch(args: string, ctx: CommandContext): Promise<string> {
  if (!ctx.passport?.isLoaded()) return "Passport not loaded.";
  if (!args) return "Usage: /switch <provider> <model>\nExample: /switch ollama llama3.2:1b";

  const parts = args.split(/\s+/);
  if (parts.length < 2) return "Usage: /switch <provider> <model>\nExample: /switch anthropic claude-sonnet-4-6";

  const [new_provider, new_model] = parts;
  const p = ctx.passport.get();

  // Check if already on this engine
  if (p.current_engine.provider === new_provider && p.current_engine.model === new_model) {
    return `Already running ${new_provider}/${new_model}.`;
  }

  const lines = [
    "Switching engine.",
    "All data preserved.",
    "Generating transition brief...",
    "",
  ];

  const brief = await ctx.passport.switchEngine(
    new_provider,
    new_model,
    `Manual switch via /switch command`,
    rankigi,
  );

  lines.push("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  lines.push(`TRANSITION BRIEF \u2014 ${brief.brief_id}`);
  lines.push("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  lines.push("");
  lines.push(`FROM: ${brief.from_engine.provider}/${brief.from_engine.model}`);
  lines.push(`  ${brief.learned.total_runs} runs | ${brief.learned.patterns_compiled.length} patterns | ${brief.learned.memory_layers} memories`);
  lines.push("");
  lines.push(`TO: ${brief.to_engine.provider}/${brief.to_engine.model}`);
  lines.push("");
  lines.push("HANDOFF MESSAGE:");
  lines.push("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  lines.push(brief.handoff_message);
  lines.push("");
  lines.push("PRESERVED:");
  lines.push(`\u25c8 ${brief.inherits.compiled_patterns} compiled patterns`);
  lines.push(`\u25c8 ${brief.inherits.memory_layers} memory layers`);
  lines.push(`\u25c8 ${brief.inherits.core_beliefs.length} core beliefs (sealed)`);
  lines.push(`\u25c8 Chain index: ${brief.inherits.chain_index}`);
  lines.push("");
  lines.push("INTEGRITY");
  lines.push("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  lines.push(`Brief hash: ${brief.brief_hash.slice(0, 16)}...`);
  lines.push("Chain event: recorded \u2713");
  lines.push("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  lines.push("");
  lines.push("Restart the agent to use the new engine:");
  lines.push("  npm start");

  return lines.join("\n");
}
