import { createHash } from "node:crypto";
import { isRecord } from "./json.js";
import type { RiskTier, WorkRequest } from "./types.js";

/**
 * The pure half of the Work Request emitter (specs/work-requests/spec.md).
 * It reads a raw Linear issue, GitHub issue or manual request file, admits or
 * refuses it, and derives every field of a Work Request. It does no I/O and has
 * no clock: the caller passes the risk-tier decision and the instant.
 *
 * Call order, matching the spec's "Retries and changed sources":
 * read -> admitWorkRequestSource -> workRequestId (store lookup happens here, in
 * the caller) -> prepareWorkRequest -> decideRiskTier -> finishWorkRequest.
 */

/** Why a source was refused. The names are the spec's reason codes. */
export type WorkRequestRefusalCode =
  | "acceptance_missing"
  | "policy_invalid"
  | "risk_unavailable"
  | "secret_in_source"
  | "source_canceled"
  | "source_closed"
  | "source_date_unknown"
  | "source_malformed"
  | "source_not_found"
  | "source_not_mapped"
  | "source_not_ready";

/** A refusal names the field that decided and never repeats its value. */
export interface WorkRequestRefusal {
  ok: false;
  code: WorkRequestRefusalCode;
  field: string;
  detail: string;
}

export type WorkRequestResult<T> = { ok: true; value: T } | WorkRequestRefusal;

export type WorkRequestSourceState = "open" | "done" | "canceled" | "closed" | "not_ready";

/** A source after reading, before admission and derivation. */
export interface WorkRequestSource {
  /**
   * The `source` value to emit. A GitHub owner and repository are lowercased,
   * because GitHub treats both case-insensitively; the slug hashes this value.
   */
  source: string;
  /** The source object's own date, `YYYY-MM-DD` in UTC. Never the emission date. */
  date: string;
  state: WorkRequestSourceState;
  title: string;
  /** The Markdown body. Empty for a manual request. */
  body: string;
  /** A Linear Project to map through the policy, or a repository named directly. */
  repository: { kind: "linearProject"; name: string } | { kind: "repository"; name: string };
  /** The creator's stable account: `linear:<id>`, `github:<login>`, or a manual file's `who`. */
  creatorAccount: string;
  /** The source's own `https://` URL, when it has one. */
  url?: string;
  /** A manual request states its pain and criteria in its reviewed file. */
  manual?: { pain: string; doneWhen: string[] };
}

export interface WorkRequestPolicy {
  schemaVersion: 1;
  revision: number;
  /** Linear Project name -> repository. */
  linearProjects: Record<string, string>;
  riskDecider: { model: string; minConfidence: number };
  repositories: Record<string, { riskFloor: RiskTier; budgetUsd: number; testCommand: string }>;
}

/** An Identity Binding found for a source account, or none. */
export type IdentityBindingLookup = (
  account: string,
) => { actorId: string; name: string } | undefined;

/** Every derived field except the risk tier and the requester. */
export interface PreparedWorkRequest {
  requestId: string;
  source: string;
  pain: string;
  who: string;
  doneWhen: string[];
  repository: string;
  budgetUsd: number;
  testCommand: string;
  links?: string[];
  /** What the risk-tier decision needs: the policy's floor and decider, and the text Jev reads. */
  risk: { floor: RiskTier; model: string; minConfidence: number; state: string };
}

export const RISK_TIERS: readonly RiskTier[] = ["low", "medium", "high"];

/**
 * The one `choice` question Jev answers, in Jev's question format: the keys of
 * `criteria` are the options. `high` is the upstream Work Packet schema's own
 * definition; `low` and `medium` are Homer's, in the words of CONTRIBUTING.md's
 * risk questions. Changing this text changes what Jev is asked, so it is
 * reviewed like policy.
 */
export const RISK_TIER_QUESTION = {
  name: "risk_tier",
  type: "choice",
  instructions:
    "Which risk tier fits the change this request asks for? Judge the work described, not how it is written.",
  criteria: {
    low: "A contained change: one package or screen, undone by a revert, and none of the high-tier areas.",
    medium:
      "Touches something shared, such as a contract, a workflow, the Event Ledger or a stored data format, or is hard to undo, but none of the high-tier areas.",
    high: "Touches auth, money, secrets, data deletion, or prod infra.",
  },
} as const;

