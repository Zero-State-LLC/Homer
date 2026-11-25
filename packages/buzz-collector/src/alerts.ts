/**
 * Homer's Alerts to the Buzz `homer` channel (Buzz spec, "Alerts to Buzz"): change-only
 * messages from fixed templates and ids, at most 30 an hour, retried with backoff. Pure: the
 * caller keeps the state, supplies the time, and signs and posts what `dueAlerts` returns.
 * The caller serializes the calls: no `applyAlerts` between handing out a delivery and
 * recording its outcome with `markDelivered` or `markFailed`.
 */

/** A message is posted at most this often in any rolling hour, the held-alert summary included. */
export const ALERTS_PER_HOUR = 30;
const HOUR_MS = 60 * 60_000;
/** Waits after the first, second, third and later failed posts. */
export const ALERT_BACKOFF_MS: readonly number[] = [30_000, 60_000, 120_000, 300_000, 600_000];
/** A one-shot Alert's record is kept this long, so the same occurrence is never posted twice. */
export const ONE_SHOT_RETENTION_MS = 7 * 24 * HOUR_MS;
/** The Alert Key of the summary that says how many Alerts the hourly cap holds. */
export const HELD_ALERTS_KEY = "homer:alerts:held";

const PATTERNS = {
  id: /^[a-z0-9][a-z0-9-]{0,63}$/,
  // The Fleet Report's display-name rule: letters, digits, space, `.`, `_` and `-`.
  name: /^[A-Za-z0-9 ._-]{1,40}$/,
  time: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/,
  rule: /^[a-z0-9-]{1,40}$/,
  version: /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/,
  count: /^(0|[1-9][0-9]{0,5})$/,
} satisfies Record<string, RegExp>;

/** What a parameter may hold: ids, times or Homer's own words, or one of a fixed list. */
export type AlertParamKind = keyof typeof PATTERNS | readonly string[];

/** An Alert Key: Homer's ids, joined by `:`. */
const ALERT_KEY = /^[a-z0-9][A-Za-z0-9:._-]{0,199}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A fixed template. `raised` and `cleared` build the sentence from checked parameters only.
 * A template without `cleared` is one-shot: posted once per Alert Key, never cleared.
 */
export interface AlertTemplate {
  readonly params: Readonly<Record<string, AlertParamKind>>;
  readonly raised: (params: Readonly<Record<string, string>>) => string;
  readonly cleared?: (params: Readonly<Record<string, string>>) => string;
  /** A fixed link to what to do, never one built from a source. */
  readonly runbook: string;
}

export type AlertTemplates = Readonly<Record<string, AlertTemplate>>;

export interface AlertApplyOptions {
  /**
   * Key prefixes inside the scope whose raised Alerts stay as they are when not requested,
   * because the monitor cannot see their source now.
   */
  readonly hold?: readonly string[];
  /** Keys under a hold prefix that the monitor can still see, so they clear as usual. */
  readonly holdExcept?: readonly string[];
}

/** An Alert a Projection or monitor raises now. */
export interface AlertRequest {
  readonly key: string;
  readonly template: string;
  readonly params: Readonly<Record<string, string>>;
}

/** Why a request was refused. */
export const ALERT_REFUSALS = [
  "invalid_key",
  "outside_scope",
  "duplicate_key",
  "unknown_template",
  "invalid_params",
] as const;
export type AlertRefusal = (typeof ALERT_REFUSALS)[number];

interface Pending {
  content: string;
  queuedAt: number;
  attempts: number;
  nextAttemptAt: number;
}

export interface AlertRecord {
  template: string;
  params: Record<string, string>;
  phase: "raised" | "cleared" | "once";
  /** The message as Homer last decided it, posted or not. */
  content: string;
  delivered: { content: string; at: number } | null;
  pending: Pending | null;
  /** When the phase last changed. */
  since: number;
}

export interface AlertState {
  version: 1;
  records: Record<string, AlertRecord>;
  /** When each message in the last hour was posted, oldest first. */
  window: number[];
  /** When the held-alert summary was last posted, if within the window. */
  summaryAt: number | null;
  /** The held-alert summary's retry, after a failed post. */
  summaryRetry: { attempts: number; nextAttemptAt: number } | null;
}

/** A message to sign and post now. */
export interface AlertDelivery {
  readonly key: string;
  readonly content: string;
}

