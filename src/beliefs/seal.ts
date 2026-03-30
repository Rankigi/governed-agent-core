import { createHash } from "crypto";
import { CORE_BELIEFS, canonicalBeliefs } from "./core-beliefs";

export interface CoreBeliefSeal {
  beliefs_hash: string;
  individual_hashes: { belief_id: string; hash: string }[];
  sealed_at: string;
  sealed_at_chain_index: number;
  seal_version: "1.0.0";
}

function hashBelief(belief: { id: string; title: string; text: string }): string {
  return createHash("sha256")
    .update(JSON.stringify({ id: belief.id, title: belief.title, text: belief.text.replace(/\s+/g, " ").trim() }))
    .digest("hex");
}

/** Create a fresh seal from the canonical core beliefs. */
export function createSeal(): CoreBeliefSeal {
  const beliefs_hash = createHash("sha256").update(canonicalBeliefs()).digest("hex");

  const individual_hashes = CORE_BELIEFS.map((b) => ({
    belief_id: b.id,
    hash: hashBelief(b),
  }));

  return {
    beliefs_hash,
    individual_hashes,
    sealed_at: new Date().toISOString(),
    sealed_at_chain_index: 0,
    seal_version: "1.0.0",
  };
}

/** Verify a stored seal against the current core beliefs. */
export function verifySeal(seal: CoreBeliefSeal): {
  valid: boolean;
  tampered_beliefs: string[];
  error?: string;
} {
  const tampered_beliefs: string[] = [];

  // Verify overall hash
  const expected_hash = createHash("sha256").update(canonicalBeliefs()).digest("hex");

  if (seal.beliefs_hash !== expected_hash) {
    // Find which beliefs were tampered
    for (const stored of seal.individual_hashes) {
      const belief = CORE_BELIEFS.find((b) => b.id === stored.belief_id);
      if (!belief) {
        tampered_beliefs.push(stored.belief_id);
        continue;
      }
      if (hashBelief(belief) !== stored.hash) {
        tampered_beliefs.push(stored.belief_id);
      }
    }

    return {
      valid: false,
      tampered_beliefs,
      error: tampered_beliefs.length > 0
        ? `Core beliefs tampered: ${tampered_beliefs.join(", ")}`
        : "Belief hash mismatch — unknown tampering",
    };
  }

  // Verify individual hashes
  for (const stored of seal.individual_hashes) {
    const belief = CORE_BELIEFS.find((b) => b.id === stored.belief_id);
    if (!belief) {
      tampered_beliefs.push(stored.belief_id);
      continue;
    }
    if (hashBelief(belief) !== stored.hash) {
      tampered_beliefs.push(stored.belief_id);
    }
  }

  if (tampered_beliefs.length > 0) {
    return {
      valid: false,
      tampered_beliefs,
      error: `Individual belief tampering detected: ${tampered_beliefs.join(", ")}`,
    };
  }

  return { valid: true, tampered_beliefs: [] };
}

/** Hash the entire seal for passport storage. */
export function getSealHash(seal: CoreBeliefSeal): string {
  return createHash("sha256").update(JSON.stringify(seal)).digest("hex");
}
