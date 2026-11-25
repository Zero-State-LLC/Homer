import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BUILD_VERSION } from "@zs-home/shared-contracts/workers";
import {
  MAX_CONTENT_CHARS,
  MAX_TAG_ITEM_CHARS,
  MAX_TAGS,
  createBuzzMapper,
  nostrEventId,
  type BuzzCollectionContext,
  type SchnorrVerify,
} from "../src/index.js";

const channel = "00000000-0000-4000-8000-000000000001";
const otherChannel = "00000000-0000-4000-8000-000000000002";
const pubkey = "b".repeat(64);
const root = "c".repeat(64);
const secret = "SECRET-TEXT-MUST-NOT-LEAK";

const context: BuzzCollectionContext = {
  relayOrigin: "https://relay.example.test",
  channel,
  collectedAt: "2026-11-23T15:05:00Z",
};

/**
 * A stand-in signature scheme for these tests: the "signature" is a hash of the id and key.
 * It exercises the mapper's plumbing; real Schnorr verification is the collector's audited
 * dependency.
 */
function fakeSign(id: string, key: string): string {
  const half = createHash("sha256").update(`${id}:${key}`).digest("hex");
  return half + half;
}
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const fakeVerify: SchnorrVerify = (signature, message, publicKey) =>
  toHex(signature) === fakeSign(toHex(message), toHex(publicKey));

const mapBuzzEvent = createBuzzMapper(fakeVerify);

