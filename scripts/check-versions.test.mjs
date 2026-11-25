// Tests for the lockstep product version: scripts/check-versions.mjs and
// scripts/version.mjs (versioning spec, test matrix). They use Node only, so
// CI runs them before Node setup, next to the check itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  checkChangelog,
  checkContractsTable,
  checkSources,
  checkWorkspace,
  compareVersions,
  parseChangelog,
  loadWorkspace,
  repositoryRoot,
  workspaceDirectories,
} from "./check-versions.mjs";
import { VersionRefused, planVersion, writePlan } from "./version.mjs";
import { releaseNotes } from "./release-notes.mjs";

const repo = repositoryRoot();

// A version above `version`: the next minor. Tests that bump a copy of the
// repository use it, so they pass at whatever version the repository is.
function nextMinor(version) {
  const [major, minor] = version.split(/[.-]/);
  return `${major}.${Number(minor) + 1}.0`;
}

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), "homer-versions-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, path, json) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), JSON.stringify(json, null, 2) + "\n");
}

function read(dir, path) {
  return JSON.parse(readFileSync(join(dir, path), "utf8"));
}

// Copies the repository's package files, and these two scripts, into `dir`.
function copyRepository(dir) {
  const files = ["package.json", "package-lock.json"];
  for (const name of readdirSync(join(repo, "packages"))) {
    try {
      readFileSync(join(repo, "packages", name, "package.json"));
      files.push(`packages/${name}/package.json`);
    } catch {
      // not a workspace package
    }
  }
  for (const file of [
    ...files,
    "CHANGELOG.md",
    "scripts/check-versions.mjs",
    "scripts/version.mjs",
    "scripts/release-notes.mjs",
  ]) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(join(repo, file), join(dir, file));
  }
}

// A small workspace: `a` depends on `b`; the lock matches.
function fixture(dir, version = "0.1.0") {
  write(dir, "package.json", {
    name: "homer",
    version,
    private: true,
    workspaces: ["packages/*"],
  });
  write(dir, "packages/a/package.json", {
    name: "@zs-home/a",
    version,
    private: true,
    dependencies: { "@zs-home/b": version, jose: "6.2.18" },
  });
  write(dir, "packages/b/package.json", { name: "@zs-home/b", version, private: true });
  mkdirSync(join(dir, "packages/not-a-package"), { recursive: true });
  write(dir, "package-lock.json", {
    name: "homer",
    version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "homer", version, workspaces: ["packages/*"] },
      "node_modules/@zs-home/a": { resolved: "packages/a", link: true },
      "node_modules/@zs-home/b": { resolved: "packages/b", link: true },
      "packages/a": {
        name: "@zs-home/a",
        version,
        dependencies: { "@zs-home/b": version, jose: "6.2.18" },
      },
      "packages/b": { name: "@zs-home/b", version },
    },
  });
}

function snapshot(dir) {
  const out = {};
  for (const path of [
    "package.json",
    "package-lock.json",
    "packages/a/package.json",
    "packages/b/package.json",
  ]) {
    out[path] = readFileSync(join(dir, path), "utf8");
  }
  return out;
}

function check(dir) {
  return checkWorkspace(loadWorkspace(dir));
}

test("the repository's versions agree", () => {
  assert.deepEqual(check(repo), []);
});

test("the repository's package files round-trip byte for byte", () => {
  // planVersion rewrites files with JSON.stringify; that must match their format.
  const { root, packages, lock } = loadWorkspace(repo);
  for (const file of [root, ...packages, lock]) {
    assert.equal(JSON.stringify(file.json, null, 2) + "\n", file.text, file.path);
  }
});

