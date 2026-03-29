/* ── Filing Mode Intelligence ──────────────────────────────────────────────
   Decides how memories should be filed: sync, async, or optimistic.
   User commands always override. Content analysis fills the gap.
   ────────────────────────────────────────────────────────────────────────── */

export type FilingMode = "sync" | "async" | "optimistic";

export interface FilingDecision {
  mode: FilingMode;
  reason: string;
  confidence: number;
}

/* ── User command patterns ──────────────────────────────────────────────── */

const SYNC_PATTERNS = [
  "remember this", "remember that", "make sure you remember",
  "don't forget", "dont forget", "confirm you stored",
  "wait until stored", "important:", "critical:",
  "must remember", "make note of this",
];

const ASYNC_PATTERNS = [
  "log that", "log this", "file that away", "file this away",
  "note that for later", "note this for later", "save that",
  "background:", "for the record:", "archive this",
];

const OPTIMISTIC_PATTERNS = [
  "quick note:", "fyi:", "fyi,", "btw:", "btw,",
  "just so you know", "just a note", "passing thought:", "roughly:",
];

function checkUserCommand(message: string): FilingDecision | null {
  const lower = message.toLowerCase().trim();

  for (const pat of SYNC_PATTERNS) {
    if (lower.includes(pat)) {
      return { mode: "sync", reason: "user_explicit_sync", confidence: 1.0 };
    }
  }

  for (const pat of ASYNC_PATTERNS) {
    if (lower.includes(pat)) {
      return { mode: "async", reason: "user_explicit_async", confidence: 1.0 };
    }
  }

  for (const pat of OPTIMISTIC_PATTERNS) {
    if (lower.includes(pat)) {
      return { mode: "optimistic", reason: "user_explicit_optimistic", confidence: 1.0 };
    }
  }

  return null;
}

/* ── Content analysis ───────────────────────────────────────────────────── */

const CRITICAL_AMOUNT = /\$[\d,]+/;
const CRITICAL_PERCENT = /\d+%/;
const CRITICAL_COUNT = /\d+\s+(tokens|users|agents|calls|events|actions)/i;
const CRITICAL_TIME = /\d{1,2}:\d{2}/;
const CRITICAL_DAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const CRITICAL_MONTH = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;

const DECISION_WORDS = [
  "decided", "agreed", "confirmed", "approved", "rejected",
  "violated", "failed", "succeeded", "completed",
];

const GOVERNANCE_WORDS = [
  "policy", "violation", "passport", "hash", "chain", "governed",
];

const BACKGROUND_STARTS = [
  "generally", "usually", "typically", "in most cases",
  "as a rule", "by default", "normally",
];

const SOFT_OBSERVATIONS = [
  "seems like", "appears to be", "might be", "could be", "probably",
];

function analyzeContent(content: string): FilingDecision | null {
  const lower = content.toLowerCase();

  // Critical signals → sync
  if (
    CRITICAL_AMOUNT.test(content) ||
    CRITICAL_PERCENT.test(content) ||
    CRITICAL_COUNT.test(content) ||
    CRITICAL_TIME.test(content) ||
    CRITICAL_DAY.test(content) ||
    CRITICAL_MONTH.test(content)
  ) {
    return { mode: "sync", reason: "critical_content", confidence: 0.85 };
  }

  // Check for proper names (capitalized words not at start of sentence)
  const words = content.split(/\s+/);
  const properNames = words.filter((w, i) => i > 0 && /^[A-Z][a-z]+$/.test(w));
  if (properNames.length >= 2) {
    return { mode: "sync", reason: "critical_content", confidence: 0.80 };
  }

  if (DECISION_WORDS.some((w) => lower.includes(w))) {
    return { mode: "sync", reason: "critical_content", confidence: 0.85 };
  }

  if (GOVERNANCE_WORDS.some((w) => lower.includes(w))) {
    return { mode: "sync", reason: "critical_content", confidence: 0.80 };
  }

  // Background signals → async
  if (BACKGROUND_STARTS.some((s) => lower.startsWith(s))) {
    return { mode: "async", reason: "background_content", confidence: 0.75 };
  }

  if (SOFT_OBSERVATIONS.some((s) => lower.includes(s))) {
    return { mode: "async", reason: "background_content", confidence: 0.70 };
  }

  if (content.length > 200) {
    return { mode: "async", reason: "background_content", confidence: 0.65 };
  }

  // Optimistic signals → very short or metadata-like
  if (content.length < 30) {
    return { mode: "optimistic", reason: "low_priority", confidence: 0.70 };
  }

  const metadataPatterns = ["session started", "tool called", "step completed"];
  if (metadataPatterns.some((p) => lower.includes(p))) {
    return { mode: "optimistic", reason: "low_priority", confidence: 0.75 };
  }

  return null;
}

/* ── Main decision function ─────────────────────────────────────────────── */

export function decideFilingMode(
  content: string,
  userMessage?: string,
  envDefault?: string,
): FilingDecision {
  // 1. User message overrides everything
  if (userMessage) {
    const userDecision = checkUserCommand(userMessage);
    if (userDecision) return userDecision;
  }

  // 2. Content analysis
  const contentDecision = analyzeContent(content);
  if (contentDecision) return contentDecision;

  // 3. Fall back to env default
  const fallback = (envDefault as FilingMode) ?? "async";
  return { mode: fallback, reason: "default_mode", confidence: 0.50 };
}