export function emptyAlertState(): AlertState {
  return { version: 1, records: {}, window: [], summaryAt: null, summaryRetry: null };
}

function paramsOk(template: AlertTemplate, params: Readonly<Record<string, string>>): boolean {
  if (params === null || typeof params !== "object") return false;
  const names = Object.keys(template.params);
  const given = Object.keys(params);
  if (given.length !== names.length || !names.every((n) => Object.hasOwn(params, n))) return false;
  return names.every((name) => {
    const value = params[name];
    const kind = template.params[name]!;
    if (typeof value !== "string") return false;
    return typeof kind === "string" ? PATTERNS[kind].test(value) : kind.includes(value);
  });
}

/** The whole message: the template's sentence, the Alert Key and the runbook. */
function message(key: string, sentence: string, runbook: string): string {
  return `${sentence}\n\nAlert key: ${key}\nRunbook: ${runbook}`;
}

function enqueue(record: AlertRecord, content: string, now: number): void {
  record.content = content;
  if (record.delivered?.content === content) {
    // A change that reverted before it was posted: nothing to say.
    record.pending = null;
    return;
  }
  if (record.pending) record.pending.content = content;
  else record.pending = { content, queuedAt: now, attempts: 0, nextAttemptAt: now };
}

/**
 * Applies one monitor's current Alerts. `scope` is the Alert Key prefix the monitor owns, such
 * as `fleet:`: a raised Alert in that scope that the monitor no longer raises is cleared. An
 * Alert whose message has not changed queues nothing. Refused requests change nothing.
 */
export function applyAlerts(
  previous: AlertState,
  scope: string,
  requests: readonly AlertRequest[],
  templates: AlertTemplates,
  now: number,
  options: AlertApplyOptions = {},
): { state: AlertState; refused: { key: string; reason: AlertRefusal }[] } {
  const state = structuredClone(previous);
  const hold = (options.hold ?? []).filter((prefix) => prefix.startsWith(scope));
  const refused: { key: string; reason: AlertRefusal }[] = [];
  const seen = new Set<string>();
  for (const request of requests) {
    const key = typeof request?.key === "string" ? request.key : "";
    const template = Object.hasOwn(templates, request?.template)
      ? templates[request.template]
      : undefined;
    let reason: AlertRefusal | null = null;
    if (!ALERT_KEY.test(key)) reason = "invalid_key";
    else if (!key.startsWith(scope)) reason = "outside_scope";
    else if (seen.has(key)) reason = "duplicate_key";
    else if (!template) reason = "unknown_template";
    else if (!paramsOk(template, request.params)) reason = "invalid_params";
    if (reason || !template) {
      refused.push({ key, reason: reason ?? "unknown_template" });
      // A refused request is no news: an Alert already under its key stays as it is.
      if (reason !== "invalid_key" && reason !== "outside_scope") seen.add(key);
      continue;
    }
    seen.add(key);
    const params = { ...request.params };
    const content = message(key, template.raised(params), template.runbook);
    const record = state.records[key];
    if (!template.cleared) {
      // One-shot: one message per occurrence, whatever happens later.
      if (record) continue;
      const created: AlertRecord = {
        template: request.template,
        params,
        phase: "once",
        content,
        delivered: null,
        pending: null,
        since: now,
      };
      enqueue(created, content, now);
      state.records[key] = created;
      continue;
    }
    if (record && record.phase === "raised" && record.content === content) continue;
    const next: AlertRecord = record ?? {
      template: request.template,
      params,
      phase: "raised",
      content,
      delivered: null,
      pending: null,
      since: now,
    };
    if (next.phase !== "raised") next.since = now;
    next.template = request.template;
    next.params = params;
    next.phase = "raised";
    enqueue(next, content, now);
    state.records[key] = next;
  }
  for (const [key, record] of Object.entries(state.records)) {
    if (!key.startsWith(scope) || record.phase !== "raised" || seen.has(key)) continue;
    // The monitor cannot see this Alert's source now: no news is not a recovery.
    if (hold.some((prefix) => key.startsWith(prefix)) && !options.holdExcept?.includes(key))
      continue;
    const template = Object.hasOwn(templates, record.template)
      ? templates[record.template]
      : undefined;
    if (!template?.cleared) continue;
    // Raised and gone again before anything was posted: there is nothing to clear.
    if (record.delivered === null) {
      delete state.records[key];
      continue;
    }
    record.phase = "cleared";
    record.since = now;
    enqueue(record, message(key, template.cleared(record.params), template.runbook), now);
  }
  prune(state, now);
  return { state, refused };
}

