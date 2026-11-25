#!/usr/bin/env node
// Homer has one product version (versioning spec, ADR 012). The root
// package.json holds it; every workspace package, every dependency on a
// workspace package, and package-lock.json must name the same one.
//
// It also checks CHANGELOG.md: Unreleased first, then one `## [X.Y.Z] -
// YYYY-MM-DD` section per release, newest first, each holding only the Keep a
// Changelog subsections; and once the version is a release above 0.0.0, a
// section for it.
// It checks that the contracts table in specs/integration-contracts/README.md
// lists every schema file there.
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

export const CHANGELOG = "CHANGELOG.md";
export const SUBSECTIONS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];
const RELEASE_HEADING = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/;
const LINK_DEFINITION = /^\[[^\]]+\]:\s/;

function realDate(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/**
 * Splits CHANGELOG.md into its `## ` sections, ignoring headings inside code
 * fences and the link definitions at the end. Each section keeps its body
 * lines, its `### ` subsections, and any problem found, with line numbers.
 */
export function parseChangelog(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let fence = false;
  let current;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && line.startsWith("## ")) {
      current = { heading: line, line: i + 1, body: [], subsections: [], deep: [] };
      const release = RELEASE_HEADING.exec(line);
      if (line === "## Unreleased") current.kind = "unreleased";
      else if (release)
        Object.assign(current, { kind: "release", version: release[1], date: release[2] });
      else current.kind = "other";
      sections.push(current);
      return;
    }
    if (!current || (!fence && LINK_DEFINITION.test(line))) return;
    current.body.push(line);
    // Structure comes only from lines outside code fences.
    const subsection = !fence && line.startsWith("### ");
    if (subsection) current.subsections.push({ name: line.slice(4), line: i + 1 });
    if (!fence && /^#{4,} /.test(line)) current.deep.push(i + 1);
    if (current.subsections.length === 0 && current.loose === undefined && line.trim() !== "") {
      current.loose = i + 1; // content before the first subsection
    }
  });
  return sections;
}

/** Every problem with CHANGELOG.md's structure, as "CHANGELOG.md:line: message". */
export function checkChangelog(text, version) {
  const errors = [];
  const at = (line, message) => errors.push(`${CHANGELOG}:${line}: ${message}`);
  const sections = parseChangelog(text);
  if (sections[0]?.kind !== "unreleased") {
    at(sections[0]?.line ?? 1, 'the first "## " section must be "## Unreleased"');
  }
  const seen = new Map();
  let previous;
  for (const section of sections) {
    if (section.kind === "other") {
      at(
        section.line,
        `"${section.heading}" is neither "## Unreleased" nor "## [X.Y.Z] - YYYY-MM-DD"`,
      );
      continue;
    }
    if (section.kind === "unreleased" && section !== sections[0]) {
      at(section.line, '"## Unreleased" must come first, and only once');
    }
    if (section.kind === "release") {
      if (!SEMVER.test(section.version)) {
        at(section.line, `"${section.version}" is not a product version`);
      } else {
        if (seen.has(section.version)) {
          at(
            section.line,
            `${section.version} already has a section at line ${seen.get(section.version)}`,
          );
        }
        seen.set(section.version, section.line);
        if (previous && compareVersions(section.version, previous) > 0) {
          at(section.line, `${section.version} must come after ${previous}: newest release first`);
        }
        previous = section.version;
      }
      if (!realDate(section.date)) at(section.line, `"${section.date}" is not a date`);
    }
    const names = new Set();
    for (const sub of section.subsections) {
      if (!SUBSECTIONS.includes(sub.name)) {
        at(
          sub.line,
          `"### ${sub.name}" is not one of ${SUBSECTIONS.map((n) => `"### ${n}"`).join(", ")}`,
        );
      } else if (names.has(sub.name)) {
        at(sub.line, `a second "### ${sub.name}" in "${section.heading}"`);
      }
      names.add(sub.name);
    }
    if (section.loose !== undefined) {
      at(section.loose, `an entry outside a subsection of "${section.heading}"`);
    }
    for (const line of section.deep) at(line, "headings below ### are not used");
  }
  // A release candidate is tagged for staging with no GitHub Release, so it
  // needs no section of its own; every release above 0.0.0 does.
  const release = typeof version === "string" ? SEMVER.exec(version) : null;
  if (release && release[4] === undefined && version !== "0.0.0" && !seen.has(version)) {
    at(
      1,
      `the product version is ${version}, but there is no "## [${version}] - YYYY-MM-DD" section`,
    );
  }
  return errors;
}

export const CONTRACTS_DIR = "specs/integration-contracts";

/** Every schema file in the contracts folder must have a row in the README's contracts table. */
export function checkContractsTable(rootDir) {
  const readme = `${CONTRACTS_DIR}/README.md`;
  let text;
  let files;
  try {
    text = readFileSync(join(rootDir, readme), "utf8");
    files = readdirSync(join(rootDir, CONTRACTS_DIR)).filter((f) => f.endsWith(".schema.json"));
  } catch {
    return [];
  }
  const rows = new Map();
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split("|").map((c) => c.trim());
    const file = /^`([^`]+\.schema\.json)`$/.exec(cells[2] ?? "");
    if (line.startsWith("|") && file) rows.set(file[1], cells[3]);
  }
  const errors = [];
  for (const file of files.sort()) {
    if (!rows.has(file)) {
      errors.push(`${readme}: the contracts table has no row for \`${file}\``);
    } else if (!/^(?:v\d+\.\d+\.\d+|Unreleased)$/.test(rows.get(file))) {
      errors.push(
        `${readme}: \`${file}\` first shipped in "${rows.get(file)}"; use vX.Y.Z or Unreleased`,
      );
    }
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
    const root = repositoryRoot();
    errors = [
      ...checkWorkspace(workspace),
      ...checkSources(root, workspace),
      ...checkChangelog(readFileSync(join(root, CHANGELOG), "utf8"), workspace.root.json.version),
      ...checkContractsTable(root),
    ];
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
