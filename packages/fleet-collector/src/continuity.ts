import type { HistoryEntry } from "./sparkdash.js";

/** The newest history entry already turned into events. */
export interface Cursor {
  id: number;
  key: string;
  status: "firing" | "resolved";
  at: number;
}

export type Continuity =
  /** The Collector has no cursor yet: everything held is new. */
  | { kind: "first"; entries: HistoryEntry[] }
  | { kind: "none"; entries: [] }
  | { kind: "contiguous"; entries: HistoryEntry[] }
  /** More than 200 transitions since the last poll: `collector_gap`. */
  | { kind: "gap"; entries: HistoryEntry[] }
  /** sparkDash restarted: `sparkdash_restarted`, and `collector_gap` too when history does not start at id 1. */
  | { kind: "restart"; entries: HistoryEntry[]; gap: boolean };

function same(entry: HistoryEntry | undefined, cursor: Cursor): boolean {
  return (
    entry !== undefined &&
    entry.key === cursor.key &&
    entry.status === cursor.status &&
    entry.at === cursor.at
  );
}

/**
 * The continuity rules (fleet monitoring spec, "Each poll", step 4), on
 * sparkDash's history oldest first. Returns the entries to turn into events,
 * oldest first.
 */
export function continuity(cursor: Cursor | null, recent: HistoryEntry[]): Continuity {
  if (cursor === null) return { kind: "first", entries: recent };
  const oldest = recent[0];
  const newest = recent[recent.length - 1];
  const atCursor = recent.find((entry) => entry.id === cursor.id);
  const restart = (): Continuity => ({
    kind: "restart",
    entries: recent,
    gap: oldest !== undefined && oldest.id !== 1,
  });
  // An empty history after one that held the cursor: sparkDash restarted and
  // has seen nothing since.
  if (!newest || !oldest) return restart();
  if (newest.id < cursor.id) return restart();
  if (atCursor !== undefined && !same(atCursor, cursor)) return restart();
  if (newest.id === cursor.id) return atCursor ? { kind: "none", entries: [] } : restart();
  const fresh = recent.filter((entry) => entry.id > cursor.id);
  if (oldest.id <= cursor.id + 1) return { kind: "contiguous", entries: fresh };
  return { kind: "gap", entries: fresh };
}

export function cursorOf(entry: HistoryEntry): Cursor {
  return { id: entry.id, key: entry.key, status: entry.status, at: entry.at };
}