/** Jev's answer to the risk question, as the Jev client normalizes it. */
export interface JevChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities?: Record<string, number>;
  /** The Jev release that answered, as Jev reports it (`jev-1.13.0`). */
  modelVersion?: string;
}

/** What is recorded beside the request as `<requestId>.risk.json`, minus the instant. */
export interface RiskDecision {
  model: string;
  /** The Jev release that answered, when Jev reported one. */
  modelVersion?: string;
  choice: RiskTier;
  confidence: number;
  probabilities?: Record<string, number>;
  floor: RiskTier;
  minConfidence: number;
  tier: RiskTier;
}

const SLUG_MAX = 48;
const SLUG_PREFIX_WHEN_HASHED = 39;
const PAIN_MAX = 600;
const PAIN_MIN = 10;
const DONE_WHEN_ITEM_MIN = 5;
/**
 * Jev's context is 32,000 tokens; this keeps the state well inside it. Longer
 * text is refused, never cut, so Jev always reads every criterion it rates.
 */
const RISK_STATE_MAX = 24_000;

const LINEAR_IDENTIFIER = /^ZER-[0-9]+$/;
const DONE_WHEN_HEADING = /^#{1,6}\s+(done when|observable done)\s*:?\s*$/i;
const GITHUB_SOURCE = /^github:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)#([0-9]+)$/;
const MANUAL_SLUG = /^[a-z0-9-]+$/;
const REPOSITORY = /^Zero-State-LLC\/[A-Za-z0-9._-]+$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUESTER = /^agent:[A-Za-z0-9._-]+$/;
const HTTPS_URL = /^https:\/\/\S+$/;

/**
 * Secret shapes refused in source text. A fixed list keeps the derivation
 * deterministic: the same source always gives the same answer.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36,}/,
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{22,}/,
  /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![0-9A-Z])/,
  /(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/,
  /(?<![A-Za-z0-9_])lin_api_[A-Za-z0-9]{20,}/,
  /(?<![A-Za-z0-9_])ops_[A-Za-z0-9_-]{40,}/,
  /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}/,
  /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

/** Read a Linear issue as the Linear API returns it. */
export function readLinearIssue(raw: unknown): WorkRequestResult<WorkRequestSource> {
  if (!isRecord(raw)) {
    return refuse("source_malformed", "issue", "The Linear issue is not an object.");
  }
  const identifier = raw["identifier"];
  if (typeof identifier !== "string" || !LINEAR_IDENTIFIER.test(identifier)) {
    return refuse("source_malformed", "identifier", "The identifier is not a ZER Task.");
  }
  const title = nonEmptyString(raw["title"]);
  if (title === undefined) {
    return refuse("source_malformed", "title", "The Task has no title.");
  }
  const body = optionalText(raw["description"]);
  if (body === undefined) {
    return refuse("source_malformed", "description", "The description is not text.");
  }
  const date = utcDateOf(raw["createdAt"]);
  if (date === undefined) {
    return refuse(
      "source_date_unknown",
      "createdAt",
      "The creation date is missing or unparseable.",
    );
  }
  const state = raw["state"];
  if (!isRecord(state) || typeof state["type"] !== "string") {
    return refuse("source_malformed", "state.type", "The Task has no state type.");
  }
  const project = raw["project"];
  let projectName = "";
  if (project !== null && project !== undefined) {
    if (!isRecord(project) || typeof project["name"] !== "string") {
      return refuse("source_malformed", "project.name", "The Project has no name.");
    }
    projectName = project["name"];
  }
  const creator = raw["creator"];
  const creatorId = isRecord(creator) ? nonEmptyString(creator["id"]) : undefined;
  if (creatorId === undefined) {
    return refuse("source_malformed", "creator.id", "The Task has no creator.");
  }
  const url = urlOf(raw["url"]);
  if (url === false) {
    return refuse("source_malformed", "url", "The URL is not https.");
  }
  return ok({
    source: `linear:${identifier}`,
    date,
    state: linearState(state["type"]),
    title,
    body,
    repository: { kind: "linearProject", name: projectName },
    creatorAccount: `linear:${creatorId}`,
    ...(url === undefined ? {} : { url }),
  });
}