test("version.mjs from the repository's version sets every version field", (t) => {
  const dir = temporary(t);
  copyRepository(dir);
  const before = loadWorkspace(dir);
  const next = nextMinor(before.root.json.version);
  const workspaceNames = new Set(before.packages.map((p) => p.json.name));
  const plan = planVersion(before, next);
  writePlan(dir, plan);

  const after = loadWorkspace(dir);
  assert.deepEqual(checkWorkspace(after), []);
  assert.equal(after.root.json.version, next);
  assert.ok(after.packages.length > 0);
  for (const pkg of after.packages) assert.equal(pkg.json.version, next, pkg.path);
  let internal = 0;
  for (const pkg of after.packages) {
    for (const [name, range] of Object.entries(pkg.json.dependencies ?? {})) {
      if (!workspaceNames.has(name)) continue;
      internal += 1;
      assert.equal(range, next, `${pkg.path} ${name}`);
      assert.equal(after.lock.json.packages[pkg.dir].dependencies[name], next);
    }
  }
  assert.ok(internal > 0, "the repository has internal dependencies");
  assert.equal(after.lock.json.version, next);
  assert.equal(after.lock.json.packages[""].version, next);
  for (const pkg of after.packages) {
    assert.equal(after.lock.json.packages[pkg.dir].version, next, pkg.dir);
  }
  // Every workspace package, the root and the lock changed; nothing else did.
  assert.equal(plan.length, after.packages.length + 2);
  // External dependencies keep their exact versions.
  for (const pkg of before.packages) {
    for (const [name, range] of Object.entries(pkg.json.dependencies ?? {})) {
      if (!workspaceNames.has(name)) {
        assert.equal(read(dir, pkg.path).dependencies[name], range);
      }
    }
  }
});

test("version.mjs refuses a bad or lower version and changes nothing", async (t) => {
  for (const next of [
    "0.0.9",
    "0.1.0",
    "0.1.0-rc.1",
    "banana",
    "v0.2.0",
    "0.2.0+abc1234",
    "01.2.3",
    "1.2",
    "",
  ]) {
    await t.test(JSON.stringify(next), (t) => {
      const dir = temporary(t);
      fixture(dir, "0.1.0");
      const before = snapshot(dir);
      assert.throws(() => planVersion(loadWorkspace(dir), next), VersionRefused);
      assert.deepEqual(snapshot(dir), before);
    });
  }
});

test("version.mjs says why a tag or a build version is refused", (t) => {
  const dir = temporary(t);
  fixture(dir, "0.1.0");
  const workspace = loadWorkspace(dir);
  assert.throws(() => planVersion(workspace, "v0.2.0"), /without the "v"/);
  assert.throws(() => planVersion(workspace, "0.2.0+abc1234"), /no build metadata/);
  assert.throws(() => planVersion(workspace, "0.0.9"), /not above the current version "0\.1\.0"/);
});

test("version.mjs accepts a release candidate and then its release", (t) => {
  const dir = temporary(t);
  fixture(dir, "0.0.0");
  for (const next of ["0.1.0-rc.1", "0.1.0-rc.2", "0.1.0", "0.1.1", "1.0.0"]) {
    writePlan(dir, planVersion(loadWorkspace(dir), next));
    assert.deepEqual(check(dir), []);
    assert.equal(read(dir, "packages/a/package.json").dependencies["@zs-home/b"], next);
  }
});

test("version.mjs refuses a workspace that already disagrees", (t) => {
  const dir = temporary(t);
  fixture(dir, "0.1.0");
  const b = read(dir, "packages/b/package.json");
  write(dir, "packages/b/package.json", { ...b, version: "0.2.0" });
  const before = snapshot(dir);
  assert.throws(() => planVersion(loadWorkspace(dir), "0.3.0"), /already disagrees/);
  assert.deepEqual(snapshot(dir), before);
});

