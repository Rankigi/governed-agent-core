/**
 * Akashic Pulse Memory — MemoryStack
 *
 * Delta-compressed hash-chained layers with resonance index.
 * One pulse finds exactly what the agent needs across all stored memory
 * without loading what it doesn't need.
 *
 * Same hash-chain structure as RANKIGI audit chain — serving dual purpose.
 */

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import type { ResonanceIndex, MemoryLayer, PulseResult } from "./types";

/** Common words excluded from resonance keys */
const STOP_WORDS = [
  "the", "and", "for", "that",
  "this", "with", "from", "have",
  "will", "been", "were", "they",
  "them", "then", "than", "when",
  "what", "which", "into", "your",
  "more", "also", "some", "just",
  "like", "time", "each", "only",
];

interface RankigiRef {
  observe(event: {
    action: string;
    input?: unknown;
    output?: unknown;
    payload?: unknown;
    execution_result: string;
  }): Promise<void>;
}

export class MemoryStack {
  /** Loaded layers — keyed by layer_hash */
  private layers: Map<string, MemoryLayer> = new Map();

  /** All resonance indices — loaded at startup, lightweight, fast */
  private resonance_indices: ResonanceIndex[] = [];

  /** Root of the memory tree */
  private foundation_hash: string | null = null;

  constructor(
    private agent_id: string,
    private storage_path: string,
    private rankigi: RankigiRef | null,
  ) {}

  async initialize(): Promise<void> {
    await this.loadResonanceIndices();

    console.log(
      `[MEMORY] Stack initialized.` +
      ` ${this.resonance_indices.length}` +
      ` layers indexed.` +
      ` Foundation: ${this.foundation_hash?.slice(0, 8) ?? "none"}...`,
    );
  }

  // ─────────────────────────────────────
  // THE PULSE
  // ─────────────────────────────────────

  async pulse(
    query: string,
    options: {
      max_surface?: number;    // Max layers to load (default: 3)
      min_resonance?: number;  // Minimum score to surface (default: 30)
      layer_types?: ResonanceIndex["layer_type"][];
    } = {},
  ): Promise<PulseResult> {
    const start = Date.now();
    const max_surface = options.max_surface ?? 3;
    const min_resonance = options.min_resonance ?? 30;

    // 1. EXTRACT QUERY KEYS
    const query_keys = this.extractKeys(query);

    // 2. BROADCAST ACROSS ALL RESONANCE INDICES
    //    (reads only the index — not the full layer)
    let candidates = this.resonance_indices;
    if (options.layer_types && options.layer_types.length > 0) {
      candidates = candidates.filter((i) =>
        options.layer_types!.includes(i.layer_type),
      );
    }

    const resonant = candidates
      .map((index) => {
        const matched = index.keys.filter((k) =>
          query_keys.some((qk) => k.includes(qk) || qk.includes(k)),
        );

        const score =
          matched.length > 0
            ? Math.min(
                100,
                Math.round(
                  (matched.length /
                    Math.max(query_keys.length, index.keys.length)) *
                    100,
                ),
              )
            : 0;

        return {
          layer_hash: index.layer_hash,
          layer_type: index.layer_type,
          resonance_score: score,
          keys_matched: matched,
          run_index: index.run_index,
        };
      })
      .filter((r) => r.resonance_score >= min_resonance)
      .sort((a, b) => b.resonance_score - a.resonance_score)
      .slice(0, max_surface);

    const pulse_ms = Date.now() - start;

    // 3. SURFACE TOP RESONANT LAYERS
    //    Now we actually load content
    const surfaced: MemoryLayer[] = [];
    for (const r of resonant) {
      const layer = await this.loadLayer(r.layer_hash);
      if (layer) surfaced.push(layer);
    }

    const result: PulseResult = {
      query,
      pulse_ms,
      resonant_layers: resonant,
      surfaced,
      total_layers_pulsed: candidates.length,
      layers_surfaced: surfaced.length,
      compression_ratio:
        surfaced.length > 0 ? this.computeCompression(surfaced) : 1,
    };

    // 4. WRITE CHAIN EVENT
    await this.rankigi?.observe({
      action: "memory_pulse",
      payload: {
        query_keys,
        layers_pulsed: candidates.length,
        layers_resonant: resonant.length,
        layers_surfaced: surfaced.length,
        pulse_ms,
        top_match: resonant[0]?.layer_hash?.slice(0, 8),
        compression_ratio: result.compression_ratio,
      },
      execution_result: "success",
    });

    // 5. LOG
    if (resonant.length > 0) {
      console.log(
        `[PULSE] ${pulse_ms}ms | ` +
        `${candidates.length} layers | ` +
        `${resonant.length} resonant | ` +
        `${surfaced.length} surfaced`,
      );
    }

    return result;
  }

  // ─────────────────────────────────────
  // FILE NEW MEMORY
  // Called by subconscious after every run
  // ─────────────────────────────────────

