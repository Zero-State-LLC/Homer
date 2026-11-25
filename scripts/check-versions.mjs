#!/usr/bin/env node
// Homer has one product version (versioning spec, ADR 012). The root
// package.json holds it; every workspace package, every dependency on a
// workspace package, and package-lock.json must name the same one.
//
// It also refuses a hand-typed Collector version in any package's src: every
// Collector writes BUILD_VERSION from @zs-home/shared-contracts, which the
// build makes from this version and the commit (scripts/build-info.mjs).
//
// This file reads files only and imports nothing outside Node, so CI runs it
// before Node setup and for docs-only pull requests too. scripts/version.mjs is
// the only way to change the version; it imports the helpers below.
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

// SemVer 2.0.0 without build metadata. The product version never carries
// build metadata: the build appends `+<commit>` to make the Build Version.
export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

export const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const ROOT = "package.json";
const LOCK = "package-lock.json";

/** Compares two SemVer versions by precedence: negative, zero or positive. */
export function compareVersions(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  if (!pa || !pb) throw new Error(`not SemVer: ${pa ? b : a}`);
  for (let i = 1; i <= 3; i += 1) {
    const d = BigInt(pa[i]) - BigInt(pb[i]);
    if (d !== 0n) return d < 0n ? -1 : 1;
  }
  // A version with a prerelease is lower than the same version without one.
  if (pa[4] === undefined || pb[4] === undefined) {
    return (pa[4] === undefined ? 1 : 0) - (pb[4] === undefined ? 1 : 0);
  }
  const xa = pa[4].split(".");
  const xb = pb[4].split(".");
  for (let i = 0; i < Math.min(xa.length, xb.length); i += 1) {
    const na = /^\d+$/.test(xa[i]);
    const nb = /^\d+$/.test(xb[i]);
    if (na && nb) {
      const d = BigInt(xa[i]) - BigInt(xb[i]);
      if (d !== 0n) return d < 0n ? -1 : 1;
    } else if (na !== nb) {
      return na ? -1 : 1; // numeric identifiers sort before alphanumeric ones
    } else if (xa[i] !== xb[i]) {
      return xa[i] < xb[i] ? -1 : 1;
    }
  }
  return Math.sign(xa.length - xb.length);
}

function readJson(rootDir, path) {
  const text = readFileSync(join(rootDir, path), "utf8");
  try {
    return { path, text, json: JSON.parse(text) };
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${error.message})`);
  }
}

/**
 * Expands the root `workspaces` field the way npm does for the two forms Homer
 * uses: a directory, or `dir/*` for every child directory with a package.json.
 * Any other pattern is refused rather than guessed at.
 */
export function workspaceDirectories(rootDir, workspaces) {
  if (!Array.isArray(workspaces) || workspaces.some((w) => typeof w !== "string")) {
    throw new Error(`${ROOT}: "workspaces" must be a list of directories`);
  }
  const dirs = [];
  for (const pattern of workspaces) {
    const clean = posix.normalize(pattern).replace(/\/+$/, "");
    if (clean.startsWith("..") || posix.isAbsolute(clean)) {
      throw new Error(`${ROOT}: workspace "${pattern}" is outside the repository`);
    }
    if (clean.endsWith("/*") && !clean.slice(0, -2).includes("*")) {
      const parent = clean.slice(0, -2);
      const children = readdirSync(join(rootDir, parent), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
      for (const child of children) {
        if (existsSync(join(rootDir, parent, child, "package.json"))) {
          dirs.push(`${parent}/${child}`);
        }
      }
    } else if (!/[*?[\]{}!]/.test(clean)) {
      dirs.push(clean);
    } else {
      throw new Error(
        `${ROOT}: workspace pattern "${pattern}" is not supported; use a directory or "dir/*"`,
      );
    }
  }
  return [...new Set(dirs)];
}

/** Reads the root package, every workspace package and the lock file. */
export function loadWorkspace(rootDir) {
  const root = readJson(rootDir, ROOT);
  const packages = workspaceDirectories(rootDir, root.json.workspaces).map((dir) => ({
    dir,
    ...readJson(rootDir, `${dir}/package.json`),
  }));
  const lock = existsSync(join(rootDir, LOCK)) ? readJson(rootDir, LOCK) : undefined;
  return { root, packages, lock };
}

function checkDependencies(errors, where, manifest, workspaceNames, version) {
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest?.[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, range] of Object.entries(deps)) {
      if (workspaceNames.has(name) && range !== version) {
        errors.push(`${where}: ${field}.${name} is "${range}", not "${version}"`);
      }
    }
  }
}

