# The Calibrated Mind

## Overview

A probability layer between perception and action. The agent doesn't just ask "have I seen this before?" — it asks "what is the probability-weighted best action given everything I know?"

## The 5-Layer Decision Stack

Every significant action passes through five layers before execution:

1. **Confidence floor** — Am I calibrated enough to trust my own predictions? (confidence_in_distribution >= 0.4)
2. **Risk threshold** — Can I survive being wrong? (cost_if_failure <= domain risk limit)
3. **Expected value** — Is the upside worth the risk? (EV > 0)
4. **Novel territory** — Have I seen enough of this domain? (sample_count >= 10)
5. **Subconscious veto** — Does anything feel wrong? (no regime change detected)

All five must pass. Every rejection is a chain event. Every outcome updates the distribution.

## Probability Blending

The predicted probability for an action is a weighted blend of:

- **Base rate** from historical outcomes (weight increases with sample count)
- **Pattern confidence** from the self-model (weight decreases with sample count)

```
predicted = (base_rate × base_weight) + (pattern_confidence × pattern_weight)
base_weight = min(sample_count / 50, 1)
pattern_weight = 1 - base_weight
```

Early: trust patterns. Late: trust data.

## Calibration

The agent tracks predicted probability vs actual outcome:

- **Brier score**: standard calibration metric (lower = better, 0.0 = perfect, 0.25 = random)
- **Calibration error**: |predicted_avg - actual_avg| — < 0.05 is well calibrated, > 0.15 triggers warning
- **Regime change**: when last_10_success_rate diverges > 0.2 from base_rate

## Expected Value Formula

```
EV = (probability × value_if_success) - ((1 - probability) × cost_if_failure)
```

Only positive EV actions proceed past Layer 3.

## The Intelligence Compound

Self-Model (speed) × Calibrated Mind (accuracy) = compound intelligence.

The agent gets faster (compiled patterns skip reasoning) AND more accurate (calibrated predictions reduce errors). Both improve with every governed run. The audit trail IS the training data for both systems.

## Governance Integration

Every EV calculation and every calibration update is a chain event:
- `ev_calculated` — action, domain, probability, EV, decision, confidence
- `outcome_recorded` — predicted vs actual, calibration error
- `calibration_warning` — agent is overconfident/underconfident
- `regime_change_detected` — distribution no longer valid

Auditors can trace exactly how the agent's decision-making evolved.