/** Read a GitHub issue as the REST API returns it, for the source that named it. */
export function readGitHubIssue(
  source: string,
  raw: unknown,
): WorkRequestResult<WorkRequestSource> {
  const match = GITHUB_SOURCE.exec(source);
  if (match === null) {
    return refuse("source_malformed", "source", "The source is not a GitHub issue reference.");
  }
  const [, owner = "", repo = "", numberText = ""] = match;
  if (!isRecord(raw)) {
    return refuse("source_malformed", "issue", "The GitHub issue is not an object.");
  }
  if (raw["pull_request"] !== undefined) {
    return refuse("source_not_found", "number", "The number names a pull request, not an issue.");
  }
  if (raw["number"] !== Number(numberText)) {
    return refuse("source_not_found", "number", "The response is for a different issue.");
  }
  const repositoryUrl = raw["repository_url"];
  const expectedSuffix = `/repos/${owner}/${repo}`.toLowerCase();
  if (typeof repositoryUrl !== "string" || !repositoryUrl.toLowerCase().endsWith(expectedSuffix)) {
    return refuse(
      "source_not_found",
      "repository_url",
      "The response is for a different repository.",
    );
  }
  const title = nonEmptyString(raw["title"]);
  if (title === undefined) {
    return refuse("source_malformed", "title", "The issue has no title.");
  }
  const body = optionalText(raw["body"]);
  if (body === undefined) {
    return refuse("source_malformed", "body", "The body is not text.");
  }
  const date = utcDateOf(raw["created_at"]);
  if (date === undefined) {
    return refuse(
      "source_date_unknown",
      "created_at",
      "The creation date is missing or unparseable.",
    );
  }
  const stateText = raw["state"];
  if (stateText !== "open" && stateText !== "closed") {
    return refuse("source_malformed", "state", "The issue state is neither open nor closed.");
  }
  const user = raw["user"];
  const login = isRecord(user) ? nonEmptyString(user["login"]) : undefined;
  if (login === undefined) {
    return refuse("source_malformed", "user.login", "The issue has no author.");
  }
  const url = urlOf(raw["html_url"]);
  if (url === false) {
    return refuse("source_malformed", "html_url", "The URL is not https.");
  }
  return ok({
    source: `github:${owner.toLowerCase()}/${repo.toLowerCase()}#${numberText}`,
    date,
    state: stateText === "open" ? "open" : "closed",
    title,
    body,
    repository: { kind: "repository", name: `${owner}/${repo}` },
    creatorAccount: `github:${login}`,
    ...(url === undefined ? {} : { url }),
  });
}

/** Read a reviewed manual request file, `docs/work-requests/<slug>.json`. */
export function readManualRequest(
  slug: string,
  raw: unknown,
): WorkRequestResult<WorkRequestSource> {
  if (!MANUAL_SLUG.test(slug)) {
    return refuse(
      "source_malformed",
      "slug",
      "The slug is not lowercase letters, digits and hyphens.",
    );
  }
  if (!isRecord(raw)) {
    return refuse("source_malformed", "file", "The manual request is not an object.");
  }
  const dateText = raw["date"];
  if (typeof dateText !== "string" || !isCalendarDate(dateText)) {
    return refuse("source_date_unknown", "date", "The date is missing or not YYYY-MM-DD.");
  }
  const repository = nonEmptyString(raw["repository"]);
  if (repository === undefined) {
    return refuse("source_malformed", "repository", "The repository is missing.");
  }
  const title = nonEmptyString(raw["title"]);
  if (title === undefined) {
    return refuse("source_malformed", "title", "The title is missing.");
  }
  const pain = nonEmptyString(raw["pain"]);
  if (pain === undefined) {
    return refuse("source_malformed", "pain", "The pain is missing.");
  }
  const who = nonEmptyString(raw["who"]);
  if (who === undefined) {
    return refuse("source_malformed", "who", "The who is missing.");
  }
  const doneWhen = raw["doneWhen"];
  if (!isStringArray(doneWhen)) {
    return refuse("source_malformed", "doneWhen", "The doneWhen is not a list of text.");
  }
  return ok({
    source: `manual:${slug}`,
    date: dateText,
    state: "open",
    title,
    body: "",
    repository: { kind: "repository", name: repository },
    creatorAccount: who,
    manual: { pain, doneWhen },
  });
}