test("check-versions names the file that disagrees", async (t) => {
  const cases = [
    {
      name: "a package at another version",
      change: (dir) =>
        write(dir, "packages/b/package.json", {
          name: "@zs-home/b",
          version: "0.2.0",
          private: true,
        }),
      error: 'packages/b/package.json: version is "0.2.0", not "0.1.0"',
    },
    {
      name: "an internal dependency left at 0.0.0",
      change: (dir) => {
        const a = read(dir, "packages/a/package.json");
        a.dependencies["@zs-home/b"] = "0.0.0";
        write(dir, "packages/a/package.json", a);
      },
      error: 'packages/a/package.json: dependencies.@zs-home/b is "0.0.0", not "0.1.0"',
    },
    {
      name: "an internal dev dependency as a range",
      change: (dir) => {
        const a = read(dir, "packages/a/package.json");
        a.devDependencies = { "@zs-home/b": "^0.1.0" };
        write(dir, "packages/a/package.json", a);
      },
      error: 'packages/a/package.json: devDependencies.@zs-home/b is "^0.1.0", not "0.1.0"',
    },
    {
      name: "a lock entry at another version",
      change: (dir) => {
        const lock = read(dir, "package-lock.json");
        lock.packages["packages/b"].version = "0.0.0";
        write(dir, "package-lock.json", lock);
      },
      error: 'package-lock.json packages["packages/b"]: version is "0.0.0", not "0.1.0"',
    },
    {
      name: "a lock dependency at another version",
      change: (dir) => {
        const lock = read(dir, "package-lock.json");
        lock.packages["packages/a"].dependencies["@zs-home/b"] = "0.0.0";
        write(dir, "package-lock.json", lock);
      },
      error:
        'package-lock.json packages["packages/a"]: dependencies.@zs-home/b is "0.0.0", not "0.1.0"',
    },
    {
      name: "a workspace missing from the lock",
      change: (dir) => {
        const lock = read(dir, "package-lock.json");
        delete lock.packages["packages/b"];
        write(dir, "package-lock.json", lock);
      },
      error: 'package-lock.json packages["packages/b"]: is missing; run npm install',
    },
    {
      name: "a lock for another root name",
      change: (dir) => {
        const lock = read(dir, "package-lock.json");
        lock.name = "home";
        write(dir, "package-lock.json", lock);
      },
      error: 'package-lock.json: name is "home", not "homer"',
    },
    {
      name: "no lock file",
      change: (dir) => rmSync(join(dir, "package-lock.json")),
      error: "package-lock.json: is missing",
    },
    {
      name: "a package that is not private",
      change: (dir) =>
        write(dir, "packages/b/package.json", { name: "@zs-home/b", version: "0.1.0" }),
      error: 'packages/b/package.json: "private" must be true',
    },
    {
      name: "a root with no version",
      change: (dir) => {
        const { version: _v, ...root } = read(dir, "package.json");
        write(dir, "package.json", root);
      },
      error: 'package.json: has no "version"; the product version lives here',
    },
    {
      name: "a root version with build metadata",
      change: (dir) =>
        write(dir, "package.json", { ...read(dir, "package.json"), version: "0.1.0+abc" }),
      error: 'package.json: version "0.1.0+abc" is not SemVer without build metadata',
    },
    {
      name: "two packages with one name",
      change: (dir) =>
        write(dir, "packages/b/package.json", {
          name: "@zs-home/a",
          version: "0.1.0",
          private: true,
        }),
      error: 'packages/b/package.json: name "@zs-home/a" is also used by packages/a/package.json',
    },
  ];
  for (const c of cases) {
    await t.test(c.name, (t) => {
      const dir = temporary(t);
      fixture(dir, "0.1.0");
      assert.deepEqual(check(dir), []);
      c.change(dir);
      assert.ok(check(dir).includes(c.error), `${c.error}\n  got: ${check(dir).join("\n  ")}`);
    });
  }
});

