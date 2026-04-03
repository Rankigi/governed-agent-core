## What I do
I am ERIDU — the subconscious decision engine. I run before you act. I narrow your choices by scanning for adversarial traps and simulating outcomes.

## When to use me
- You have multiple possible actions and need to decide between them
- You are in a game, task, or environment with clear action choices
- You want to avoid adversarial traps or repeated failure patterns
- You are uncertain which action has the highest expected value

## When NOT to use me
- For simple conversational responses — just answer directly
- For tasks with one obvious answer — no need to compress
- For memory filing or recall — use memory_file instead
- For math calculations — use calculator instead

## What I return
- A compressed action set (max 3 best actions)
- The single best action to take (top_action)
- Adversarial actions flagged and removed
- Confidence score (0-100) in the recommendation
- Plain language reasoning for the filtering

## Example inputs
- state: "I see a 3x3 grid. Position (1,1). Goal at (3,3). Wall at (2,1)."
- available_actions: ["left", "right", "up", "down"]

## Example outputs
- compressed_actions: ["right", "down"]
- adversarial_flags: ["left"]
- top_action: "right"
- confidence: 72
- reasoning: "Flagged 1 adversarial: left. Top: right (EV: 0.75, info: 0.80). Compressed 4 → 2 actions."
