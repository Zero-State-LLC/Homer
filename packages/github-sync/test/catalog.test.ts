import { expect, it } from "vitest";
import {
  GitHubMappingCatalog,
  parseMappingSnapshot,
  type MappingSnapshot,
  type MappingStore,
} from "../src/catalog.js";

function setup() {
  let current: MappingSnapshot = { version: 1, revision: 0, repositories: [] };
  const store: MappingStore = {
    read() {
      return Promise.resolve(structuredClone(current));
    },
    compareAndSwap(expected, next) {
      if (current.revision !== expected) return Promise.resolve(false);
      current = structuredClone(next);
      return Promise.resolve(true);
    },
  };
  return new GitHubMappingCatalog(store);
}
const entry = { repositoryId: 123, repository: "Zero-State-LLC/example", enabled: true };
const payload = {
  id: 456,
  number: 7,
  state: "closed",
  merged: true,
  merged_at: "2026-11-19T12:34:56Z",
  merge_commit_sha: "a".repeat(40),
  merged_by: { id: 789, login: "account" },
  html_url: "https://github.com/Zero-State-LLC/example/pull/7",
  base: { repo: { id: 123, full_name: entry.repository } },
};

it("updates listings and collection mappings on the next call without rebuilding", async () => {
  const catalog = setup();
  expect((await catalog.map(payload, 123, "2026-11-20T00:00:00Z")).result.outcome).toBe("refused");
  await catalog.replace(0, [entry]);
  const first = await catalog.map(payload, 123, "2026-11-20T00:00:00Z");
  expect(first.result.outcome).toBe("mapped");
  await catalog.replace(1, [{ ...entry, projectId: "project:new" }]);
  const next = await catalog.map(payload, 123, "2026-11-20T00:00:00Z");
  expect(next.revision).toBe(2);
  if (next.result.outcome !== "mapped") throw new Error("refused");
  expect(next.result.event.projectId).toBe("project:new");
  const listing = await catalog.list();
  listing.repositories[0]!.enabled = false;
  expect((await catalog.list()).repositories[0]!.enabled).toBe(true);
  await catalog.replace(2, [{ ...entry, enabled: false }]);
  expect((await catalog.map(payload, 123, "2026-11-20T00:00:00Z")).result.outcome).toBe("refused");
  await catalog.replace(3, []);
  expect((await catalog.list()).repositories).toEqual([]);
});
it("rejects concurrent stale updates and retains the winner", async () => {
  const catalog = setup();
  const results = await Promise.allSettled([catalog.replace(0, [entry]), catalog.replace(0, [])]);
  expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  expect((await catalog.list()).revision).toBe(1);
});
it("rejects duplicate, malformed and unsafe snapshots without a partial write", async () => {
  const catalog = setup();
  await expect(
    catalog.replace(0, [
      entry,
      { ...entry, repositoryId: 999, repository: "Zero-State-LLC/EXAMPLE" },
    ]),
  ).rejects.toThrow("duplicate");
  await expect(catalog.replace(0, [{ ...entry, repositoryId: -1 }])).rejects.toThrow("invalid");
  await expect(catalog.replace(Number.MAX_SAFE_INTEGER, [])).rejects.toThrow("invalid");
  expect((await catalog.list()).revision).toBe(0);
  expect(() => parseMappingSnapshot({ version: 2, revision: 0, repositories: [] })).toThrow(
    "invalid",
  );
});
it("fails closed when the runtime configuration source fails", async () => {
  const catalog = new GitHubMappingCatalog({
    read() {
      return Promise.reject(new Error("unavailable"));
    },
    compareAndSwap() {
      return Promise.resolve(false);
    },
  });
  await expect(catalog.list()).rejects.toThrow("unavailable");
  await expect(catalog.map(payload, 123, "2026-11-20T00:00:00Z")).rejects.toThrow("unavailable");
});