/** Returns every disagreement as "file: message". An empty list means they agree. */
export function checkWorkspace({ root, packages, lock }) {
  const errors = [];
  const version = root.json.version;
  if (root.json.private !== true) errors.push(`${ROOT}: "private" must be true`);
  if (typeof version !== "string") {
    errors.push(`${ROOT}: has no "version"; the product version lives here`);
    return errors;
  }
  if (!SEMVER.test(version)) {
    errors.push(`${ROOT}: version "${version}" is not SemVer without build metadata`);
  }

  const names = new Map();
  for (const pkg of packages) {
    const name = pkg.json.name;
    if (typeof name !== "string" || name === "") {
      errors.push(`${pkg.path}: has no "name"`);
      continue;
    }
    if (names.has(name)) {
      errors.push(`${pkg.path}: name "${name}" is also used by ${names.get(name)}`);
    }
    names.set(name, pkg.path);
  }
  const workspaceNames = new Set(names.keys());

  checkDependencies(errors, ROOT, root.json, workspaceNames, version);
  for (const pkg of packages) {
    if (pkg.json.version !== version) {
      errors.push(`${pkg.path}: version is "${pkg.json.version}", not "${version}"`);
    }
    if (pkg.json.private !== true) errors.push(`${pkg.path}: "private" must be true`);
    checkDependencies(errors, pkg.path, pkg.json, workspaceNames, version);
  }

  if (!lock) {
    errors.push(`${LOCK}: is missing`);
    return errors;
  }
  const entries = lock.json.packages;
  if (!entries || typeof entries !== "object") {
    errors.push(`${LOCK}: has no "packages"; it needs lockfileVersion 2 or 3`);
    return errors;
  }
  for (const [where, value] of [
    [LOCK, lock.json],
    [`${LOCK} packages[""]`, entries[""]],
  ]) {
    if (value?.name !== root.json.name) {
      errors.push(`${where}: name is "${value?.name}", not "${root.json.name}"`);
    }
    if (value?.version !== version) {
      errors.push(`${where}: version is "${value?.version}", not "${version}"`);
    }
  }
  checkDependencies(errors, `${LOCK} packages[""]`, entries[""], workspaceNames, version);
  for (const pkg of packages) {
    const where = `${LOCK} packages["${pkg.dir}"]`;
    const entry = entries[pkg.dir];
    if (!entry) {
      errors.push(`${where}: is missing; run npm install`);
      continue;
    }
    if (entry.name !== pkg.json.name) {
      errors.push(`${where}: name is "${entry.name}", not "${pkg.json.name}"`);
    }
    if (entry.version !== version) {
      errors.push(`${where}: version is "${entry.version}", not "${version}"`);
    }
    checkDependencies(errors, where, entry, workspaceNames, version);
  }
  return errors;
}

// `collectorVersion: "1.0.0"`, `COLLECTOR_VERSION = '1.0.0'`, or a type that
// pins one, as in `collectorVersion: "0.1.0";`. A type such as
// `collectorVersion: string` or a value such as BUILD_VERSION is fine.
const VERSION_LITERAL = /\bcollector_?version\b\??\s*[:=]\s*["'`]/i;
const SOURCE_FILE = /\.(?:[cm]?[jt]s|tsx|jsx)$/;

function sourceFiles(rootDir, dir) {
  let entries;
  try {
    entries = readdirSync(join(rootDir, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory() && entry.name !== "node_modules") {
      files.push(...sourceFiles(rootDir, path));
    } else if (entry.isFile() && SOURCE_FILE.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

/** Every hand-typed Collector version in a workspace package's src, as "file:line: message". */
export function checkSources(rootDir, { packages }) {
  const errors = [];
  for (const pkg of packages) {
    for (const path of sourceFiles(rootDir, `${pkg.dir}/src`)) {
      const lines = readFileSync(join(rootDir, path), "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (VERSION_LITERAL.test(line)) {
          errors.push(
            `${path}:${i + 1}: a hand-typed Collector version; use BUILD_VERSION from @zs-home/shared-contracts`,
          );
        }
      });
    }
  }
  return errors;
}

export function repositoryRoot() {
  return fileURLToPath(new URL("..", import.meta.url));
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
  let errors;
  let workspace;
  try {
    workspace = loadWorkspace(repositoryRoot());
    errors = [...checkWorkspace(workspace), ...checkSources(repositoryRoot(), workspace)];
  } catch (error) {
    errors = [error.message];
  }
  if (errors.length > 0) {
    console.error("Version check failed:");
    for (const error of errors) console.error(`  ${error}`);
    console.error("Change the product version only with: node scripts/version.mjs <version>.");
    process.exit(1);
  }
  console.log(
    `Versions agree: ${workspace.root.json.version} in ${ROOT}, ` +
      `${workspace.packages.length} workspace packages and ${LOCK}.`,
  );
}
