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
  checkWorkspace,
  compareVersions,
  loadWorkspace,
  repositoryRoot,
  workspaceDirectories,
} from "./check-versions.mjs";
import { VersionRefused, planVersion, writePlan } from "./version.mjs";

const repo = repositoryRoot();

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
  for (const file of [...files, "scripts/check-versions.mjs", "scripts/version.mjs"]) {
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

test("version.mjs 0.1.0 from the repository sets every version field", (t) => {
  const dir = temporary(t);
  copyRepository(dir);
  const before = loadWorkspace(dir);
  const workspaceNames = new Set(before.packages.map((p) => p.json.name));
  const plan = planVersion(before, "0.1.0");
  writePlan(dir, plan);

  const after = loadWorkspace(dir);
  assert.deepEqual(checkWorkspace(after), []);
  assert.equal(after.root.json.version, "0.1.0");
  assert.ok(after.packages.length > 0);
  for (const pkg of after.packages) assert.equal(pkg.json.version, "0.1.0", pkg.path);
  let internal = 0;
  for (const pkg of after.packages) {
    for (const [name, range] of Object.entries(pkg.json.dependencies ?? {})) {
      if (!workspaceNames.has(name)) continue;
      internal += 1;
      assert.equal(range, "0.1.0", `${pkg.path} ${name}`);
      assert.equal(after.lock.json.packages[pkg.dir].dependencies[name], "0.1.0");
    }
  }
  assert.ok(internal > 0, "the repository has internal dependencies");
  assert.equal(after.lock.json.version, "0.1.0");
  assert.equal(after.lock.json.packages[""].version, "0.1.0");
  for (const pkg of after.packages) {
    assert.equal(after.lock.json.packages[pkg.dir].version, "0.1.0", pkg.dir);
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

  const bumped = run("version.mjs", "0.1.0");
  assert.equal(bumped.status, 0, bumped.stderr);
  assert.match(bumped.stdout, /Homer is now 0\.1\.0/);
  assert.equal(run("check-versions.mjs").status, 0);

  const pkg = read(dir, "packages/shared-contracts/package.json");
  write(dir, "packages/shared-contracts/package.json", { ...pkg, version: "0.0.0" });
  const failed = run("check-versions.mjs");
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /packages\/shared-contracts\/package\.json: version is "0\.0\.0"/);
});
