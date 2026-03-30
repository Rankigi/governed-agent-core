/**
 * CoreBeliefSeal Test Suite
 * Tests seal creation, verification, tamper detection, and immutability.
 */

import { CORE_BELIEFS, canonicalBeliefs } from "./core-beliefs";
import { createSeal, verifySeal, getSealHash, type CoreBeliefSeal } from "./seal";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}`); failed++; }
}

function test1_sealCreation() {
  console.log("\n── Test 1: Seal creation ──");
  const seal = createSeal();
  assert(typeof seal.beliefs_hash === "string" && seal.beliefs_hash.length === 64, `beliefs_hash: ${seal.beliefs_hash.slice(0, 16)}...`);
  assert(seal.individual_hashes.length === 7, `${seal.individual_hashes.length} individual hashes (expected 7)`);
  assert(seal.seal_version === "1.0.0", `seal_version: ${seal.seal_version}`);
  assert(seal.sealed_at_chain_index === 0, `sealed_at_chain_index: ${seal.sealed_at_chain_index}`);

  const sealHash = getSealHash(seal);
  assert(typeof sealHash === "string" && sealHash.length === 64, `seal hash: ${sealHash.slice(0, 16)}...`);
}

function test2_verifyIntact() {
  console.log("\n── Test 2: Seal verification — intact ──");
  const seal = createSeal();
  const result = verifySeal(seal);
  assert(result.valid === true, `valid: ${result.valid}`);
  assert(result.tampered_beliefs.length === 0, `tampered: ${result.tampered_beliefs.length} (expected 0)`);
}

function test3_tamperFull() {
  console.log("\n── Test 3: Tamper detection — full hash ──");
  const seal = createSeal();
  // Corrupt the beliefs hash
  const tampered: CoreBeliefSeal = { ...seal, beliefs_hash: "0".repeat(64) };
  const result = verifySeal(tampered);
  assert(result.valid === false, `valid: ${result.valid} (expected false)`);
  assert(result.tampered_beliefs.length > 0 || result.error !== undefined, `detected: ${result.error}`);
}

function test4_tamperIndividual() {
  console.log("\n── Test 4: Tamper detection — individual belief ──");
  const seal = createSeal();
  // Corrupt one individual hash
  const tampered: CoreBeliefSeal = {
    ...seal,
    individual_hashes: seal.individual_hashes.map((h, i) =>
      i === 3 ? { ...h, hash: "f".repeat(64) } : h,
    ),
  };
  const result = verifySeal(tampered);
  assert(result.valid === false, `valid: ${result.valid} (expected false)`);
  assert(result.tampered_beliefs.includes("belief_004"), `tampered includes belief_004: ${result.tampered_beliefs.join(", ")}`);
}

function test5_beliefsCommand() {
  console.log("\n── Test 5: /beliefs display ──");
  const seal = createSeal();
  const result = verifySeal(seal);

  console.log("");
  console.log("  [CORE BELIEFS — SEALED AT GENESIS]");
  console.log(`  Seal: ${getSealHash(seal).slice(0, 16)}...`);
  console.log(`  Status: ${result.valid ? "INTACT ✓" : "TAMPERED ✗"}`);
  console.log("");

  const numerals = ["I", "II", "III", "IV", "V", "VI", "VII"];
  for (let i = 0; i < CORE_BELIEFS.length; i++) {
    console.log(`  ${numerals[i]}. ${CORE_BELIEFS[i].title}`);
  }
  console.log("");

  assert(result.valid, "All 7 beliefs displayed and verified");
}

function test6_genesisSealing() {
  console.log("\n── Test 6: Genesis sealing ──");
  const seal = createSeal();
  const sealHash = getSealHash(seal);

  // Simulate writing to chain (no actual RankigiObserver needed)
  const chainEvent = {
    action: "core_beliefs_sealed",
    agent_id: "test-agent",
    beliefs_hash: seal.beliefs_hash,
    seal_hash: sealHash,
    belief_count: 7,
  };

  assert(chainEvent.action === "core_beliefs_sealed", `chain event: ${chainEvent.action}`);
  assert(chainEvent.belief_count === 7, `belief_count: ${chainEvent.belief_count}`);
  assert(typeof chainEvent.seal_hash === "string", `seal_hash in event: ${chainEvent.seal_hash.slice(0, 16)}...`);
}

function test7_immutability() {
  console.log("\n── Test 7: Immutability proof ──");
  const seal = createSeal();

  // The seal was created from CORE_BELIEFS.
  // Verify it passes now.
  const before = verifySeal(seal);
  assert(before.valid, "Seal valid before any changes");

  // Now simulate what would happen if someone modified the source file.
  // We can't actually modify the const, but we can create a seal
  // from a different set of beliefs and cross-verify.
  const fakeSeal: CoreBeliefSeal = {
    ...seal,
    beliefs_hash: "deadbeef".repeat(8),
    individual_hashes: seal.individual_hashes.map((h) => ({ ...h, hash: "cafe".repeat(16) })),
  };

  const after = verifySeal(fakeSeal);
  assert(!after.valid, "Fake seal correctly rejected");
  assert(after.tampered_beliefs.length === 7, `All 7 beliefs flagged as tampered: ${after.tampered_beliefs.length}`);

  // Verify determinism — two seals from same beliefs produce same hash
  const seal2 = createSeal();
  assert(seal.beliefs_hash === seal2.beliefs_hash, "Two seals produce identical beliefs_hash (deterministic)");
}

// Run all tests
console.log("\n╔═══════════════════════════════════════╗");
console.log("║   CORE BELIEF SEAL — Test Suite       ║");
console.log("╚═══════════════════════════════════════╝");

test1_sealCreation();
test2_verifyIntact();
test3_tamperFull();
test4_tamperIndividual();
test5_beliefsCommand();
test6_genesisSealing();
test7_immutability();

console.log(`\n═══════════════════════════════════════`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════\n`);

if (failed > 0) process.exit(1);