  async file(
    content: MemoryLayer["content"],
    layer_type: ResonanceIndex["layer_type"],
    parent_hash?: string,
    run_index?: number,
  ): Promise<MemoryLayer> {
    // 1. Extract resonance keys from content automatically
    const keys = this.extractKeys(
      [content.summary, JSON.stringify(content.delta), content.raw_context || ""].join(" "),
    ).slice(0, 50); // Max 50 keys

    // 2. Compute delta from parent
    const parent = parent_hash ? await this.loadLayer(parent_hash) : null;
    const delta = parent ? this.computeDelta(parent.content, content) : content;

    // 3. Build layer
    const content_json = JSON.stringify(content);
    const layer_hash = this.sha256(content_json);

    const index: ResonanceIndex = {
      layer_hash,
      parent_hash: parent_hash || this.foundation_hash || null,
      layer_type,
      created_at: new Date().toISOString(),
      run_index: run_index ?? 0,
      keys,
      content_size_bytes: content_json.length,
      delta_size_bytes: JSON.stringify(delta).length,
      compression_ratio: Math.round(
        (1 - JSON.stringify(delta).length / content_json.length) * 100,
      ),
      child_hashes: [],
    };

    const layer: MemoryLayer = { index, content };

    // 4. Update parent's children
    if (parent_hash) {
      const parentLayer = this.layers.get(parent_hash);
      if (parentLayer) {
        parentLayer.index.child_hashes.push(layer_hash);
      }
      // Also update in the resonance index
      const parentIndex = this.resonance_indices.find(
        (i) => i.layer_hash === parent_hash,
      );
      if (parentIndex) {
        parentIndex.child_hashes.push(layer_hash);
      }
    }

    // 5. Store
    this.layers.set(layer_hash, layer);
    this.resonance_indices.push(index);

    await this.persistLayer(layer);
    await this.persistIndices();

    // 6. Write chain event
    await this.rankigi?.observe({
      action: "memory_filed",
      payload: {
        layer_hash: layer_hash.slice(0, 8),
        layer_type,
        parent_hash: parent_hash?.slice(0, 8),
        keys_indexed: keys.length,
        compression_ratio: index.compression_ratio,
        content_size_bytes: index.content_size_bytes,
        delta_size_bytes: index.delta_size_bytes,
      },
      execution_result: "success",
    });

    console.log(
      `[MEMORY] Filed ${layer_type}.` +
      ` Hash: ${layer_hash.slice(0, 8)}` +
      ` Keys: ${keys.length}` +
      ` Compression: ${index.compression_ratio}%`,
    );

    return layer;
  }

  // ─────────────────────────────────────
  // ACCESSORS
  // ─────────────────────────────────────

  getLayerCount(): number {
    return this.resonance_indices.length;
  }

  getFoundationHash(): string | null {
    return this.foundation_hash;
  }

  getIndexSizeBytes(): number {
    return JSON.stringify(this.resonance_indices).length;
  }

  hasFoundation(): boolean {
    return this.foundation_hash !== null;
  }

  // ─────────────────────────────────────
  // KEY EXTRACTION — simple but effective
  // ─────────────────────────────────────

  extractKeys(text: string): string[] {
    if (!text) return [];

    const words = text
      .toLowerCase()
      .split(/[\s,.\-_:;!?(){}[\]"']+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.includes(w));

    return [...new Set(words)];
  }

  // ─────────────────────────────────────
  // INTERNALS
  // ─────────────────────────────────────

  private sha256(input: string): string {
    return crypto.createHash("sha256").update(input).digest("hex");
  }

  private computeDelta(
    parent: MemoryLayer["content"],
    child: MemoryLayer["content"],
  ): Partial<MemoryLayer["content"]> {
    const delta: Record<string, unknown> = {};
    for (const key of Object.keys(child) as Array<keyof MemoryLayer["content"]>) {
      if (JSON.stringify(child[key]) !== JSON.stringify((parent as Record<string, unknown>)[key])) {
        delta[key] = child[key];
      }
    }
    return delta as Partial<MemoryLayer["content"]>;
  }

  private computeCompression(layers: MemoryLayer[]): number {
    const surfaced_bytes = layers.reduce(
      (sum, l) => sum + l.index.delta_size_bytes,
      0,
    );
    const full_bytes = layers.reduce(
      (sum, l) => sum + l.index.content_size_bytes,
      0,
    );
    return full_bytes > 0 ? Math.round((surfaced_bytes / full_bytes) * 100) : 100;
  }

  private async loadLayer(hash: string): Promise<MemoryLayer | null> {
    if (this.layers.has(hash)) {
      return this.layers.get(hash)!;
    }
    return this.loadLayerFromDisk(hash);
  }

  // ─────────────────────────────────────
  // PERSISTENCE — JSON files on disk
  // One file per layer, one index file
  // ─────────────────────────────────────

  private async persistLayer(layer: MemoryLayer): Promise<void> {
    await fs.mkdir(this.storage_path, { recursive: true });
    await fs.writeFile(
      path.join(this.storage_path, `${layer.index.layer_hash}.json`),
      JSON.stringify(layer, null, 2),
    );
  }

  private async persistIndices(): Promise<void> {
    await fs.mkdir(this.storage_path, { recursive: true });
    await fs.writeFile(
      path.join(this.storage_path, "resonance-index.json"),
      JSON.stringify(this.resonance_indices, null, 2),
    );
  }

  private async loadResonanceIndices(): Promise<void> {
    try {
      const data = await fs.readFile(
        path.join(this.storage_path, "resonance-index.json"),
        "utf-8",
      );
      this.resonance_indices = JSON.parse(data);

      // Find foundation
      const foundation = this.resonance_indices.find((i) => !i.parent_hash);
      if (foundation) {
        this.foundation_hash = foundation.layer_hash;
      }
    } catch {
      // No index yet — fresh start
      this.resonance_indices = [];
    }
  }

  private async loadLayerFromDisk(hash: string): Promise<MemoryLayer | null> {
    try {
      const data = await fs.readFile(
        path.join(this.storage_path, `${hash}.json`),
        "utf-8",
      );
      const layer = JSON.parse(data) as MemoryLayer;
      this.layers.set(hash, layer);
      return layer;
    } catch {
      return null;
    }
  }
}
