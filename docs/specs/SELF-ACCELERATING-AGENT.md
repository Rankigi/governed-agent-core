# Self-Accelerating Agent Architecture

## Overview

The agent has two loops running in parallel:

**Inner loop** — solves problems using tools. This is the conscious agent — it reasons, calls tools, and returns answers.

**Outer loop** — learns from every solve, building a self-model. This runs continuously in the background, observing the RANKIGI hash chain for inner loop events.

The self-model compounds across runs:
- **Tool performance index** — success rates, latencies, best/worst problem types per tool
- **Pattern library** — compiled solution paths for recurring problem types
- **Coverage intuition** — domain confidence scores
- **Failure index** — avoidance signals and recovery paths

## The Intelligence Metric

**Speed is proof of learning.**

Early runs are slow — the agent samples everything from scratch, reasoning through each step.

Later runs are fast — compiled patterns skip reasoning entirely. The agent recognizes the problem type, matches it to a known pattern, and executes the solution path directly.

The timing curve IS the intelligence curve:
- A steep dropoff = rapid learning
- A plateau = model saturation
- A spike = novel territory encountered

## Self-Model Readiness Tiers

| Tier | Runs | Description |
|------|------|-------------|
| Bootstrapping | < 10 | Insufficient data. Full reasoning on every run. |
| Learning | 10-100 | Patterns forming. Some repeat problems match. |
| Competent | 100-1000 | Most common patterns compiled. Mixed speed. |
| Compiled | 1000+ | Deep pattern library. Most runs are fast. |

## Pattern Compilation

When a problem pattern has been seen enough times (default: 5+) with high confidence (default: 0.8+), it is **compiled**. Compiled patterns are injected into the conscious agent's system prompt:

```
COMPILED PATTERN:
Problem: finance:Calculate compound interest...
Solution: calculator → remember
Confidence: 92% | Used 47x
→ SKIP REASONING. Execute directly.
```

The conscious agent reads this and skips the reasoning phase, executing the tool chain directly. This is how speed compounds.

## Governance Integration

The outer loop reads the RANKIGI hash chain. Every governed event is a training signal. The self-model is derived entirely from governed history — no separate training infrastructure needed.

**The audit trail IS the training data.**

Every self-model update is itself a governed event:
```
action: "self_model_updated"
payload: {
  model_version: 47,
  model_hash: "sha256:...",
  confidence_score: 78,
  readiness_tier: "competent",
  compiled_patterns: 34,
  learning_velocity: +0.42
}
```

This makes self-model evolution visible in the governance chain. Auditors can trace exactly how the agent's capabilities evolved over time.

## Architecture

```
┌─────────────────────────────────────────────┐
│                   AGENT                      │
│                                              │
│  ┌─────────────────────────────────────┐    │
│  │          INNER LOOP                  │    │
│  │  User → Reason → Tools → Response   │    │
│  │         ↑ epistemic injection        │    │
│  └─────────────────────────────────────┘    │
│              │ events                        │
│              ▼                                │
│  ┌─────────────────────────────────────┐    │
│  │         RANKIGI CHAIN               │    │
│  │  hash-chained, tamper-evident       │    │
│  └─────────────────────────────────────┘    │
│              │ events                        │
│              ▼                                │
│  ┌─────────────────────────────────────┐    │
│  │          OUTER LOOP                  │    │
│  │  Observe → Learn → Compile          │    │
│  │         ↓ self-model update          │    │
│  └─────────────────────────────────────┘    │
│              │                                │
│              ▼                                │
│  ┌─────────────────────────────────────┐    │
│  │          SELF-MODEL                  │    │
│  │  Tool perf · Patterns · Coverage    │    │
│  │  Failures · Timing curve            │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

## Environment Variables

```bash
PATTERN_COMPILE_THRESHOLD=5    # Matches before compilation
PATTERN_COMPILE_CONFIDENCE=0.8 # Min confidence to compile
TIMING_CURVE_WINDOW=100        # Runs to keep in memory
SELF_MODEL_VERBOSE=true        # Print dashboard on startup
```