/**
 * Refuse a source whose work is not live. This runs before the store lookup and
 * holds with or without a recorded request: a recorded request stands when its
 * source is edited, not when its work is canceled.
 */
export function admitWorkRequestSource(
  source: WorkRequestSource,
): WorkRequestResult<WorkRequestSource> {
  switch (source.state) {
    case "open":
    case "done":
      return ok(source);
    case "canceled":
      return refuse("source_canceled", "state", "The Task is canceled or a duplicate.");
    case "closed":
      return refuse("source_closed", "state", "The issue is closed.");
    case "not_ready":
      return refuse("source_not_ready", "state", "The Task is in Triage or an unknown state.");
  }
}

/**
 * The slug of a source, by the spec's encoding. The encoding is exact when no
 * character was replaced and the form fits in 48 characters; otherwise the slug
 * is the form's first 39 characters, `-`, and 8 hex characters of sha256(source).
 */
export function workRequestSlug(source: string): string {
  let form: string;
  let replaced = false;
  if (source.startsWith("linear:")) {
    form = source.slice("linear:".length).toLowerCase();
  } else if (source.startsWith("manual:")) {
    form = `manual-${source.slice("manual:".length)}`;
  } else {
    const match = GITHUB_SOURCE.exec(source);
    if (match === null) {
      throw new Error("workRequestSlug needs a linear, github or manual source");
    }
    const [, owner = "", repo = "", issue = ""] = match;
    const raw = `github-${owner.toLowerCase()}-${repo.toLowerCase()}-issue-${issue}`;
    form = raw.replace(/[^a-z0-9-]/g, "-");
    replaced = form !== raw;
  }
  if (!replaced && form.length <= SLUG_MAX) {
    return form;
  }
  const hash = createHash("sha256").update(source, "utf8").digest("hex").slice(0, 8);
  return `${form.slice(0, SLUG_PREFIX_WHEN_HASHED)}-${hash}`;
}

/** `WR-<source date>-<slug>`. The date is the source's, so a retry keeps the id. */
export function workRequestId(source: Pick<WorkRequestSource, "source" | "date">): string {
  return `WR-${source.date}-${workRequestSlug(source.source)}`;
}

/** Read `docs/work-requests/policy.json`. Anything off refuses; there are no defaults. */
export function readWorkRequestPolicy(raw: unknown): WorkRequestResult<WorkRequestPolicy> {
  if (!isRecord(raw)) {
    return refuse("policy_invalid", "policy", "The policy is not an object.");
  }
  if (raw["schemaVersion"] !== 1) {
    return refuse("policy_invalid", "schemaVersion", "The policy schemaVersion is not 1.");
  }
  const revision = raw["revision"];
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
    return refuse("policy_invalid", "revision", "The policy revision is not a positive integer.");
  }
  const decider = raw["riskDecider"];
  const model = isRecord(decider) ? nonEmptyString(decider["model"]) : undefined;
  const minConfidence = isRecord(decider) ? decider["minConfidence"] : undefined;
  if (
    model === undefined ||
    typeof minConfidence !== "number" ||
    !(minConfidence > 0 && minConfidence <= 1)
  ) {
    return refuse(
      "policy_invalid",
      "riskDecider",
      "riskDecider needs a model and a minConfidence in (0, 1].",
    );
  }
  const repositoriesRaw = raw["repositories"];
  if (!isRecord(repositoriesRaw) || Object.keys(repositoriesRaw).length === 0) {
    return refuse("policy_invalid", "repositories", "The policy names no repository.");
  }
  const repositories: WorkRequestPolicy["repositories"] = {};
  for (const [name, entry] of Object.entries(repositoriesRaw)) {
    const field = `repositories.${name}`;
    if (!REPOSITORY.test(name) || !isRecord(entry)) {
      return refuse("policy_invalid", field, "A repository entry is malformed.");
    }
    const floor = entry["riskFloor"];
    const budget = entry["budgetUsd"];
    const testCommand = entry["testCommand"];
    if (!isRiskTier(floor)) {
      return refuse(
        "policy_invalid",
        `${field}.riskFloor`,
        "riskFloor is not low, medium or high.",
      );
    }
    if (typeof budget !== "number" || !(budget > 0 && budget <= 500)) {
      return refuse(
        "policy_invalid",
        `${field}.budgetUsd`,
        "budgetUsd is not above 0 and at most 500.",
      );
    }
    if (typeof testCommand !== "string" || !isShellWrapped(testCommand)) {
      return refuse(
        "policy_invalid",
        `${field}.testCommand`,
        "testCommand is not wrapped in bash -c '...'.",
      );
    }
    repositories[name] = { riskFloor: floor, budgetUsd: budget, testCommand };
  }
  const projectsRaw = raw["linearProjects"];
  if (!isRecord(projectsRaw)) {
    return refuse("policy_invalid", "linearProjects", "linearProjects is not an object.");
  }
  const linearProjects: Record<string, string> = {};
  for (const [project, repository] of Object.entries(projectsRaw)) {
    if (typeof repository !== "string" || repositories[repository] === undefined) {
      return refuse(
        "policy_invalid",
        `linearProjects.${project}`,
        "A Project maps to a repository the policy does not list.",
      );
    }
    linearProjects[project] = repository;
  }
  return ok({
    schemaVersion: 1,
    revision,
    linearProjects,
    riskDecider: { model, minConfidence },
    repositories,
  });
}