function prune(state: AlertState, now: number): void {
  state.window = state.window.filter((at) => at > now - HOUR_MS);
  if (state.summaryAt !== null && state.summaryAt <= now - HOUR_MS) state.summaryAt = null;
  if (state.summaryRetry && state.summaryRetry.nextAttemptAt <= now - HOUR_MS)
    state.summaryRetry = null;
  for (const [key, record] of Object.entries(state.records)) {
    if (record.pending) continue;
    // A cleared Alert that was posted, or never needed posting, is finished.
    if (record.phase === "cleared") delete state.records[key];
    // A one-shot record is kept a week from its post, however long the post took.
    else if (
      record.phase === "once" &&
      (record.delivered?.at ?? record.since) <= now - ONE_SHOT_RETENTION_MS
    )
      delete state.records[key];
  }
}

/**
 * The messages to post now, oldest first, inside the hourly cap. When more are due than the
 * cap allows, the last free slot carries one summary saying how many are held, once an hour.
 * A held Alert stays queued and is posted, with its message as it is then, when the cap frees.
 */
export function dueAlerts(
  previous: AlertState,
  templates: AlertTemplates,
  now: number,
): AlertDelivery[] {
  const state = structuredClone(previous);
  prune(state, now);
  const free = Math.max(0, ALERTS_PER_HOUR - state.window.length);
  const due = Object.entries(state.records)
    .filter(([, r]) => r.pending && r.pending.nextAttemptAt <= now)
    .sort(([ka, a], [kb, b]) => a.pending!.queuedAt - b.pending!.queuedAt || (ka < kb ? -1 : 1))
    .map(([key, r]) => ({ key, content: r.pending!.content }));
  if (due.length <= free) return due;
  const summary = templates["homer.alerts_held"];
  if (free === 0 || state.summaryAt !== null || !summary) return due.slice(0, free);
  // A summary waiting out its backoff keeps its slot.
  if (state.summaryRetry && state.summaryRetry.nextAttemptAt > now) return due.slice(0, free - 1);
  const held = due.length - (free - 1);
  const params = { count: String(Math.min(held, 999_999)) };
  return [
    ...due.slice(0, free - 1),
    {
      key: HELD_ALERTS_KEY,
      content: message(HELD_ALERTS_KEY, summary.raised(params), summary.runbook),
    },
  ];
}

/** Records a posted message. A record whose message changed meanwhile stays queued. */
export function markDelivered(
  previous: AlertState,
  key: string,
  content: string,
  now: number,
): AlertState {
  const state = structuredClone(previous);
  state.window.push(now);
  if (key === HELD_ALERTS_KEY) {
    state.summaryAt = now;
    state.summaryRetry = null;
    return state;
  }
  const record = state.records[key];
  if (!record) return state;
  record.delivered = { content, at: now };
  if (record.pending?.content === content) record.pending = null;
  prune(state, now);
  return state;
}

/** Records a failed post: the message waits, longer after each failure. */
export function markFailed(previous: AlertState, key: string, now: number): AlertState {
  const state = structuredClone(previous);
  const retry =
    key === HELD_ALERTS_KEY
      ? (state.summaryRetry ??= { attempts: 0, nextAttemptAt: now })
      : state.records[key]?.pending;
  if (!retry) return state;
  retry.attempts += 1;
  const wait = ALERT_BACKOFF_MS[Math.min(retry.attempts, ALERT_BACKOFF_MS.length) - 1]!;
  retry.nextAttemptAt = now + wait;
  return state;
}

/** A Nostr event before signing: an `h`-tagged channel message, kind 9. */
export interface UnsignedChannelMessage {
  kind: 9;
  created_at: number;
  tags: [["h", string]];
  content: string;
}

/** The kind 9 message for one delivery, to the `homer` channel. Signing is the caller's. */
export function alertMessage(
  delivery: AlertDelivery,
  channel: string,
  createdAtSeconds: number,
): UnsignedChannelMessage {
  if (!UUID.test(channel)) throw new Error("invalid_channel");
  if (!Number.isSafeInteger(createdAtSeconds) || createdAtSeconds < 0)
    throw new Error("invalid_time");
  return {
    kind: 9,
    created_at: createdAtSeconds,
    tags: [["h", channel]],
    content: delivery.content,
  };
}
