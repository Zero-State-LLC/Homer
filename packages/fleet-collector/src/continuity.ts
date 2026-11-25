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
  if (!newest || !oldest) {
    // Still empty from the start (a baseline at 0 names no entry): nothing new.
    // Empty after a history that held entries: sparkDash restarted.
    return cursor.id === 0 ? { kind: "none", entries: [] } : restart();
  }
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

/**
 * A cursor just before `id`, naming no entry: what the Collector keeps when it
 * has a history to follow but turned nothing into events yet (a first poll or
 * a restart with the queue full, or an empty history). The next poll is then
 * contiguous from it, or a gap if sparkDash evicted entries in between, and
 * never the same restart twice.
 */
export function baselineBefore(id: number): Cursor {
  return { id: Math.max(id - 1, 0), key: "", status: "firing", at: 0 };
}
