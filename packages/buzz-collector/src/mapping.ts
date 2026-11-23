/**
 * Maps one untrusted Nostr event from the Buzz relay to one Activity Event, or refuses it.
 * Contract: specs/buzz/spec.md, "Mapping a Buzz event". Pure: no network, write, or clock read.
 * Only metadata and a link leave this function; message text, names, attachments, mentions and
 * the raw event never do.
 */
import { validateActivityEvent, type ActivityEvent } from "@zs-home/shared-contracts/workers";
import { createHash } from "node:crypto";

/** Reviewed configuration. Nothing else in the catalog may affect a mapped event. */
export interface BuzzCollectionContext {
  /** The relay's https origin. */
  readonly relayOrigin: string;
  /** The channel's UUID, as its `h` tag names it. */
  readonly channel: string;
  readonly collectedAt: string;
}

/**
 * BIP-340 Schnorr verification, as Nostr defines it: `signature` (64 bytes) over `message`
 * (the 32-byte event id) by the x-only `publicKey` (32 bytes). The collector passes an audited
 * implementation; the mapper never verifies signatures itself.
 */
export type SchnorrVerify = (
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
) => boolean;

export type BuzzRefusal =
  | "invalid_context"
  | "invalid_event"
  | "oversized_event"
  | "not_channel_message"
  | "bad_id"
  | "bad_signature"
  | "channel_mismatch"
  | "future_timestamp"
  | "ambiguous_thread"
  | "invalid_activity_event";

export type BuzzMappingResult =
  | { readonly outcome: "mapped"; readonly event: ActivityEvent }
  | { readonly outcome: "refused"; readonly reason: BuzzRefusal };

export const COLLECTOR = "homer-buzz";
export const COLLECTOR_VERSION = "1.0.0";
/** Kind 9: a channel message. */
export const CHANNEL_MESSAGE_KIND = 9;
/** An author sets `created_at`, so a time this far past collection is refused. */
export const MAX_FUTURE_SECONDS = 10 * 60;
/** Bounds on what is hashed. Content is hashed only, never kept. */
export const MAX_CONTENT_CHARS = 64 * 1024;
export const MAX_TAGS = 2000;
export const MAX_TAG_ITEMS = 16;
export const MAX_TAG_ITEM_CHARS = 4096;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hexBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function validContext(context: BuzzCollectionContext | undefined): boolean {
  if (!context || typeof context.channel !== "string" || !UUID.test(context.channel)) return false;
  if (typeof context.collectedAt !== "string" || !UTC.test(context.collectedAt)) return false;
  if (Number.isNaN(Date.parse(context.collectedAt))) return false;
  if (typeof context.relayOrigin !== "string") return false;
  try {
    const url = new URL(context.relayOrigin);
    return url.protocol === "https:" && url.origin === context.relayOrigin;
  } catch {
    return false;
  }
}

type Tags = string[][];

function readTags(value: unknown): Tags | "invalid" | "oversized" {
  if (!Array.isArray(value)) return "invalid";
  if (value.length > MAX_TAGS) return "oversized";
  const tags: Tags = [];
  for (const tag of value as unknown[]) {
    if (!Array.isArray(tag) || tag.length === 0) return "invalid";
    if (tag.length > MAX_TAG_ITEMS) return "oversized";
    const items: string[] = [];
    for (const item of tag as unknown[]) {
      if (typeof item !== "string") return "invalid";
      if (item.length > MAX_TAG_ITEM_CHARS) return "oversized";
      items.push(item);
    }
    tags.push(items);
  }
  return tags;
}

/** NIP-01: the id is the sha256 of `[0, pubkey, created_at, kind, tags, content]`. */
export function nostrEventId(event: {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: Tags;
  content: string;
}): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

/**
 * The thread root a reply names (NIP-10): the `e` tag marked `root`, or else the one marked
 * `reply`. More than one of the deciding marker is ambiguous. Null when it is not a reply.
 */