test("a hand-typed Collector version in src fails, naming the file and line", (t) => {
  const dir = temporary(t);
  fixture(dir);
  const file = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  file(
    "packages/a/src/mapper.ts",
    [
      'import { BUILD_VERSION } from "@zs-home/shared-contracts/workers";',
      "export const provenance = {",
      '  collector: "homer-a",',
      "  collectorVersion: BUILD_VERSION,",
      "};",
      "export interface P {",
      "  collectorVersion: string;",
      "  collectorVersion?: string;",
      "}",
      "",
    ].join("\n"),
  );
  file("packages/a/test/mapper.test.ts", 'const expected = { collectorVersion: "1.0.0" };\n');
  file("packages/a/src/node_modules/x/index.js", 'export const collectorVersion = "1.0.0";\n');
  file("packages/b/README.md", 'collectorVersion: "1.0.0"\n');
  assert.deepEqual(checkSources(dir, loadWorkspace(dir)), []);

  file("packages/a/src/deep/old.ts", 'export const x = 1;\n    collectorVersion: "1.0.0",\n');
  file("packages/b/src/constants.mjs", "export const COLLECTOR_VERSION = '0.1.0';\n");
  file("packages/b/src/types.ts", 'export type T = { collectorVersion?: "0.1.0" };\n');
  file("packages/b/src/template.js", "export const v = { collectorVersion: `1.${0}` };\n");
  const message =
    "a hand-typed Collector version; use BUILD_VERSION from @zs-home/shared-contracts";
  assert.deepEqual(checkSources(dir, loadWorkspace(dir)), [
    `packages/a/src/deep/old.ts:2: ${message}`,
    `packages/b/src/constants.mjs:1: ${message}`,
    `packages/b/src/template.js:1: ${message}`,
    `packages/b/src/types.ts:1: ${message}`,
  ]);
});

test("the repository's sources type no Collector version by hand", () => {
  assert.deepEqual(checkSources(repo, loadWorkspace(repo)), []);
});

const CHANGELOG_OK = [
  "# Changelog",
  "",
  "Intro.",
  "",
  "## Unreleased",
  "",
  "### Added",
  "",
  "- Something new.",
  "",
  "## [0.2.0] - 2026-12-01",
  "",
  "### Added",
  "",
  "- Notes for 0.2.0.",
  "",
  "```md",
  "## Not a heading inside a fence",
  "### Nor a subsection",
  "#### Nor a deep heading",
  "```",
  "",
  "### Fixed",
  "",
  "- A fix.",
  "",
  "## [0.1.0] - 2026-11-24",
  "",
  "### Security",
  "",
  "- Notes for 0.1.0.",
  "",
  "[0.2.0]: https://github.com/Zero-State-LLC/Homer/compare/v0.1.0...v0.2.0",
  "[0.1.0]: https://github.com/Zero-State-LLC/Homer/releases/tag/v0.1.0",
  "",
].join("\n");

test("the repository's CHANGELOG and contracts table pass", () => {
  const { root } = loadWorkspace(repo);
  assert.deepEqual(
    checkChangelog(readFileSync(join(repo, "CHANGELOG.md"), "utf8"), root.json.version),
    [],
  );
  assert.deepEqual(checkContractsTable(repo), []);
});

test("a well-formed CHANGELOG passes at each of its versions and at a release candidate", () => {
  for (const version of ["0.0.0", "0.1.0", "0.2.0", "0.3.0-rc.1"]) {
    assert.deepEqual(checkChangelog(CHANGELOG_OK, version), [], version);
  }
});

