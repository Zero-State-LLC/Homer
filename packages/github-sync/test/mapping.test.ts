import { describe, expect, it } from "vitest";
import { mapMergedPullRequest } from "../src/index.js";
import { comparisonDigest } from "../../event-ledger/src/canonical.js";

const context = {
  repositoryId: 123,
  repository: "Zero-State-LLC/example",
  projectId: "project:example",
  collectedAt: "2026-11-20T20:00:00Z",
};
function fixture() {
  return {
    id: 456,
    number: 7,
    state: "closed",
    merged: true,
    merged_at: "2026-11-19T12:34:56Z",
    merge_commit_sha: "a".repeat(40),
    html_url: "https://github.com/Zero-State-LLC/example/pull/7",
    base: { repo: { id: 123, full_name: "Zero-State-LLC/example" } },
    merged_by: { id: 789, login: "merge-bot[bot]" },
    user: { login: "author" },
    updated_at: "2026-11-20T19:00:00Z",
    title: "SECRET title",
    body: "SECRET body",
    actorId: "actor:forged",
  };
}
describe("GitHub merged PR mapping", () => {
  it("uses the merge account and source merge time without inferring identity", () => {
    const result = mapMergedPullRequest(fixture(), context);
    expect(result.outcome).toBe("mapped");
    if (result.outcome !== "mapped") throw new Error("mapping refused");
    expect(result.event.actor).toEqual({ sourceAccount: "github:merge-bot[bot]" });
    expect(result.event.occurredAt).toBe("2026-11-19T12:34:56Z");
    expect(result.event.eventKey).toBe(`github:pull_request.merged:123/456/${"a".repeat(40)}`);
    expect(result.event.projectId).toBe("project:example");
    expect(JSON.stringify(result.event)).not.toMatch(/SECRET|author|forged/);
  });
  it("keeps the ledger comparison digest stable across collection retries and title edits", () => {
    const a = mapMergedPullRequest(fixture(), context);
    const b = mapMergedPullRequest(
      { ...fixture(), title: "edited" },
      { ...context, collectedAt: "2026-11-21T00:00:00Z" },
    );
    if (a.outcome !== "mapped" || b.outcome !== "mapped") throw new Error("mapping refused");
    expect(a.event.eventKey).toBe(b.event.eventKey);
    expect(comparisonDigest(a.event)).toBe(comparisonDigest(b.event));
  });
  it("keeps the key through repository rename but exposes changed provenance as a conflict", () => {
    const a = mapMergedPullRequest(fixture(), context);
    const b = mapMergedPullRequest(
      {
        ...fixture(),
        base: { repo: { id: 123, full_name: "Zero-State-LLC/renamed" } },
        html_url: "https://github.com/Zero-State-LLC/renamed/pull/7",
      },
      { ...context, repository: "Zero-State-LLC/renamed" },
    );
    if (a.outcome !== "mapped" || b.outcome !== "mapped") throw new Error("mapping refused");
    expect(a.event.eventKey).toBe(b.event.eventKey);
    expect(comparisonDigest(a.event)).not.toBe(comparisonDigest(b.event));
  });
  it.each(["open", "closed"])("skips unmerged %s PRs", (state) => {
    expect(
      mapMergedPullRequest({ ...fixture(), state, merged: false, merged_at: null }, context),
    ).toEqual({ outcome: "skipped", reason: "not_merged" });
  });
  it.each([
    null,
    [],
    {},
    { state: "open" },
    { merged: false },
    { merged: undefined },
    { merged_at: null },
    { merged_at: "2026-02-30T12:00:00Z" },
    { merged_at: "2026-11-19T12:00:00+01:00" },
    { merge_commit_sha: "short" },
    { number: Number.MAX_SAFE_INTEGER + 1 },
    { id: 0 },
    { merged_by: null },
    { merged_by: { id: 1, login: "bad/name" } },
    { base: { repo: { id: 999, full_name: context.repository } } },
    { base: { repo: { id: 123, full_name: "Other/repo" } } },
    { html_url: "https://evil.example/pull/7" },
    { html_url: fixture().html_url + "?token=secret" },
  ])("refuses malformed or contradictory input %j", (patch) => {
    const input =
      patch && !Array.isArray(patch) && Object.keys(patch).length
        ? { ...fixture(), ...patch }
        : patch;
    expect(mapMergedPullRequest(input, context).outcome).toBe("refused");
  });
  it.each([
    { repositoryId: -1 },
    { repository: "Other/repo" },
    { projectId: "bad" },
    { collectedAt: "yesterday" },
  ])("refuses invalid context %j", (patch) => {
    expect(mapMergedPullRequest(fixture(), { ...context, ...patch }).outcome).toBe("refused");
  });
  it("returns detached data and leaves an unmapped Project absent", () => {
    const source = fixture();
    const unmapped = {
      repositoryId: context.repositoryId,
      repository: context.repository,
      collectedAt: context.collectedAt,
    };
    const result = mapMergedPullRequest(source, unmapped);
    if (result.outcome !== "mapped") throw new Error("mapping refused");
    source.merged_by.login = "changed";
    expect(result.event.actor.sourceAccount).toBe("github:merge-bot[bot]");
    expect(result.event).not.toHaveProperty("projectId");
  });
});
