import { decideFilingMode } from "./filing-mode";

interface TestCase {
  name: string;
  content: string;
  user_message?: string;
  expected_mode: string;
}

const tests: TestCase[] = [
  {
    name: "Test 1 — Critical content (auto → sync)",
    content: "Customer budget confirmed: $50,000",
    expected_mode: "sync",
  },
  {
    name: "Test 2 — User explicit sync",
    content: "Policy violation at 11:23 PM",
    user_message: "remember this",
    expected_mode: "sync",
  },
  {
    name: "Test 3 — Background content (auto → async)",
    content: "Generally the agent tends to use web search for most queries and prefers concise responses over verbose explanations when possible",
    expected_mode: "async",
  },
  {
    name: "Test 4 — User explicit async",
    content: "Web search returned 3 results",
    user_message: "log that",
    expected_mode: "async",
  },
  {
    name: "Test 5 — User explicit optimistic",
    content: "step 3 completed",
    user_message: "fyi:",
    expected_mode: "optimistic",
  },
  {
    name: "Test 6 — Auto optimistic (short content)",
    content: "ok",
    expected_mode: "optimistic",
  },
  {
    name: "Test 7 — Decision language → sync",
    content: "The team decided to proceed with the migration",
    expected_mode: "sync",
  },
  {
    name: "Test 8 — Governance signals → sync",
    content: "Agent passport was revoked due to policy violation",
    expected_mode: "sync",
  },
  {
    name: "Test 9 — Soft observation → async",
    content: "It seems like the agent might be running slower than usual today",
    expected_mode: "async",
  },
  {
    name: "Test 10 — Date → sync",
    content: "Meeting scheduled for next Tuesday afternoon",
    expected_mode: "sync",
  },
];

console.log("\n  FILING MODE TESTS");
console.log("  " + "═".repeat(60));

let passed = 0;
let failed = 0;

for (const test of tests) {
  const result = decideFilingMode(test.content, test.user_message);
  const ok = result.mode === test.expected_mode;

  if (ok) passed++;
  else failed++;

  console.log(`\n  ${ok ? "PASS" : "FAIL"} ${test.name}`);
  console.log(`    Content: "${test.content.slice(0, 60)}${test.content.length > 60 ? "..." : ""}"`);
  if (test.user_message) console.log(`    User: "${test.user_message}"`);
  console.log(`    Detected: ${result.mode} | Expected: ${test.expected_mode} | Reason: ${result.reason} | Confidence: ${result.confidence}`);
}

console.log("\n  " + "═".repeat(60));
console.log(`  Results: ${passed} passed, ${failed} failed out of ${tests.length}`);
console.log("");

process.exit(failed > 0 ? 1 : 0);