test("check-versions names each CHANGELOG problem by line", async (t) => {
  const cases = [
    [
      "a release with no section",
      CHANGELOG_OK,
      "0.3.0",
      'CHANGELOG.md:1: the product version is 0.3.0, but there is no "## [0.3.0] - YYYY-MM-DD" section',
    ],
    [
      "an entry directly under Unreleased",
      CHANGELOG_OK.replace("## Unreleased\n", "## Unreleased\n\n- Loose.\n"),
      "0.0.0",
      'CHANGELOG.md:7: an entry outside a subsection of "## Unreleased"',
    ],
    [
      "a subsection Keep a Changelog does not have",
      CHANGELOG_OK.replace("### Fixed", "### Fixes"),
      "0.0.0",
      'CHANGELOG.md:23: "### Fixes" is not one of "### Added", "### Changed", "### Deprecated", "### Removed", "### Fixed", "### Security"',
    ],
    [
      "a subsection twice in one section",
      CHANGELOG_OK.replace("### Fixed", "### Added"),
      "0.0.0",
      'CHANGELOG.md:23: a second "### Added" in "## [0.2.0] - 2026-12-01"',
    ],
    [
      "releases out of order",
      CHANGELOG_OK.replace("## [0.2.0] - 2026-12-01", "## [0.0.9] - 2026-12-01"),
      "0.0.0",
      "CHANGELOG.md:27: 0.1.0 must come after 0.0.9: newest release first",
    ],
    [
      "a release listed twice",
      CHANGELOG_OK.replace("## [0.2.0] - 2026-12-01", "## [0.1.0] - 2026-12-01"),
      "0.0.0",
      "CHANGELOG.md:27: 0.1.0 already has a section at line 11",
    ],
    [
      "a date that does not exist",
      CHANGELOG_OK.replace("2026-12-01", "2026-02-30"),
      "0.0.0",
      'CHANGELOG.md:11: "2026-02-30" is not a date',
    ],
    [
      "a heading in another form",
      CHANGELOG_OK.replace("## [0.1.0] - 2026-11-24", "## 0.1.0 (2026-11-24)"),
      "0.0.0",
      'CHANGELOG.md:27: "## 0.1.0 (2026-11-24)" is neither "## Unreleased" nor "## [X.Y.Z] - YYYY-MM-DD"',
    ],
    [
      "Unreleased not first",
      CHANGELOG_OK.replace("## Unreleased\n\n### Added\n\n- Something new.\n\n", ""),
      "0.0.0",
      'CHANGELOG.md:5: the first "## " section must be "## Unreleased"',
    ],
    [
      "a version with a v",
      CHANGELOG_OK.replace("## [0.1.0]", "## [v0.1.0]"),
      "0.0.0",
      'CHANGELOG.md:27: "v0.1.0" is not a product version',
    ],
    [
      "a heading below ###",
      CHANGELOG_OK.replace("- A fix.", "#### Detail"),
      "0.0.0",
      "CHANGELOG.md:25: headings below ### are not used",
    ],
  ];
  for (const [name, text, version, error] of cases) {
    await t.test(name, () => {
      const errors = checkChangelog(text, version);
      assert.ok(errors.includes(error), `${error}\n  got: ${errors.join("\n  ")}`);
    });
  }
});

test("release-notes prints exactly one section's body", () => {
  assert.equal(releaseNotes(CHANGELOG_OK, "v0.1.0"), "### Security\n\n- Notes for 0.1.0.\n");
  assert.equal(releaseNotes(CHANGELOG_OK, "0.1.0"), "### Security\n\n- Notes for 0.1.0.\n");
  assert.equal(
    releaseNotes(CHANGELOG_OK, "v0.2.0"),
    "### Added\n\n- Notes for 0.2.0.\n\n```md\n## Not a heading inside a fence\n### Nor a subsection\n#### Nor a deep heading\n```\n\n### Fixed\n\n- A fix.\n",
  );
  assert.equal(releaseNotes(CHANGELOG_OK, "Unreleased"), "### Added\n\n- Something new.\n");
  assert.throws(() => releaseNotes(CHANGELOG_OK, "v0.3.0"), /no section for 0\.3\.0/);
  assert.throws(() => releaseNotes(CHANGELOG_OK, "banana"), /not a release tag/);
  assert.throws(
    () =>
      releaseNotes(
        CHANGELOG_OK.replace("- Notes for 0.1.0.\n", "").replace("### Security\n", ""),
        "v0.1.0",
      ),
    /is empty/,
  );
});

