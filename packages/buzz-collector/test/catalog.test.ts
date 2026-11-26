import { describe, expect, it } from "vitest";
import {
  BuzzChannelCatalog,
  MAX_CHANNELS,
  channelAdmission,
  parseBuzzChannelSnapshot,
  type BuzzChannelSnapshot,
  type BuzzChannelStore,
} from "../src/index.js";

const flag = "00000000-0000-4000-8000-000000000001";
const general = "00000000-0000-4000-8000-000000000002";
const dm = "00000000-0000-4000-8000-000000000003";

const snapshot: BuzzChannelSnapshot = {
  version: 1,
  revision: 2,
  channels: [
    { channel: flag, label: "homer", enabled: true, flagChannel: true },
    { channel: general, label: "general", enabled: false, flagChannel: false },
    { channel: dm, label: "a direct message", enabled: true, flagChannel: false },
  ],
};

const metadata = (channel: string, extra: string[][] = []) => ({
  kind: 39000,
  tags: [["d", channel], ["name", "Channel name"], ...extra],
});

/** An in-memory store with the transactional compare-and-swap the interface requires. */
function memoryStore(initial: unknown): BuzzChannelStore & { value: unknown } {
  const store = {
    value: initial,
    read() {
      return Promise.resolve(structuredClone(store.value));
    },
    compareAndSwap(expected: number, next: BuzzChannelSnapshot) {
      const current = parseBuzzChannelSnapshot(store.value);
      if (current.revision !== expected) return Promise.resolve(false);
      store.value = next;
      return Promise.resolve(true);
    },
  };
  return store;
}

describe("channel snapshots", () => {
  it("accepts a reviewed snapshot", () => {
    expect(parseBuzzChannelSnapshot(structuredClone(snapshot))).toEqual(snapshot);
    expect(parseBuzzChannelSnapshot({ version: 1, revision: 0, channels: [] })).toEqual({
      version: 1,
      revision: 0,
      channels: [],
    });
  });

  it("refuses malformed snapshots and entries", () => {
    const entry = snapshot.channels[0];
    for (const bad of [
      null,
      { ...snapshot, version: 2 },
      { ...snapshot, revision: -1 },
      { ...snapshot, revision: 1.5 },
      { ...snapshot, extra: true },
      { ...snapshot, channels: "all" },
      { ...snapshot, channels: Array.from({ length: MAX_CHANNELS + 1 }, () => entry) },
      { ...snapshot, channels: [{ ...entry, channel: "HOMER" }] },
      { ...snapshot, channels: [{ ...entry, label: "" }] },
      { ...snapshot, channels: [{ ...entry, label: " padded" }] },
      { ...snapshot, channels: [{ ...entry, label: "line\nbreak" }] },
      { ...snapshot, channels: [{ ...entry, label: "line\u2028separator" }] },
      { ...snapshot, channels: [{ ...entry, label: "bell\u0007" }] },
      { ...snapshot, channels: [{ ...entry, label: "x".repeat(101) }] },
      { ...snapshot, channels: [{ ...entry, enabled: "yes" }] },
      { ...snapshot, channels: [{ ...entry, flagChannel: undefined }] },
      { ...snapshot, channels: [{ ...entry, note: "extra" }] },
      { ...snapshot, channels: [entry, { ...entry, label: "again" }] },
    ]) {
      expect(() => parseBuzzChannelSnapshot(bad)).toThrow();
    }
  });
});

describe("channel admission", () => {
  it("reads only an enabled, listed channel that is not a direct message", () => {
    expect(channelAdmission(snapshot, flag, metadata(flag))).toEqual({
      admitted: true,
      entry: snapshot.channels[0],
    });
    expect(channelAdmission(snapshot, general, metadata(general))).toEqual({
      admitted: false,
      reason: "disabled",
    });
    const unlisted = "00000000-0000-4000-8000-000000000009";
    expect(channelAdmission(snapshot, unlisted, metadata(unlisted))).toEqual({
      admitted: false,
      reason: "not_listed",
    });
  });

  it("refuses a hidden channel even when it is listed and enabled", () => {
    expect(channelAdmission(snapshot, dm, metadata(dm, [["hidden"]]))).toEqual({
      admitted: false,
      reason: "direct_message",
    });
  });

  it("fails closed without trustworthy metadata for that channel", () => {
    for (const bad of [
      undefined,
      null,
      { kind: 39001, tags: [["d", flag]] },
      { kind: 39000, tags: "d" },
      {
        kind: 39000,
        tags: [
          ["d", flag],
          ["hidden", 1],
        ],
      },
      { kind: 39000, tags: [] },
      metadata(general),
      {
        kind: 39000,
        tags: [
          ["d", flag],
          ["d", general],
        ],
      },
    ]) {
      expect(channelAdmission(snapshot, flag, bad)).toEqual({
        admitted: false,
        reason: "metadata_unavailable",
      });
    }
  });

  it("admits nothing from an empty catalog", () => {
    const empty = { version: 1 as const, revision: 0, channels: [] };
    expect(channelAdmission(empty, flag, metadata(flag))).toEqual({
      admitted: false,
      reason: "not_listed",
    });
  });
});

describe("the channel catalog", () => {
  it("replaces by compare-and-swap and refuses a stale writer", async () => {
    const store = memoryStore({ version: 1, revision: 0, channels: [] });
    const catalog = new BuzzChannelCatalog(store);
    const saved = await catalog.replace(0, snapshot.channels);
    expect(saved.revision).toBe(1);
    expect(await catalog.list()).toEqual(saved);
    await expect(catalog.replace(0, [])).rejects.toThrow("channel_revision_conflict");
    await expect(catalog.replace(-1, [])).rejects.toThrow("invalid_expected_revision");
    await expect(catalog.replace(1, [{ ...snapshot.channels[0]!, label: "" }])).rejects.toThrow(
      "invalid_channel_entry",
    );
    expect((await catalog.list()).revision).toBe(1);
  });

  it("fails closed on a missing or invalid stored catalog", async () => {
    for (const stored of [undefined, null, { version: 1, revision: 0 }, "corrupt"]) {
      const catalog = new BuzzChannelCatalog(memoryStore(stored));
      await expect(catalog.list()).rejects.toThrow();
      await expect(catalog.admit(flag, metadata(flag))).rejects.toThrow();
    }
  });

  it("applies a change to the next admission", async () => {
    const store = memoryStore(snapshot);
    const catalog = new BuzzChannelCatalog(store);
    expect((await catalog.admit(flag, metadata(flag))).admitted).toBe(true);
    await catalog.replace(2, [{ ...snapshot.channels[0]!, enabled: false }]);
    expect(await catalog.admit(flag, metadata(flag))).toEqual({
      admitted: false,
      reason: "disabled",
    });
  });
});
