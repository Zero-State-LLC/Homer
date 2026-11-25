import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { ActivityEvent } from "@zs-home/shared-contracts";
import { initialState, type CollectorState } from "../poll.js";
import type { ReachabilityState } from "./reachability.js";

/** The queue holds at most this many events. */
export const MAX_QUEUE = 10_000;

/**
 * Everything the Collector keeps on its host, saved as one file so the queue
 * and the cursor always move together: events are on disk before the cursor
 * that counts them.
 */
export interface StoredState {
  version: 1;
  collector: CollectorState;
  reachability: Record<string, ReachabilityState>;
  /** Events not yet delivered, oldest first. */
  queue: ActivityEvent[];
  delivery: { failures: number; nextAttemptAt: number };
}

export function initialStored(): StoredState {
  return {
    version: 1,
    collector: initialState(),
    reachability: {},
    queue: [],
    delivery: { failures: 0, nextAttemptAt: 0 },
  };
}

export interface StateStore {
  /** The saved state, or the initial one when there is none. Throws on a file it cannot read. */
  load(): Promise<StoredState>;
  /** Replaces the saved state atomically, and returns only once it is on disk. */
  save(state: StoredState): Promise<void>;
}

/** Refused rather than reset: a lost queue or cursor must not pass silently. */
export class StateUnreadable extends Error {
  constructor() {
    super("the Collector's state file cannot be read; it was left as it is");
    this.name = "StateUnreadable";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checked(value: unknown): StoredState {
  if (
    !isRecord(value) ||
    value["version"] !== 1 ||
    !isRecord(value["collector"]) ||
    !isRecord(value["reachability"]) ||
    !Array.isArray(value["queue"]) ||
    value["queue"].length > MAX_QUEUE ||
    !isRecord(value["delivery"])
  )
    throw new StateUnreadable();
  const collector = { ...initialState(), ...value["collector"] } as CollectorState;
  return { ...(value as unknown as StoredState), collector };
}

/** A JSON file, written to a temporary file, flushed, then renamed over the old one. */
export function fileStore(path: string): StateStore {
  return {
    async load() {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return initialStored();
        throw new StateUnreadable();
      }
      try {
        return checked(JSON.parse(text));
      } catch {
        throw new StateUnreadable();
      }
    },
    async save(state) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temporary = `${path}.${process.pid}.tmp`;
      const file = await open(temporary, "w", 0o600);
      try {
        await file.writeFile(JSON.stringify(state));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, path);
      const directory = await open(dirname(path), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    },
  };
}

/** An in-memory store, for tests. */
export function memoryStore(initial: StoredState = initialStored()): StateStore & {
  saved: StoredState[];
} {
  let current = structuredClone(initial);
  const saved: StoredState[] = [];
  return {
    saved,
    load: () => Promise.resolve(structuredClone(current)),
    save: (state) => {
      current = structuredClone(state);
      saved.push(structuredClone(state));
      return Promise.resolve();
    },
  };
}