/**
 * The list items under the first heading named `Done when` or `Observable done`,
 * at any level, outside fenced code: an example in a code block is never a
 * criterion. Each item is trimmed and stripped of control characters; items
 * shorter than five characters and duplicates are dropped, in order.
 */
export function extractDoneWhen(markdown: string): string[] {
  const items: string[] = [];
  let collecting = false;
  let fence: string | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    const fenceOpen = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
    if (fence !== undefined) {
      if (
        fenceOpen !== undefined &&
        fenceOpen[0] === fence[0] &&
        fenceOpen.length >= fence.length
      ) {
        fence = undefined;
      }
      continue;
    }
    if (fenceOpen !== undefined) {
      fence = fenceOpen;
      continue;
    }
    if (!collecting) {
      collecting = DONE_WHEN_HEADING.test(trimmed);
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed) || isCollapsibleMarker(trimmed)) {
      break;
    }
    const item = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(trimmed);
    if (item !== null) {
      items.push(item[1] ?? "");
      continue;
    }
    const last = items.length - 1;
    if (trimmed !== "" && /^\s{2,}/.test(line) && last >= 0) {
      items[last] = `${items[last] ?? ""} ${trimmed}`;
    }
  }
  return cleanItems(items);
}

/**
 * `<title>: <first paragraph>`, the first paragraph being the body's text before
 * its first heading or list; the title alone when there is none. At most 600
 * characters, cut at a word boundary.
 */
export function derivePain(title: string, markdown: string): string {
  const paragraph: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (paragraph.length > 0) break;
      continue;
    }
    if (
      /^#{1,6}\s/.test(trimmed) ||
      /^(?:[-*+]|\d+[.)])\s/.test(trimmed) ||
      trimmed.startsWith("```") ||
      isCollapsibleMarker(trimmed)
    ) {
      break;
    }
    paragraph.push(trimmed);
  }
  const titleText = collapse(title);
  const first = collapse(paragraph.join(" "));
  return cutAtWord(first === "" ? titleText : `${titleText}: ${first}`, PAIN_MAX);
}

/**
 * Derive every field except the risk tier and the requester. The caller has
 * already admitted the source. Secret-shaped text is refused before anything is
 * derived, so nothing holding it leaves the machine.
 */
