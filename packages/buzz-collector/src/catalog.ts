/**
 * The Buzz channel allowlist. Contract: specs/buzz/spec.md, "Channel allowlist". Reviewed
 * configuration with a monotonic revision, replaced only by compare-and-swap. An empty catalog
 * admits nothing, and a missing or invalid one fails closed with no stale fallback.
 */

export interface BuzzChannelEntry {
  /** The channel's UUID, as its `h` tag names it. */
  readonly channel: string;
  /** For the operator UI only. Never reaches an Activity Event. */
  readonly label: string;
  readonly enabled: boolean;
  /** Applied by Projections, never by the mapper. */
  readonly flagChannel: boolean;
}

export interface BuzzChannelSnapshot {
  readonly version: 1;
  readonly revision: number;
  readonly channels: readonly BuzzChannelEntry[];
}

/** Implementations must persist atomically and compare the revision in the same transaction. */
export interface BuzzChannelStore {
  read(): Promise<unknown>;
  compareAndSwap(expectedRevision: number, next: BuzzChannelSnapshot): Promise<boolean>;
}

export const MAX_CHANNELS = 200;
export const MAX_LABEL_CHARS = 100;
/** NIP-29 group metadata, which the relay publishes for each channel. */
export const CHANNEL_METADATA_KIND = 39000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Labels are shown to people, so control characters and line separators are refused. */
function hasControl(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      return true;
    }
  }
  return false;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseBuzzChannelSnapshot(input: unknown): BuzzChannelSnapshot {
  const value = record(input);
  if (
    !value ||
    value.version !== 1 ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.channels) ||
    value.channels.length > MAX_CHANNELS ||
    Object.keys(value).some((key) => !["version", "revision", "channels"].includes(key))
  ) {
    throw new Error("invalid_channel_snapshot");
  }
  const seen = new Set<string>();
  const channels = (value.channels as unknown[]).map((item): BuzzChannelEntry => {
    const entry = record(item);
    if (
      !entry ||
      Object.keys(entry).some(
        (key) => !["channel", "label", "enabled", "flagChannel"].includes(key),
      ) ||
      typeof entry.channel !== "string" ||
      !UUID.test(entry.channel) ||
      typeof entry.label !== "string" ||
      entry.label.length === 0 ||
      entry.label.length > MAX_LABEL_CHARS ||
      entry.label.trim() !== entry.label ||
      hasControl(entry.label) ||
      typeof entry.enabled !== "boolean" ||
      typeof entry.flagChannel !== "boolean"
    ) {
      throw new Error("invalid_channel_entry");
    }
    if (seen.has(entry.channel)) throw new Error("duplicate_channel");
    seen.add(entry.channel);
    return {
      channel: entry.channel,
      label: entry.label,
      enabled: entry.enabled,
      flagChannel: entry.flagChannel,
    };
  });
  return { version: 1, revision: value.revision, channels };
}

export type ChannelAdmission =
  | { readonly admitted: true; readonly entry: BuzzChannelEntry }
  | {
      readonly admitted: false;
      readonly reason: "not_listed" | "disabled" | "metadata_unavailable" | "direct_message";
    };

/**
 * Whether to read a channel. Only enabled catalog channels are read, and never a direct
 * message: a channel whose relay metadata (kind 39000) carries the `hidden` tag is refused even
 * when listed. Metadata that is missing, malformed, or for another channel fails closed.
 */
export function channelAdmission(
  snapshot: BuzzChannelSnapshot,
  channel: string,
  metadata: unknown,
): ChannelAdmission {
  const entry = snapshot.channels.find((candidate) => candidate.channel === channel);
  if (!entry) return { admitted: false, reason: "not_listed" };
  if (!entry.enabled) return { admitted: false, reason: "disabled" };
  const event = record(metadata);
  const tags = event?.tags;
  if (!event || event.kind !== CHANNEL_METADATA_KIND || !Array.isArray(tags)) {
    return { admitted: false, reason: "metadata_unavailable" };
  }
  const list = tags as unknown[];
  // The check narrows list to string[][], since TypeScript infers both predicates.
  if (!list.every((tag) => Array.isArray(tag) && tag.every((item) => typeof item === "string"))) {
    return { admitted: false, reason: "metadata_unavailable" };
  }
  const ids = list.filter((tag) => tag[0] === "d").map((tag) => tag[1]);
  if (ids.length !== 1 || ids[0] !== channel) {
    return { admitted: false, reason: "metadata_unavailable" };
  }
  if (list.some((tag) => tag[0] === "hidden")) {
    return { admitted: false, reason: "direct_message" };
  }
  return { admitted: true, entry };
}

/** Internal capability only. An authenticated admin adapter must guard replace(). */
export class BuzzChannelCatalog {
  private readonly store: BuzzChannelStore;

  constructor(store: BuzzChannelStore) {
    this.store = store;
  }

  async list(): Promise<BuzzChannelSnapshot> {
    return parseBuzzChannelSnapshot(await this.store.read());
  }

  async replace(
    expectedRevision: number,
    channels: readonly BuzzChannelEntry[],
  ): Promise<BuzzChannelSnapshot> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error("invalid_expected_revision");
    }
    const next = parseBuzzChannelSnapshot({
      version: 1,
      revision: expectedRevision + 1,
      channels,
    });
    if (!(await this.store.compareAndSwap(expectedRevision, structuredClone(next)))) {
      throw new Error("channel_revision_conflict");
    }
    return next;
  }

  /** Loads the catalog fresh, so a change applies to the next collection, never a stale copy. */
  async admit(channel: string, metadata: unknown): Promise<ChannelAdmission> {
    return channelAdmission(await this.list(), channel, metadata);
  }
}
