#!/usr/bin/env node
// node scripts/version.mjs <version>
//
// The only way to change Homer's product version (versioning spec, ADR 012).
// It sets the root package.json, every workspace package, every dependency on
// a workspace package, and the matching fields of package-lock.json. It
// refuses a version that is not SemVer or not above the current one, and a
// workspace that already disagrees, and then it changes nothing.
import { realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEPENDENCY_FIELDS,
  SEMVER,
  checkWorkspace,
  compareVersions,
  loadWorkspace,
  repositoryRoot,
} from "./check-versions.mjs";

export class VersionRefused extends Error {}

/** Why `next` cannot become the version after `current`, or undefined if it can. */
export function refusal(next, current) {
  if (typeof next !== "string" || next === "") return "give the new version, as in 0.1.0";
  if (/^v\d/.test(next)) return `"${next}": give the version without the "v"; only tags have it`;
  if (next.includes("+")) {
    return `"${next}": no build metadata; the build adds "+<commit>" to make the Build Version`;
  }
  if (!SEMVER.test(next)) return `"${next}" is not a SemVer version`;
  if (compareVersions(next, current) <= 0) {
    return `"${next}" is not above the current version "${current}"`;
  }
  return undefined;
}

// Keep each file's own indentation and line endings, as npm does.
function serialize(file, json) {
  const indent = /^[ \t]+(?=")/m.exec(file.text)?.[0] ?? "  ";
  const eol = file.text.includes("\r\n") ? "\r\n" : "\n";
  let text = JSON.stringify(json, null, indent);
  if (eol !== "\n") text = text.replace(/\n/g, eol);
  return file.text.endsWith("\n") ? text + eol : text;
}

function setDependencies(manifest, names, version) {
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest?.[field];
    if (!deps || typeof deps !== "object") continue;
    for (const name of Object.keys(deps)) if (names.has(name)) deps[name] = version;
  }
}

/**
 * Returns the workspace with every version field set to `next`, as new file
 * texts. It throws VersionRefused, and writes nothing, when it cannot.
 */
export function planVersion(workspace, next) {
  const before = checkWorkspace(workspace);
  if (before.length > 0) {
    throw new VersionRefused(
      ["the workspace already disagrees; fix this first:", ...before].join("\n  "),
    );
  }
  const current = workspace.root.json.version;
  const reason = refusal(next, current);
  if (reason) throw new VersionRefused(reason);

  const clone = (file) => ({ ...file, json: structuredClone(file.json) });
  const root = clone(workspace.root);
  const packages = workspace.packages.map(clone);
  const lock = clone(workspace.lock);
  const names = new Set(packages.map((p) => p.json.name));

  root.json.version = next;
  setDependencies(root.json, names, next);
  for (const pkg of packages) {
    pkg.json.version = next;
    setDependencies(pkg.json, names, next);
  }
  // The check above proved each of these fields exists, so setting them keeps
  // npm's key order.
  lock.json.version = next;
  const entries = lock.json.packages;
  entries[""].version = next;
  setDependencies(entries[""], names, next);
  for (const pkg of packages) {
    entries[pkg.dir].version = next;
    setDependencies(entries[pkg.dir], names, next);
  }

  const after = checkWorkspace({ root, packages, lock });
  if (after.length > 0) {
    throw new Error(["internal error: the new version still disagrees:", ...after].join("\n  "));
  }
  return [root, ...packages, lock]
    .map((file) => ({ path: file.path, text: serialize(file, file.json), old: file.text }))
    .filter((file) => file.text !== file.old)
    .map(({ path, text }) => ({ path, text }));
}

/** Writes each changed file through a temporary file and a rename. */
export function writePlan(rootDir, plan) {
  for (const { path, text } of plan) {
    const target = join(rootDir, path);
    const temporary = `${target}.version-${process.pid}.tmp`;
    writeFileSync(temporary, text);
    renameSync(temporary, target);
  }
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
  if (args.length !== 1 || args[0].startsWith("-")) {
    console.error("usage: node scripts/version.mjs <version>");
    process.exit(2);
  }
  const rootDir = repositoryRoot();
  let plan;
  let current;
  try {
    const workspace = loadWorkspace(rootDir);
    current = workspace.root.json.version;
    plan = planVersion(workspace, args[0]);
  } catch (error) {
    console.error(`Refused, nothing changed: ${error.message}`);
    process.exit(1);
  }
  writePlan(rootDir, plan);
  console.log(`Homer is now ${args[0]} (was ${current}). ${plan.length} files changed:`);
  for (const { path } of plan) console.log(`  ${path}`);
}
