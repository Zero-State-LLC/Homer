// Tests for scripts/deploy-check.mjs, with real git (versioning spec,
// "Deploy a Worker"). CI runs them in the Versions step, before Node setup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILT_INFO, deployCheck } from "./deploy-check.mjs";

const scripts = dirname(fileURLToPath(import.meta.url));
let hasGit = true;
try {
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
  hasGit = false;
}

function write(dir, path, text) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(
    join(dir, path),
    typeof text === "string" ? text : JSON.stringify(text, null, 2) + "\n",
  );
}

// A small Homer-shaped repository at `version`, committed, with an annotated tag.
function release(t, version = "0.1.0-rc.1", { tag = `v${version}`, annotated = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "homer-deploy-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync(
      "git",
      ["-c", "user.name=Homer test", "-c", "user.email=test@example.invalid", ...args],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  write(dir, ".gitignore", "dist/\nnode_modules/\npackages/shared-contracts/src/generated/\n");
  write(dir, "package.json", { name: "homer", version, private: true, workspaces: ["packages/*"] });
  write(dir, "packages/shared-contracts/package.json", {
    name: "@zs-home/shared-contracts",
    version,
    private: true,
  });
  write(dir, "package-lock.json", {
    name: "homer",
    version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "homer", version, workspaces: ["packages/*"] },
      "packages/shared-contracts": { name: "@zs-home/shared-contracts", version },
    },
  });
  write(
    dir,
    "CHANGELOG.md",
    `# Changelog\n\n## Unreleased\n\n## [${version}] - 2026-11-24\n\n### Added\n\n- The first release candidate.\n`,
  );
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "--no-gpg-sign", "-m", "release");
  if (annotated) git("tag", "-a", "--no-sign", tag, "-m", `Homer ${tag}`);
  else git("tag", tag);
  const commit = git("rev-parse", "HEAD").slice(0, 7);
  const build = (buildVersion = `${version}+${commit}`) =>
    write(dir, BUILT_INFO, `export const BUILD_VERSION = ${JSON.stringify(buildVersion)};\n`);
  build();
  return { dir, git, commit, build, tag };
}

const skip = hasGit ? false : "git is not installed";

test("a clean, built checkout of an annotated tag passes", { skip }, (t) => {
  const r = release(t);
  assert.deepEqual(deployCheck(r.dir, r.tag), {
    errors: [],
    version: "0.1.0-rc.1",
    commit: r.commit,
    buildVersion: `0.1.0-rc.1+${r.commit}`,
  });
});

test("a release passes the same way", { skip }, (t) => {
  const r = release(t, "0.1.0");
  assert.deepEqual(deployCheck(r.dir, "v0.1.0").errors, []);
});

test("each untraceable deploy is refused with its reason", { skip }, async (t) => {
  const cases = [
    [
      "a changed file",
      (r) =>
        write(r.dir, "package.json", {
          name: "homer",
          version: "0.1.0-rc.1",
          private: true,
          workspaces: ["packages/*"],
          extra: 1,
        }),
      "the working tree has changes",
    ],
    ["an untracked file", (r) => write(r.dir, "notes.txt", "x"), "the working tree has changes"],
    [
      "a commit after the tag",
      (r) => {
        write(r.dir, "notes.txt", "x");
        r.git("add", "-A");
        r.git("commit", "-q", "--no-gpg-sign", "-m", "later");
      },
      "HEAD is not the commit v0.1.0-rc.1 points at",
    ],
    [
      "a dirty build",
      (r) => r.build(`0.1.0-rc.1+${r.commit}.dirty`),
      `the build says 0.1.0-rc.1+${"COMMIT"}.dirty`,
    ],
    [
      "a build without git",
      (r) => r.build("0.1.0-rc.1+unknown"),
      "the build says 0.1.0-rc.1+unknown",
    ],
    [
      "a build of another commit",
      (r) => r.build("0.1.0-rc.1+0000000"),
      "the build says 0.1.0-rc.1+0000000",
    ],
    [
      "no build",
      (r) => rmSync(join(r.dir, "packages/shared-contracts/dist"), { recursive: true }),
      "no Build Version; run npm run build first",
    ],
  ];
  for (const [name, change, reason] of cases) {
    await t.test(name, (t) => {
      const r = release(t);
      change(r);
      const { errors } = deployCheck(r.dir, r.tag);
      const want = reason.replace("COMMIT", r.commit);
      assert.ok(
        errors.some((e) => e.includes(want)),
        `${want}\n  got: ${errors.join("\n  ")}`,
      );
    });
  }
});

test("the tag must exist, be annotated, and match the version", { skip }, (t) => {
  const light = release(t, "0.1.0-rc.1", { annotated: false });
  assert.ok(deployCheck(light.dir, light.tag).errors.some((e) => e.includes("lightweight tag")));
  const r = release(t);
  assert.ok(
    deployCheck(r.dir, "v0.1.0-rc.2").errors.some((e) => e.includes("there is no tag v0.1.0-rc.2")),
  );
  assert.ok(
    deployCheck(r.dir, "v0.1.0-rc.2").errors.some((e) =>
      e.includes('package.json: version is "0.1.0-rc.1", not 0.1.0-rc.2'),
    ),
  );
  for (const bad of ["0.1.0", "vbanana", "", undefined]) {
    assert.match(deployCheck(r.dir, bad).errors[0], /is not a release tag/);
  }
});

test("a version with no CHANGELOG section is refused", { skip }, (t) => {
  const r = release(t);
  write(r.dir, "CHANGELOG.md", "# Changelog\n\n## Unreleased\n");
  r.git("add", "-A");
  r.git("commit", "-q", "--no-gpg-sign", "-m", "drop the section");
  r.git("tag", "-f", "-a", "--no-sign", r.tag, "-m", "moved");
  r.build(`0.1.0-rc.1+${r.git("rev-parse", "HEAD").slice(0, 7)}`);
  assert.ok(
    deployCheck(r.dir, r.tag).errors.some((e) =>
      e.includes('no "## [0.1.0-rc.1] - YYYY-MM-DD" section'),
    ),
  );
});

test("the CLI exits 0 on a pass and 1 with reasons on a refusal", { skip }, (t) => {
  const r = release(t);
  mkdirSync(join(r.dir, "scripts"), { recursive: true });
  for (const f of ["deploy-check.mjs", "check-versions.mjs", "build-info.mjs"]) {
    cpSync(join(scripts, f), join(r.dir, "scripts", f));
  }
  // The copied scripts are untracked files, so commit them under the tag too.
  write(r.dir, ".gitignore", "dist/\nnode_modules/\npackages/shared-contracts/src/generated/\n");
  r.git("add", "-A");
  r.git("commit", "-q", "--no-gpg-sign", "-m", "scripts");
  r.git("tag", "-f", "-a", "--no-sign", r.tag, "-m", "moved");
  r.build(`0.1.0-rc.1+${r.git("rev-parse", "HEAD").slice(0, 7)}`);
  const run = (...args) =>
    spawnSync(process.execPath, [join(r.dir, "scripts/deploy-check.mjs"), ...args], {
      encoding: "utf8",
    });
  const ok = run(r.tag);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(
    ok.stdout,
    /^Deploy check passed: v0\.1\.0-rc\.1 at [0-9a-f]{7}, Build Version 0\.1\.0-rc\.1\+[0-9a-f]{7}\.\n$/,
  );
  write(r.dir, "notes.txt", "x");
  const refused = run(r.tag);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /^Do not deploy v0\.1\.0-rc\.1:\n {2}the working tree has changes/);
  assert.equal(run().status, 2);
});