interface RawEvent {
  id: string;
  pubkey: string;
  sig: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

/** A signed channel message, with fields overridable before signing. */
function signed(overrides: Partial<Omit<RawEvent, "id" | "sig">> = {}): RawEvent {
  const base = {
    pubkey,
    created_at: Date.parse("2026-11-23T15:04:05Z") / 1000,
    kind: 9,
    tags: [["h", channel]],
    content: `hello ${secret}`,
    ...overrides,
  };
  const id = nostrEventId(base);
  return { ...base, id, sig: fakeSign(id, base.pubkey) };
}

function mapped(event: unknown, ctx = context) {
  const result = mapBuzzEvent(event, ctx);
  if (result.outcome !== "mapped") expect.fail(`refused: ${result.reason}`);
  return result.event;
}

function refusal(event: unknown, ctx = context): string {
  const result = mapBuzzEvent(event, ctx);
  return result.outcome === "refused" ? result.reason : "mapped";
}

describe("mapping a Buzz event", () => {
  it("maps a channel message to metadata and a link", () => {
    const event = signed();
    expect(mapped(event)).toEqual({
      contract: "home.activity-event/v2",
      eventKey: `buzz:message.posted:${channel}/${event.id}`,
      kind: "message.posted",
      occurredAt: "2026-11-23T15:04:05Z",
      actor: { sourceAccount: `buzz:${pubkey}` },
      subject: "Buzz message",
      provenance: {
        sourceSystem: "buzz",
        sourceObjectId: event.id,
        sourceUrl: `buzz://message?channel=${channel}&id=${event.id}`,
        collector: "homer-buzz",
        collectorVersion: BUILD_VERSION,
        collectedAt: "2026-11-23T15:05:00Z",
      },
    });
  });

  it("maps a message tagged knowledge-flag to a Knowledge Flag", () => {
    const event = signed({
      tags: [
        ["h", channel],
        ["t", "knowledge-flag"],
      ],
    });
    expect(mapped(event)).toMatchObject({
      eventKey: `buzz:knowledge.flagged:${channel}/${event.id}`,
      kind: "knowledge.flagged",
      subject: "Buzz knowledge flag",
    });
  });

  it("links a thread reply to its root", () => {
    for (const marker of ["reply", "root"]) {
      const event = signed({
        tags: [
          ["h", channel],
          ["e", root, "", marker],
        ],
      });
      expect(mapped(event).evidence).toEqual([
        { label: "Thread root", url: `buzz://message?channel=${channel}&id=${root}` },
      ]);
    }
    const twoRoots = signed({
      tags: [
        ["h", channel],
        ["e", root, "", "root"],
        ["e", "d".repeat(64), "", "root"],
      ],
    });
    expect(refusal(twoRoots)).toBe("ambiguous_thread");
    expect(
      refusal(
        signed({
          tags: [
            ["h", channel],
            ["e", "not-an-id", "", "reply"],
          ],
        }),
      ),
    ).toBe("ambiguous_thread");
  });

  it("keeps the Event Key and content when the catalog or collection time changes", () => {
    const event = signed();
    const first = mapped(event);
    const again = mapped(event, {
      ...context,
      relayOrigin: "https://relay2.example.test",
      collectedAt: "2026-11-23T16:00:00Z",
    });
    expect(again.eventKey).toBe(first.eventKey);
    expect({ ...again, provenance: { ...again.provenance, collectedAt: "" } }).toEqual({
      ...first,
      provenance: { ...first.provenance, collectedAt: "" },
    });
    expect(mapped(event)).toEqual(first);
  });

  it("never lets text, names, mentions or attachments into the output", () => {
    const event = signed({
      tags: [
        ["h", channel],
        ["p", "d".repeat(64), "", "Danny"],
        ["name", `Display ${secret}`],
        ["imeta", `url https://files.example.test/${secret}.png`],
        ["t", "knowledge-flag"],
      ],
    });
    const output = JSON.stringify(mapped(event));
    for (const leak of [secret, "Danny", "Display", "files.example.test", "d".repeat(64)]) {
      expect(output).not.toContain(leak);
    }
  });
});

describe("refusing a Buzz event", () => {
  it("refuses a bad or wrong-length signature", () => {
    expect(refusal({ ...signed(), sig: "e".repeat(128) })).toBe("bad_signature");
    expect(refusal({ ...signed(), sig: "e".repeat(126) })).toBe("invalid_event");
    expect(refusal({ ...signed(), sig: "E".repeat(128) })).toBe("invalid_event");
    const throwing = createBuzzMapper(() => {
      throw new Error("bad point");
    });
    expect(throwing(signed(), context)).toEqual({ outcome: "refused", reason: "bad_signature" });
  });

  it("refuses an id that is not the event's hash", () => {
    const event = signed();
    expect(refusal({ ...event, content: "edited" })).toBe("bad_id");
    expect(refusal({ ...event, id: "f".repeat(64) })).toBe("bad_id");
    expect(refusal({ ...event, id: "abc" })).toBe("invalid_event");
  });

  it("refuses the wrong channel, no channel, or two channels", () => {
    expect(refusal(signed({ tags: [["h", otherChannel]] }))).toBe("channel_mismatch");
    expect(refusal(signed({ tags: [] }))).toBe("channel_mismatch");
    expect(
      refusal(
        signed({
          tags: [
            ["h", channel],
            ["h", otherChannel],
          ],
        }),
      ),
    ).toBe("channel_mismatch");
  });

  it("refuses any kind but a channel message", () => {
    expect(refusal(signed({ kind: 7 }))).toBe("not_channel_message");
    expect(refusal({ ...signed(), kind: 9.5 })).toBe("invalid_event");
  });

  it("refuses a time more than ten minutes past collection", () => {
    const collected = Date.parse(context.collectedAt) / 1000;
    expect(refusal(signed({ created_at: collected + 600 }))).toBe("mapped");
    expect(refusal(signed({ created_at: collected + 601 }))).toBe("future_timestamp");
    expect(refusal({ ...signed(), created_at: -1 })).toBe("invalid_event");
  });

  it("refuses oversized and malformed fields", () => {
    expect(refusal(signed({ content: "x".repeat(MAX_CONTENT_CHARS + 1) }))).toBe("oversized_event");
    const many = Array.from({ length: MAX_TAGS + 1 }, () => ["t", "x"]);
    expect(refusal({ ...signed(), tags: many })).toBe("oversized_event");
    // Within every per-field limit, but escaping would make the hashed text enormous.
    const nul = "\u0000".repeat(MAX_TAG_ITEM_CHARS);
    const escaping = Array.from({ length: MAX_TAGS }, () => Array.from({ length: 16 }, () => nul));
    expect(refusal({ ...signed(), tags: escaping })).toBe("oversized_event");
    expect(
      refusal({
        ...signed(),
        tags: [
          ["h", channel],
          ["t", 1],
        ],
      }),
    ).toBe("invalid_event");
    expect(refusal({ ...signed(), tags: [[]] })).toBe("invalid_event");
    expect(refusal({ ...signed(), tags: "h" })).toBe("invalid_event");
    expect(refusal({ ...signed(), content: 5 })).toBe("invalid_event");
    expect(refusal(null)).toBe("invalid_event");
    expect(refusal([signed()])).toBe("invalid_event");
  });

  it("refuses an invalid context", () => {
    for (const bad of [
      { ...context, channel: "not-a-uuid" },
      { ...context, relayOrigin: "http://relay.example.test" },
      { ...context, relayOrigin: "https://relay.example.test/path" },
      { ...context, collectedAt: "2026-11-23T15:05:00-08:00" },
    ]) {
      expect(refusal(signed(), bad)).toBe("invalid_context");
    }
  });

  it("maps a retried event identically", () => {
    const event = signed();
    expect(mapBuzzEvent(structuredClone(event), context)).toEqual(mapBuzzEvent(event, context));
  });
});
