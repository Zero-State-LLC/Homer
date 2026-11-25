#!/usr/bin/env node
// node scripts/deploy-check.mjs vX.Y.Z
//
// Run in the checkout you are about to deploy from, after `npm run build`
// (docs/deployment/releases.md). It passes only when the deploy is
// traceable (versioning spec, "Deploy a Worker"):
//
// - HEAD is the commit an annotated tag vX.Y.Z points at, and the working
//   tree has no changes;
// - the product version is X.Y.Z, every version check passes, and the
//   CHANGELOG has X.Y.Z's section;
// - the built @zs-home/shared-contracts says BUILD_VERSION X.Y.Z+<commit>,
//   not .dirty and not +unknown.
//
// It changes nothing. A failure lists every reason and exits 1.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readGit } from "./build-info.mjs";
import {
  CHANGELOG,
  SEMVER,
  checkChangelog,
  checkContractsTable,
  checkSources,
  checkWorkspace,
  loadWorkspace,
  repositoryRoot,
} from "./check-versions.mjs";

export const BUILT_INFO = "packages/shared-contracts/dist/generated/build-info.js";

function runGit(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}

function builtVersion(rootDir) {
  try {
    const text = readFileSync(join(rootDir, BUILT_INFO), "utf8");
    const m = /export const BUILD_VERSION = ("(?:[^"\\]|\\.)*");/.exec(text);
    return m ? JSON.parse(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

/** Every reason the checkout at `rootDir` must not be deployed as `tag`. */
export function deployCheck(rootDir, tag, git = runGit) {
  const errors = [];
  const m = /^v(.+)$/.exec(tag ?? "");
  const version = m?.[1];
  if (!version || !SEMVER.test(version)) {
    return { errors: [`"${tag}" is not a release tag such as v0.1.0 or v0.1.0-rc.1`] };
  }

  let workspace;
  try {
    workspace = loadWorkspace(rootDir);
  } catch (error) {
    return { errors: [error.message] };
  }
  if (workspace.root.json.version !== version) {
    errors.push(`package.json: version is "${workspace.root.json.version}", not ${version}`);
  }
  let changelog = "";
  try {
    changelog = readFileSync(join(rootDir, CHANGELOG), "utf8");
  } catch {
    errors.push(`${CHANGELOG}: is missing`);
  }
  errors.push(
    ...checkWorkspace(workspace),
    ...checkSources(rootDir, workspace),
    ...checkChangelog(changelog, version),
    ...checkContractsTable(rootDir),
  );

  const { commit, dirty } = readGit(rootDir, git);
  if (commit === "unknown") {
    errors.push("git cannot say which commit this is, so the deploy would not be traceable");
  } else {
    if (dirty) errors.push("the working tree has changes; deploy from a clean checkout of the tag");
    let head;
    let tagged;
    let kind;
    try {
      head = git(rootDir, ["rev-parse", "--verify", "HEAD"]).trim();
      kind = git(rootDir, ["cat-file", "-t", `refs/tags/${tag}`]).trim();
      tagged = git(rootDir, ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]).trim();
    } catch {
      kind = undefined;
    }
    if (kind === undefined) errors.push(`there is no tag ${tag} here; fetch the tags first`);
    else if (kind !== "tag") errors.push(`${tag} is a lightweight tag; a release tag is annotated`);
    else if (tagged !== head)
      errors.push(`HEAD is not the commit ${tag} points at; check out the tag`);
  }

  const built = builtVersion(rootDir);
  const expected = commit === "unknown" ? undefined : `${version}+${commit}`;
  if (built === undefined) {
    errors.push(`${BUILT_INFO}: no Build Version; run npm run build first`);
  } else if (built !== expected) {
    errors.push(
      `the build says ${built}, not ${expected ?? `${version}+<commit>`}; rebuild from a clean checkout of the tag`,
    );
  }
  return { errors, version, commit, buildVersion: built };
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("usage: node scripts/deploy-check.mjs vX.Y.Z");
    process.exit(2);
  }
  const result = deployCheck(repositoryRoot(), args[0]);
  if (result.errors.length > 0) {
    console.error(`Do not deploy ${args[0]}:`);
    for (const error of result.errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log(
    `Deploy check passed: ${args[0]} at ${result.commit}, Build Version ${result.buildVersion}.`,
  );
}
