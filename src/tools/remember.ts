import { rankigi } from "../rankigi";
import { decideFilingMode, type FilingMode } from "../agent/filing-mode";

/* ── In-memory store (V1 — persistent storage is V2) ────────────────────── */

interface MemoryEntry {
  content: string;
  label: string;
  priority: string;
  mode: FilingMode;
  reason: string;
  stored_at: string;
  access_count: number;
}

const store = new Map<string, MemoryEntry>();
const filingStats = { sync: 0, async: 0, optimistic: 0 };

export function getFilingStats() {
  const total = filingStats.sync + filingStats.async + filingStats.optimistic;
  return {
    ...filingStats,
    total,
    syncPct: total > 0 ? Math.round((filingStats.sync / total) * 100) : 0,
    asyncPct: total > 0 ? Math.round((filingStats.async / total) * 100) : 0,
    optimisticPct: total > 0 ? Math.round((filingStats.optimistic / total) * 100) : 0,
  };
}

export function getHotMemories(n = 3): Array<{ key: string; label: string; accesses: number }> {
  return Array.from(store.entries())
    .sort((a, b) => b[1].access_count - a[1].access_count)
    .slice(0, n)
    .map(([key, entry]) => ({ key, label: entry.label, accesses: entry.access_count }));
}

export function getMemoryCount() {
  return store.size;
}

/* ── The memory_file tool ───────────────────────────────────────────────── */

export const remember = {
  name: "memory_file",
  description:
    "File a memory. Mode is chosen automatically based on content importance, or you can specify: 'sync' = wait for confirmation, 'async' = fire and forget, 'optimistic' = assume stored instantly. User can also say 'remember this' (sync), 'log this' (async), or 'fyi:' (optimistic). Use operation 'get' to recall a stored memory.",
  parameters: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["set", "get"],
        description: "Whether to file (set) or recall (get) a memory",
      },
      content: {
        type: "string",
        description: "The content to remember (for set operation)",
      },
      label: {
        type: "string",
        description: "Short label, max 10 words (for set operation)",
      },
      key: {
        type: "string",
        description: "The key to recall (for get operation)",
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Priority level",
      },
      address_hint: {
        type: "string",
        description: "Optional hint for where this memory should be stored",
      },
      mode: {
        type: "string",
        enum: ["sync", "async", "optimistic", "auto"],
        description: "Filing mode: sync (wait), async (background), optimistic (instant), auto (decide based on content)",
      },
      user_message: {
        type: "string",
        description: "The triggering user message, for mode inference",
      },
    },
    required: ["operation"],
  },

  async execute(args: {
    operation: string;
    content?: string;
    label?: string;
    key?: string;
    priority?: string;
    address_hint?: string;
    mode?: string;
    user_message?: string;
  }): Promise<string> {
    return rankigi.wrap("memory_file", async () => {
      /* ── GET operation ── */
      if (args.operation === "get") {
        const key = args.key ?? args.label ?? "";
        const entry = store.get(key);
        if (entry) {
          entry.access_count++;
          return `Recalled: "${entry.label}" = "${entry.content}" (priority: ${entry.priority}, filed: ${entry.mode})`;
        }
        // Fuzzy search by label
        for (const [k, v] of store) {
          if (v.label.toLowerCase().includes(key.toLowerCase()) || k.toLowerCase().includes(key.toLowerCase())) {
            v.access_count++;
            return `Recalled: "${v.label}" = "${v.content}" (key: ${k})`;
          }
        }
        return `No memory found for "${key}"`;
      }

      /* ── SET operation ── */
      const content = args.content ?? "";
      const label = args.label ?? content.slice(0, 40);
      const priority = args.priority ?? "medium";

      // Decide filing mode
      const requestedMode = (args.mode ?? "auto") as string;
      const decision =
        requestedMode === "auto"
          ? decideFilingMode(content, args.user_message, process.env.MEMORY_FILE_MODE)
          : { mode: requestedMode as "sync" | "async" | "optimistic", reason: "explicit_tool_param", confidence: 1.0 };

      // Log the decision
      console.log(
        `[MEMORY] Filing "${label}" | mode: ${decision.mode} | reason: ${decision.reason} | confidence: ${decision.confidence}`,
      );

      // Track stats
      filingStats[decision.mode]++;

      // Store the memory
      const addressKey = args.address_hint ?? label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
      store.set(addressKey, {
        content,
        label,
        priority,
        mode: decision.mode,
        reason: decision.reason,
        stored_at: new Date().toISOString(),
        access_count: 0,
      });

      // Write to chain
      await rankigi.observe({
        action: "memory_file_request",
        input: {
          content_hash: content.length > 100 ? `${content.slice(0, 50)}...` : content,
          label,
          priority,
          address_hint: args.address_hint,
          mode: decision.mode,
          filing_reason: decision.reason,
        },
        output: { address_key: addressKey },
        execution_result: "success",
      });

      // Return based on mode
      if (decision.mode === "async") {
        return `Memory queued for filing: "${label}" (async)`;
      }

      if (decision.mode === "optimistic") {
        return `Memory noted: "${label}" (optimistic)`;
      }

      // sync — confirm immediately (in V1, storage is in-memory so always instant)
      return `Memory filed at "${addressKey}" — "${label}" (sync confirmed, priority: ${priority})`;
    });
  },
};