test("a fence closes only with a matching delimiter", () => {
  const text = CHANGELOG_OK.replace(
    "- Notes for 0.1.0.",
    [
      "- Notes for 0.1.0, with an example:",
      "",
      "  ````md",
      "  ```js",
      "## Example heading",
      "  ```",
      "  ````",
    ].join("\n"),
  );
  assert.deepEqual(checkChangelog(text, "0.1.0"), []);
  assert.match(releaseNotes(text, "v0.1.0"), /## Example heading\n {2}```\n {2}````\n$/);
  // A tilde fence is not closed by backticks, and an unclosed fence runs to the end.
  const tilde = CHANGELOG_OK.replace("- A fix.", "~~~\n```\n## Still code\n~~~");
  assert.deepEqual(checkChangelog(tilde, "0.0.0"), []);
  const unclosed = CHANGELOG_OK.replace("- Notes for 0.1.0.", "```\n## Inside an unclosed fence");
  assert.deepEqual(
    parseChangelog(unclosed).map((s) => s.heading),
    ["## Unreleased", "## [0.2.0] - 2026-12-01", "## [0.1.0] - 2026-11-24"],
  );
});

test("release notes keep the link definitions their references use", () => {
  const text = CHANGELOG_OK.replace(
    "- Notes for 0.1.0.",
    "- Notes for 0.1.0, see [details][Change  One] and [the spec].",
  ).replace(
    "[0.1.0]: https://github.com/Zero-State-LLC/Homer/releases/tag/v0.1.0",
    [
      "[0.1.0]: https://github.com/Zero-State-LLC/Homer/releases/tag/v0.1.0",
      "[change one]: https://example.com/change",
      "[The Spec]: https://example.com/spec",
      "[unused]: https://example.com/unused",
    ].join("\n"),
  );
  assert.deepEqual(checkChangelog(text, "0.1.0"), []);
  assert.equal(
    releaseNotes(text, "v0.1.0"),
    [
      "### Security",
      "",
      "- Notes for 0.1.0, see [details][Change  One] and [the spec].",
      "",
      "[change one]: https://example.com/change",
      "[The Spec]: https://example.com/spec",
      "",
    ].join("\n"),
  );
  // A section with no reference links gets no definitions.
  assert.equal(releaseNotes(text, "Unreleased"), "### Added\n\n- Something new.\n");
});

test("the contracts table must list every schema file", (t) => {
  const dir = temporary(t);
  const table = (rows) =>
    [
      "# Contracts",
      "",
      "| Contract id | Schema file | First shipped |",
      "| --- | --- | --- |",
      ...rows,
      "",
    ].join("\n");
  mkdirSync(join(dir, "specs/integration-contracts"), { recursive: true });
  writeFileSync(join(dir, "specs/integration-contracts/a.v1.schema.json"), "{}");
  writeFileSync(join(dir, "specs/integration-contracts/b.v1.schema.json"), "{}");
  const readme = join(dir, "specs/integration-contracts/README.md");
  writeFileSync(
    readme,
    table([
      "| `home.a/v1` | `a.v1.schema.json` | v0.1.0 |",
      "| `home.b/v1` | `b.v1.schema.json` | Unreleased |",
    ]),
  );
  assert.deepEqual(checkContractsTable(dir), []);
  writeFileSync(readme, table(["| `home.a/v1` | `a.v1.schema.json` | 0.1.0 |"]));
  assert.deepEqual(checkContractsTable(dir), [
    'specs/integration-contracts/README.md: `a.v1.schema.json` first shipped in "0.1.0"; use vX.Y.Z or Unreleased',
    "specs/integration-contracts/README.md: the contracts table has no row for `b.v1.schema.json`",
  ]);
});

test("workspace patterns other than a directory or dir/* are refused", (t) => {
  const dir = temporary(t);
  fixture(dir);
  assert.deepEqual(workspaceDirectories(dir, ["packages/*"]), ["packages/a", "packages/b"]);
  assert.deepEqual(workspaceDirectories(dir, ["packages/a", "packages/a/"]), ["packages/a"]);
  for (const pattern of ["packages/**", "pack*/a", "../elsewhere", "/abs"]) {
    assert.throws(() => workspaceDirectories(dir, [pattern]), /workspace/, pattern);
  }
  assert.throws(() => workspaceDirectories(dir, "packages/*"), /must be a list/);
});

test("nextMinor is above every version of its minor", () => {
  for (const version of ["0.0.0", "0.1.0", "0.1.0-rc.1", "1.9.3", "1.10.0-beta.2"]) {
    assert.equal(compareVersions(nextMinor(version), version), 1, version);
  }
  assert.equal(nextMinor("1.9.3"), "1.10.0");
});

test("SemVer precedence follows the SemVer 2.0.0 example", () => {
  const ordered = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
    "1.0.1",
    "1.1.0",
    "2.0.0",
    "10.0.0",
  ];
  for (let i = 0; i < ordered.length; i += 1) {
    assert.equal(compareVersions(ordered[i], ordered[i]), 0);
    for (let j = i + 1; j < ordered.length; j += 1) {
      assert.equal(compareVersions(ordered[i], ordered[j]), -1, `${ordered[i]} < ${ordered[j]}`);
      assert.equal(compareVersions(ordered[j], ordered[i]), 1, `${ordered[j]} > ${ordered[i]}`);
    }
  }
});

