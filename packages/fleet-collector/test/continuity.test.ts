import { describe, expect, it } from "vitest";
import {
  SHAPE_CHANGED,
  continuity,
  parseAlerts,
  type Cursor,
  type HistoryEntry,
} from "../src/index.js";
import { alertsBody, range } from "./fixture.js";

function history(from: number, to: number): HistoryEntry[] {
  const parsed = parseAlerts(alertsBody(range(from, to)));
  if (parsed === SHAPE_CHANGED) throw new Error("fixture does not parse");
  return parsed.recent;
}

function cursorAt(entries: HistoryEntry[], id: number): Cursor {
  const e = entries.find((x) => x.id === id);
  if (!e) throw new Error(`no entry ${id}`);
  return { id: e.id, key: e.key, status: e.status, at: e.at };
}

describe("the continuity rules", () => {
  it("finds no new entries when the newest is the cursor and still matches", () => {
    const h = history(1, 50);
    expect(continuity(cursorAt(h, 50), h)).toEqual({ kind: "none", entries: [] });
  });

  it("is contiguous for ids 91 to 290 after cursor 90, with no diagnostic", () => {
    const before = history(1, 200);
    const cursor = cursorAt(before, 90);
    const flow = continuity(cursor, history(91, 290));
    expect(flow.kind).toBe("contiguous");
    expect(flow.entries.map((e) => e.id)).toEqual(Array.from({ length: 200 }, (_, i) => 91 + i));
  });

  it("is a gap for ids 101 to 300 after cursor 90, and turns what is held into events", () => {
    const cursor = cursorAt(history(1, 90), 90);
    const flow = continuity(cursor, history(101, 300));
    expect(flow.kind).toBe("gap");
    expect(flow.entries.map((e) => e.id)).toEqual(Array.from({ length: 200 }, (_, i) => 101 + i));
  });

  it("is a restart when the newest id is below the cursor, and every entry held is new", () => {
    const cursor = cursorAt(history(51, 250), 250);
    expect(continuity(cursor, history(1, 4))).toEqual({
      kind: "restart",
      entries: history(1, 4),
      gap: false,
    });
  });

  it("is a restart when the entry at the cursor no longer matches, with a gap if history does not start at 1", () => {
    const cursor = { ...cursorAt(history(1, 20), 20), at: 1 };
    const restarted = continuity(cursor, history(5, 30));
    expect(restarted.kind).toBe("restart");
    expect(restarted.kind === "restart" && restarted.gap).toBe(true);
    expect(restarted.entries).toHaveLength(26);
    // An empty history from the start is nothing new; after a cursor, a restart.
    expect(continuity({ id: 0, key: "", status: "firing", at: 0 }, [])).toEqual({
      kind: "none",
      entries: [],
    });
    expect(continuity(cursorAt(history(1, 3), 3), [])).toEqual({
      kind: "restart",
      entries: [],
      gap: false,
    });
  });

  it("takes everything held on the first poll", () => {
    expect(continuity(null, history(10, 12)).entries.map((e) => e.id)).toEqual([10, 11, 12]);
  });
});