export function prepareWorkRequest(
  source: WorkRequestSource,
  policy: WorkRequestPolicy,
  bindings: IdentityBindingLookup,
): WorkRequestResult<PreparedWorkRequest> {
  const texts: Record<string, string> = { title: source.title, body: source.body };
  if (source.manual !== undefined) {
    texts["pain"] = source.manual.pain;
    texts["who"] = source.creatorAccount;
    texts["doneWhen"] = source.manual.doneWhen.join("\n");
  }
  for (const [field, text] of Object.entries(texts)) {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
      return refuse(
        "secret_in_source",
        field,
        "The text holds a secret-shaped string; remove it from the source.",
      );
    }
  }

  const repository = mapRepository(source, policy);
  if (repository === undefined) {
    return refuse(
      "source_not_mapped",
      "repository",
      "The policy maps no repository for this source.",
    );
  }
  const entry = policy.repositories[repository];
  if (entry === undefined) {
    return refuse(
      "source_not_mapped",
      "repository",
      "The policy maps no repository for this source.",
    );
  }

  const doneWhen =
    source.manual === undefined ? extractDoneWhen(source.body) : cleanItems(source.manual.doneWhen);
  if (doneWhen.length === 0) {
    return refuse("acceptance_missing", "doneWhen", "No Done when or Observable done items.");
  }

  const pain =
    source.manual === undefined
      ? derivePain(source.title, source.body)
      : cutAtWord(collapse(source.manual.pain), PAIN_MAX);
  if (pain.length < PAIN_MIN) {
    return refuse("source_malformed", "pain", "The pain is shorter than 10 characters.");
  }

  const who = bindings(source.creatorAccount)?.name ?? source.creatorAccount;
  if (collapse(who).length < 2) {
    return refuse("source_malformed", "who", "The creator has no usable account.");
  }

  // Title and criteria first, then the body: Jev rates the work the packet asks for.
  const criteria = doneWhen.map((item) => `- ${item}`).join("\n");
  const rest = source.manual === undefined ? source.body : source.manual.pain;
  const state = `${source.title}\n\nDone when:\n${criteria}\n\n${rest}`;
  if (state.length > RISK_STATE_MAX) {
    return refuse(
      "risk_unavailable",
      "body",
      "The source is too long for the risk decision; shorten it rather than lose part of it.",
    );
  }

  return ok({
    requestId: workRequestId(source),
    source: source.source,
    pain,
    who: collapse(who),
    doneWhen,
    repository,
    budgetUsd: entry.budgetUsd,
    testCommand: entry.testCommand,
    ...(source.url === undefined ? {} : { links: [source.url] }),
    risk: {
      floor: entry.riskFloor,
      model: policy.riskDecider.model,
      minConfidence: policy.riskDecider.minConfidence,
      state,
    },
  });
}

/**
 * Turn Jev's answer into a tier. An answer below `minConfidence` goes one tier
 * higher, and the result is never below the floor. An answer that is not a known
 * tier with a confidence in [0, 1] is refused; there is no fallback tier.
 */
export function decideRiskTier(
  answer: unknown,
  risk: PreparedWorkRequest["risk"],
): WorkRequestResult<RiskDecision> {
  if (!isRecord(answer)) {
    return refuse("risk_unavailable", "risk_tier", "Jev gave no answer.");
  }
  const choice = answer["choice"];
  const confidence = answer["confidence"];
  if (!isRiskTier(choice)) {
    return refuse("risk_unavailable", "risk_tier", "Jev's choice is not low, medium or high.");
  }
  if (typeof confidence !== "number" || !(confidence >= 0 && confidence <= 1)) {
    return refuse(
      "risk_unavailable",
      "risk_tier",
      "Jev's confidence is missing or outside 0 to 1.",
    );
  }
  const probabilities = numberRecord(answer["probabilities"]);
  const modelVersion = nonEmptyString(answer["modelVersion"]);
  let tierIndex = RISK_TIERS.indexOf(choice);
  if (confidence < risk.minConfidence) {
    tierIndex = Math.min(tierIndex + 1, RISK_TIERS.length - 1);
  }
  tierIndex = Math.max(tierIndex, RISK_TIERS.indexOf(risk.floor));
  const tier = RISK_TIERS[tierIndex] ?? "high";
  return ok({
    model: risk.model,
    ...(modelVersion === undefined ? {} : { modelVersion }),
    choice,
    confidence,
    ...(probabilities === undefined ? {} : { probabilities }),
    floor: risk.floor,
    minConfidence: risk.minConfidence,
    tier,
  });
}