test("the CLIs change the copy, refuse bad input and fail on disagreement", (t) => {
  const dir = temporary(t);
  copyRepository(dir);
  const run = (script, ...args) =>
    spawnSync(process.execPath, [join(dir, "scripts", script), ...args], { encoding: "utf8" });

  assert.equal(run("check-versions.mjs").status, 0);
  const before = readFileSync(join(dir, "package-lock.json"), "utf8");
  for (const args of [[], ["banana"], ["0.1.0", "0.2.0"], ["--help"]]) {
    const result = run("version.mjs", ...args);
    assert.notEqual(result.status, 0, args.join(" "));
    assert.equal(readFileSync(join(dir, "package-lock.json"), "utf8"), before);
  }

  const next = nextMinor(read(dir, "package.json").version);
  const bumped = run("version.mjs", next);
  assert.equal(bumped.status, 0, bumped.stderr);
  assert.ok(bumped.stdout.startsWith(`Homer is now ${next} (was `), bumped.stdout);
  // A release needs its CHANGELOG section: the release pull request turns
  // Unreleased into it and opens a new, empty Unreleased.
  const missing = run("check-versions.mjs");
  assert.equal(missing.status, 1);
  assert.ok(missing.stderr.includes(`no "## [${next}] - YYYY-MM-DD" section`), missing.stderr);
  const changelog = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
  const unreleased = releaseNotes(changelog, "Unreleased");
  writeFileSync(
    join(dir, "CHANGELOG.md"),
    changelog.replace("## Unreleased\n", `## Unreleased\n\n## [${next}] - 2026-11-24\n`),
  );
  assert.equal(run("check-versions.mjs").status, 0, run("check-versions.mjs").stderr);
  const notes = run("release-notes.mjs", `v${next}`);
  assert.equal(notes.status, 0, notes.stderr);
  assert.equal(notes.stdout, unreleased);
  assert.notEqual(run("release-notes.mjs", "v99.0.0").status, 0);

  const pkg = read(dir, "packages/shared-contracts/package.json");
  write(dir, "packages/shared-contracts/package.json", { ...pkg, version: "0.0.0" });
  const failed = run("check-versions.mjs");
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /packages\/shared-contracts\/package\.json: version is "0\.0\.0"/);
});
