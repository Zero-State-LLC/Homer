import { isRecord } from "./json.js";
import {
  RISK_TIER_QUESTION,
  type JevChoiceAnswer,
  type WorkRequestResult,
} from "./work-request-builder.js";

/**
 * Ask Jev, TypeSafe AI's decision model, for a Work Request's risk tier through
 * Cloudflare Workers AI (specs/work-requests/spec.md, "The risk-tier decision").
 *
 * The caller passes `fetch`, the account id and the API token. Neither the
 * token nor the account id ever appears in a refusal, and an HTTP failure never
 * echoes the response body or the URL, which holds the account id.
 */

/** The part of `fetch` this client uses, so tests can pass a stub. */
export type JevFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface AskJevOptions {
  fetch: JevFetch;
  /** The Cloudflare account id: 32 hexadecimal characters. */
  accountId: string;
  /** A Cloudflare API token allowed to run Workers AI. */
  apiToken: string;
  /** The policy's `riskDecider.model`, `typesafe/jev` for Homer. */
  model: string;
  /** The prepared request's `risk.state`. */
  state: string;
  /** Give up after this long. Default 15 seconds. */
  timeoutMs?: number;
}

const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const DEFAULT_TIMEOUT_MS = 15_000;

/** The URL and body Jev's REST endpoint expects, without the credential. */
export function jevRiskRequest(
  accountId: string,
  model: string,
  state: string,
): { url: string; body: string } {
  const { name, type, instructions, criteria } = RISK_TIER_QUESTION;
  return {
    url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`,
    body: JSON.stringify({
      model,
      input: { state, questions: { [name]: { type, instructions, criteria } } },
    }),
  };
}

/**
 * One call to Jev. Returns the normalized answer for `decideRiskTier`, or a
 * `risk_unavailable` refusal. It never retries and never picks a tier itself.
 */
export async function askJevForRiskTier(
  options: AskJevOptions,
): Promise<WorkRequestResult<JevChoiceAnswer>> {
  if (!ACCOUNT_ID.test(options.accountId) || options.apiToken.trim() === "") {
    return unavailable(
      "credentials",
      "The Cloudflare account id or API token is missing or malformed.",
    );
  }
  const { url, body } = jevRiskRequest(options.accountId, options.model, options.state);
  // A ref'd timer, not AbortSignal.timeout(), whose timer Node does not wait for,
  // so a hung call ends in a refusal instead of an exit with nothing printed.
  // It covers reading the body as well as the request.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let payload: unknown;
  try {
    let response: Awaited<ReturnType<JevFetch>>;
    try {
      response = await options.fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiToken}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controller.signal,
      });
    } catch {
      // The error may name the URL or carry the request; say only that it failed.
      return unavailable("request", "The Jev call failed or timed out before an answer.");
    }
    if (!response.ok) {
      return unavailable("response", `Jev returned HTTP ${String(response.status)}.`);
    }
    try {
      payload = await response.json();
    } catch {
      return unavailable("response", "Jev's response is not JSON, or it timed out.");
    }
  } finally {
    clearTimeout(timer);
  }
  return readJevRiskAnswer(payload);
}

/**
 * Read Jev's output, bare (`{ model, answers, usage }`) or in Cloudflare's REST
 * envelope (`{ success, result: { ... } }`), into a `JevChoiceAnswer`.
 */
export function readJevRiskAnswer(payload: unknown): WorkRequestResult<JevChoiceAnswer> {
  if (!isRecord(payload)) {
    return unavailable("response", "Jev's response is not an object.");
  }
  if (payload["success"] === false) {
    return unavailable("response", "Cloudflare reported the run as failed.");
  }
  const output = isRecord(payload["result"]) ? payload["result"] : payload;
  const answers = output["answers"];
  const answer = isRecord(answers) ? answers[RISK_TIER_QUESTION.name] : undefined;
  if (!isRecord(answer) || answer["type"] !== "choice") {
    return unavailable("response", "Jev's response has no choice answer for the risk question.");
  }
  const choice = answer["choice"];
  const confidence = answer["confidence"];
  if (typeof choice !== "string" || typeof confidence !== "number") {
    return unavailable("response", "Jev's answer has no choice or confidence.");
  }
  const probabilities = answer["probabilities"];
  const modelVersion = output["model"];
  return {
    ok: true,
    value: {
      choice,
      confidence,
      ...(isNumberRecord(probabilities) ? { probabilities } : {}),
      ...(typeof modelVersion === "string" && modelVersion !== "" ? { modelVersion } : {}),
    },
  };
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "number");
}

function unavailable(field: string, detail: string): WorkRequestResult<never> {
  return { ok: false, code: "risk_unavailable", field, detail };
}
