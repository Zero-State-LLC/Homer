import test from "node:test";
import assert from "node:assert/strict";
import { GitHubMappingCatalog, mapMergedPullRequest } from "@zs-home/github-sync";

test("compiled GitHub mapping package loads and reads its injected catalog", async () => {
  assert.equal(typeof mapMergedPullRequest, "function");
  const catalog = new GitHubMappingCatalog({
    read() {
      return Promise.resolve({ version: 1, revision: 0, repositories: [] });
    },
    compareAndSwap() {
      return Promise.resolve(false);
    },
  });
  assert.deepEqual(await catalog.list(), { version: 1, revision: 0, repositories: [] });
});
