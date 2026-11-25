import { expect, it } from "vitest";
import { BUILD_VERSION } from "@zs-home/shared-contracts/workers";
import {
  enrichWorkflowJob,
  mapWorkflowJobWebhook,
  type GitHubJobContext,
  type GitHubJobObservation,
} from "../src/workflow-job.js";

const repository = { id: 123, full_name: "Zero-State-LLC/Homer" };
const headSha = "a".repeat(40);
const ctx: GitHubJobContext = {
  repositoryId: repository.id,
  repository: repository.full_name,
  collectedAt: "2026-11-22T20:00:00Z",
  deliveryId: "synthetic-delivery",
};
function payload(action: "queued" | "in_progress" | "completed" = "completed") {
  return {
    action,
    repository,
    sender: { id: 999, login: "not-the-original-actor" },
    workflow_job: {
      id: 101,
      run_id: 202,
      name: "CI / build",
      status: action,
      conclusion: action === "completed" ? "success" : null,
      head_sha: headSha,
      runner_id: action === "queued" ? null : 555,
      runner_group_id: action === "queued" ? null : 7,
      created_at: "2026-11-22T19:00:00Z",
      started_at: action === "queued" ? null : "2026-11-22T19:00:10Z",
      completed_at: action === "completed" ? "2026-11-22T19:00:30Z" : null,
      html_url: "https://github.com/Zero-State-LLC/Homer/actions/runs/202/job/101",
      steps: [{ name: "private command", env: { TOKEN: "synthetic-private" } }],
    },
  };
}
function run() {
  return {
    id: 202,
    run_attempt: 2,
    workflow_id: 303,
    repository,
    head_sha: headSha,
    actor: { id: 10, login: "original-human" },
    triggering_actor: { id: 20, login: "rerun-human" },
  };
}
function job() {
  return {
    id: 101,
    run_id: 202,
    run_attempt: 2,
    status: "completed",
    conclusion: "success",
    runner_id: 555,
    runner_group_id: 7,
    created_at: "2026-11-22T19:00:00Z",
    started_at: "2026-11-22T19:00:10Z",
    completed_at: "2026-11-22T19:00:30Z",
  };
}
function mapped(p: unknown = payload()): GitHubJobObservation {
  const outcome = mapWorkflowJobWebhook(p, ctx);
  expect(outcome.outcome).toBe("mapped");
  if (outcome.outcome !== "mapped") throw new Error("expected_fixture_mapping");
  return outcome.observation;
}
it("maps the exact job to a bounded evidence link and does not trust the sender", () => {
  const input = payload();
  const snapshot = structuredClone(input);
  const evidence = mapped(input);
  expect(evidence).toMatchObject({
    version: 1,
    repositoryId: 123,
    workflowRunId: 202,
    jobId: 101,
    runAttempt: null,
    workflowId: null,
    status: "completed",
    runnerId: 555,
    originalActor: null,
    triggeringActor: null,
    provenance: {
      sourceSystem: "github",
      sourceObjectId: "101",
      collector: "homer-github-workflow-job",
      collectorVersion: BUILD_VERSION,
      deliveryId: "synthetic-delivery",
    },
  });
  expect(evidence.evidenceUrl).toBe(
    "https://github.com/Zero-State-LLC/Homer/actions/runs/202/job/101",
  );
  const json = JSON.stringify(evidence);
  expect(json).not.toContain("not-the-original-actor");
  expect(json).not.toContain("private command");
  expect(json).not.toContain("synthetic-private");
  expect(input).toEqual(snapshot);
});
it("maps all three job transitions without fabricating completion or job assignment", () => {
  for (const phase of ["queued", "in_progress", "completed"] as const) {
    const result = mapWorkflowJobWebhook(payload(phase), ctx);
    expect(result.outcome).toBe("mapped");
    if (result.outcome !== "mapped") continue;
    expect(result.observation.status).toBe(phase);
    expect(result.observation.completedAt).toBe(
      phase === "completed" ? "2026-11-22T19:00:30Z" : null,
    );
    if (phase === "queued") expect(result.observation.runnerId).toBeNull();
  }
});
it("refuses repository substitutions, incorrect context and hostile job URLs", () => {
  const input = payload();
  expect(
    mapWorkflowJobWebhook(
      { ...input, repository: { id: 999, full_name: repository.full_name } },
      ctx,
    ),
  ).toMatchObject({
    outcome: "refused",
    reason: "repository_mismatch",
  });
  expect(mapWorkflowJobWebhook(input, { ...ctx, deliveryId: "bad\nnewline" })).toMatchObject({
    outcome: "refused",
    reason: "invalid_context",
  });
  expect(
    mapWorkflowJobWebhook(
      {
        ...input,
        workflow_job: { ...input.workflow_job, html_url: "https://github.com.evil.test/job" },
      },
      ctx,
    ),
  ).toMatchObject({ outcome: "refused", reason: "job_url_mismatch" });
});
it("rejects malformed timestamps, invalid IDs, unsafe text, and contradictory state", () => {
  const input = payload();
  const badJobs = [
    { id: Number.MAX_SAFE_INTEGER + 1 },
    { name: "unsafe\njob" },
    { status: "queued" },
    { started_at: "2026-02-30T19:00:10Z" },
    { runner_id: -1 },
    { conclusion: "private-status" },
    { completed_at: null },
    { run_attempt: -1 },
  ];
  for (const changes of badJobs)
    expect(
      mapWorkflowJobWebhook(
        {
          ...input,
          workflow_job: { ...input.workflow_job, ...changes },
        },
        ctx,
      ).outcome,
    ).toBe("refused");
  expect(mapWorkflowJobWebhook({ ...input, action: "waiting" }, ctx)).toEqual({
    outcome: "ignored",
    reason: "unsupported_action",
  });
});
it("does not mistake a workflow trigger for the person who performed work", () => {
  const before = mapped();
  const input = run();
  const output = enrichWorkflowJob(before, input, job());
  expect(output.outcome).toBe("enriched");
  if (output.outcome !== "enriched") return;
  expect(output.observation).toMatchObject({
    runAttempt: 2,
    workflowId: 303,
    originalActor: { id: 10, login: "original-human" },
    triggeringActor: { id: 20, login: "rerun-human" },
  });
  expect(JSON.stringify(output.observation)).not.toContain("actorId");
  expect(before.originalActor).toBeNull();
  expect(before.runAttempt).toBeNull();
  expect(input).toEqual(run());
});
it("supports a missing actor without inventing one", () => {
  const outcome = enrichWorkflowJob(
    mapped(),
    { ...run(), actor: null, triggering_actor: null },
    job(),
  );
  expect(outcome).toMatchObject({
    outcome: "enriched",
    observation: { originalActor: null, triggeringActor: null },
  });
});
it("never attributes from a display name when a provider ID is missing", () => {
  const result = enrichWorkflowJob(
    mapped(),
    {
      ...run(),
      actor: { login: "some-display-name" },
    },
    job(),
  );
  expect(result).toEqual({ outcome: "refused", reason: "invalid_enrichment_actor" });
});
it("refuses a mismatched repo/run/job/attempt before creating enrichment", () => {
  const before = mapped();
  const wrong = [
    [{ ...run(), repository: { ...repository, id: 777 } }, job()],
    [{ ...run(), id: 777 }, job()],
    [run(), { ...job(), id: 777 }],
    [run(), { ...job(), run_id: 777 }],
    [{ ...run(), run_attempt: 0 }, job()],
  ] as const;
  for (const [r, j] of wrong)
    expect(enrichWorkflowJob(before, r, j)).toMatchObject({
      outcome: "refused",
      reason: "enrichment_identity_mismatch",
    });
  expect(enrichWorkflowJob(before, run(), { ...job(), run_attempt: 1 })).toEqual({
    outcome: "refused",
    reason: "enrichment_attempt_mismatch",
  });
});
it("rejects explicit webhook attempt disagreement with the run", () => {
  const p = payload();
  const evidence = mapped({
    ...p,
    workflow_job: { ...p.workflow_job, run_attempt: 1 },
  });
  expect(enrichWorkflowJob(evidence, run(), job())).toEqual({
    outcome: "refused",
    reason: "enrichment_attempt_mismatch",
  });
});
it("refuses conflicting GitHub runner identity, head SHA and invalid run actors", () => {
  expect(enrichWorkflowJob(mapped(), run(), { ...job(), runner_id: 2 })).toEqual({
    outcome: "refused",
    reason: "enrichment_runner_mismatch",
  });
  expect(enrichWorkflowJob(mapped(), { ...run(), head_sha: "b".repeat(40) }, job())).toEqual({
    outcome: "refused",
    reason: "enrichment_sha_mismatch",
  });
  expect(
    enrichWorkflowJob(
      mapped(),
      { ...run(), triggering_actor: { id: 20, login: "bad\nname" } },
      job(),
    ),
  ).toEqual({
    outcome: "refused",
    reason: "invalid_enrichment_actor",
  });
});
it("does not replace webhook source timestamps with an API read", () => {
  const evidence = mapped();
  const api = { ...job(), completed_at: "2026-11-22T19:00:31Z" };
  const result = enrichWorkflowJob(evidence, run(), api);
  expect(result).toMatchObject({
    outcome: "enriched",
    observation: { completedAt: "2026-11-22T19:00:30Z" },
  });
});
it("refuses invalid API timestamps and unrecognized API states", () => {
  expect(enrichWorkflowJob(mapped(), run(), { ...job(), completed_at: "invalid" })).toEqual({
    outcome: "refused",
    reason: "invalid_enrichment_timestamps",
  });
  expect(enrichWorkflowJob(mapped(), run(), { ...job(), status: "working" })).toEqual({
    outcome: "refused",
    reason: "invalid_enrichment_status",
  });
});
it("treats GitHub's unassigned runner id 0 as Unknown, and still refuses a negative one", () => {
  const p = payload("queued");
  const queued = mapWorkflowJobWebhook(
    { ...p, workflow_job: { ...p.workflow_job, runner_id: 0, runner_group_id: 0 } },
    ctx,
  );
  expect(queued).toMatchObject({
    outcome: "mapped",
    observation: { runnerId: null, runnerGroupId: null },
  });
  const negative = mapWorkflowJobWebhook(
    { ...p, workflow_job: { ...p.workflow_job, runner_id: 0, runner_group_id: -1 } },
    ctx,
  );
  expect(negative).toEqual({ outcome: "refused", reason: "invalid_job_evidence" });
  expect(
    enrichWorkflowJob(mapped(), run(), { ...job(), runner_id: 0, runner_group_id: 0 }),
  ).toMatchObject({ outcome: "enriched", observation: { runnerId: 555, runnerGroupId: 7 } });
  expect(enrichWorkflowJob(mapped(), run(), { ...job(), runner_group_id: -1 })).toEqual({
    outcome: "refused",
    reason: "enrichment_runner_mismatch",
  });
});
it("refuses to attach a run attempt that neither the webhook nor the job record names", () => {
  const unproven = { ...job() } as Record<string, unknown>;
  delete unproven["run_attempt"];
  const before = mapped();
  expect(before.runAttempt).toBeNull();
  expect(enrichWorkflowJob(before, run(), unproven)).toEqual({
    outcome: "refused",
    reason: "enrichment_attempt_unproven",
  });
  expect(enrichWorkflowJob(before, run(), { ...unproven, run_attempt: null })).toEqual({
    outcome: "refused",
    reason: "enrichment_attempt_unproven",
  });
  expect(enrichWorkflowJob(before, run(), job())).toMatchObject({
    outcome: "enriched",
    observation: { runAttempt: 2, triggeringActor: { id: 20 } },
  });
});