/**
 * Assemble the Work Request. `requesterAccount` is the emitting Agent,
 * `agent:<name>`; its `actorId` comes only from an Identity Binding.
 */
export function finishWorkRequest(
  prepared: PreparedWorkRequest,
  decision: RiskDecision,
  requesterAccount: string,
  bindings: IdentityBindingLookup,
  now: Date,
): WorkRequest {
  if (!REQUESTER.test(requesterAccount)) {
    throw new Error("requesterAccount must be agent:<name>");
  }
  if (Number.isNaN(now.getTime())) {
    throw new Error("now must be a valid Date");
  }
  const actorId = bindings(requesterAccount)?.actorId;
  return {
    contract: "home.work-request/v1",
    requestId: prepared.requestId,
    source: prepared.source,
    pain: prepared.pain,
    who: prepared.who,
    doneWhen: prepared.doneWhen,
    repository: prepared.repository,
    riskTier: decision.tier,
    budgetUsd: prepared.budgetUsd,
    requestedBy: { sourceAccount: requesterAccount, ...(actorId === undefined ? {} : { actorId }) },
    requestedAt: now.toISOString(),
    testCommand: prepared.testCommand,
    ...(prepared.links === undefined ? {} : { links: prepared.links }),
  };
}

/**
 * The top-level Work Packet fields that differ between two packets, sorted. A
 * retry compares packets, so `contract`, `requestedAt` and `requestedBy`, which
 * never reach a packet, cannot make a Duplicate look changed.
 */
export function changedPacketFields(recorded: object, derived: object): string[] {
  const left = recorded as Record<string, unknown>;
  const right = derived as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].filter((key) => canonicalJson(left[key]) !== canonicalJson(right[key])).sort();
}

function mapRepository(source: WorkRequestSource, policy: WorkRequestPolicy): string | undefined {
  if (source.repository.kind === "linearProject") {
    return policy.linearProjects[source.repository.name];
  }
  const wanted = source.repository.name.toLowerCase();
  return Object.keys(policy.repositories).find((name) => name.toLowerCase() === wanted);
}

function linearState(type: string): WorkRequestSourceState {
  switch (type) {
    case "backlog":
    case "unstarted":
    case "started":
      return "open";
    case "completed":
      return "done";
    case "canceled":
    case "duplicate":
      return "canceled";
    default:
      return "not_ready";
  }
}

function utcDateOf(value: unknown): string | undefined {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) {
    return undefined;
  }
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? undefined : instant.toISOString().slice(0, 10);
}

function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE.test(value)) {
    return false;
  }
  const instant = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function optionalText(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : undefined;
}

/** `undefined` when absent, `false` when present but not https. */
function urlOf(value: unknown): string | undefined | false {
  if (value === null || value === undefined) {
    return undefined;
  }
  return typeof value === "string" && HTTPS_URL.test(value) ? value : false;
}

function isRiskTier(value: unknown): value is RiskTier {
  return value === "low" || value === "medium" || value === "high";
}

function isShellWrapped(command: string): boolean {
  return (
    command.startsWith("bash -c '") && command.endsWith("'") && command.length > "bash -c ''".length
  );
}

function isCollapsibleMarker(trimmed: string): boolean {
  return trimmed.startsWith(">>>") || trimmed.startsWith("+++");
}

/** Control characters become spaces, then whitespace collapses. */
function collapse(text: string): string {
  let visible = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    visible += code < 0x20 || code === 0x7f ? " " : character;
  }
  return visible.replace(/\s+/g, " ").trim();
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function cleanItems(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const clean = collapse(item);
    if (clean.length >= DONE_WHEN_ITEM_MIN && !seen.has(clean)) {
      seen.add(clean);
      result.push(clean);
    }
  }
  return result;
}

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

function numberRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      return undefined;
    }
    result[key] = entry;
  }
  return result;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function ok<T>(value: T): WorkRequestResult<T> {
  return { ok: true, value };
}

function refuse(code: WorkRequestRefusalCode, field: string, detail: string): WorkRequestRefusal {
  return { ok: false, code, field, detail };
}