function threadRoot(tags: Tags): string | null | "ambiguous" {
  for (const marker of ["root", "reply"]) {
    const ids = tags.filter((t) => t[0] === "e" && t[3] === marker).map((t) => t[1] ?? "");
    if (ids.length > 1) return "ambiguous";
    const [id] = ids;
    if (id !== undefined) return HEX64.test(id) ? id : "ambiguous";
  }
  return null;
}

function buzzLink(channel: string, id: string): string {
  return `buzz://message?channel=${channel}&id=${id}`;
}

function utcFromSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
}

const refuse = (reason: BuzzRefusal): BuzzMappingResult => ({ outcome: "refused", reason });

/** Returns the mapper with an audited Schnorr verifier bound in. */
export function createBuzzMapper(verify: SchnorrVerify) {
  return function mapBuzzEvent(input: unknown, context: BuzzCollectionContext): BuzzMappingResult {
    if (!validContext(context)) return refuse("invalid_context");
    const event = record(input);
    if (!event) return refuse("invalid_event");
    const { id, pubkey, sig, created_at: createdAt, kind, content } = event;
    // 1. Shape, with NIP-01 lengths, and kind 9.
    if (typeof id !== "string" || !HEX64.test(id)) return refuse("invalid_event");
    if (typeof pubkey !== "string" || !HEX64.test(pubkey)) return refuse("invalid_event");
    if (typeof sig !== "string" || !HEX128.test(sig)) return refuse("invalid_event");
    if (typeof createdAt !== "number" || !Number.isSafeInteger(createdAt) || createdAt < 0) {
      return refuse("invalid_event");
    }
    if (typeof kind !== "number" || !Number.isSafeInteger(kind)) return refuse("invalid_event");
    if (typeof content !== "string") return refuse("invalid_event");
    if (content.length > MAX_CONTENT_CHARS) return refuse("oversized_event");
    const tags = readTags(event.tags);
    if (tags === "invalid") return refuse("invalid_event");
    if (tags === "oversized") return refuse("oversized_event");
    if (kind !== CHANNEL_MESSAGE_KIND) return refuse("not_channel_message");

    // 2. The id is the event's hash, and the signature is the author's.
    if (nostrEventId({ pubkey, created_at: createdAt, kind, tags, content }) !== id) {
      return refuse("bad_id");
    }
    let signed = false;
    try {
      signed = verify(hexBytes(sig), hexBytes(id), hexBytes(pubkey));
    } catch {
      signed = false;
    }
    if (!signed) return refuse("bad_signature");

    // 3. Exactly one channel, the one in context.
    const channels = tags.filter((t) => t[0] === "h");
    if (channels.length !== 1 || channels[0]?.[1] !== context.channel) {
      return refuse("channel_mismatch");
    }

    // 4. Not after collection, beyond a small allowance.
    if (createdAt * 1000 > Date.parse(context.collectedAt) + MAX_FUTURE_SECONDS * 1000) {
      return refuse("future_timestamp");
    }

    const root = threadRoot(tags);
    if (root === "ambiguous") return refuse("ambiguous_thread");
    // The kind depends only on the signed event, so re-collecting yields the same Event Key.
    const flagged = tags.some((t) => t[0] === "t" && t[1] === "knowledge-flag");
    const link = buzzLink(context.channel, id);
    const mapped: ActivityEvent = {
      contract: "home.activity-event/v2",
      eventKey: `buzz:${flagged ? "knowledge.flagged" : "message.posted"}:${context.channel}/${id}`,
      kind: flagged ? "knowledge.flagged" : "message.posted",
      occurredAt: utcFromSeconds(createdAt),
      actor: { sourceAccount: `buzz:${pubkey}` },
      subject: flagged ? "Buzz knowledge flag" : "Buzz message",
      provenance: {
        sourceSystem: "buzz",
        sourceObjectId: id,
        sourceUrl: link,
        collector: COLLECTOR,
        collectorVersion: COLLECTOR_VERSION,
        collectedAt: context.collectedAt,
      },
      ...(root === null || root === id
        ? {}
        : { evidence: [{ label: "Thread root", url: buzzLink(context.channel, root) }] }),
    };
    if (!validateActivityEvent(mapped).ok) return refuse("invalid_activity_event");
    return { outcome: "mapped", event: mapped };
  };
}
