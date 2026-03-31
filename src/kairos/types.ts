/**
 * Shared types for KAIROS modules.
 * Re-exports the RankigiObserver interface so kairos/ doesn't import from rankigi.ts directly.
 */

export interface RankigiObserver {
  observe(event: {
    action: string;
    tool?: string;
    input: unknown;
    output: unknown;
    execution_result: "success" | "error";
  }): Promise<void>;

  flush(): Promise<void>;
  getBufferSize(): number;
}
