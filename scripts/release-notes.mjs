#!/usr/bin/env node
// node scripts/release-notes.mjs vX.Y.Z
// node scripts/release-notes.mjs Unreleased
//
// Prints one version's CHANGELOG section, without its "## " heading, for the
// GitHub Release Danny creates for that tag (versioning spec, "Cut a
// release"). "Unreleased" previews what the next release pull request will
// turn into a section. It reads CHANGELOG.md and changes nothing.
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGELOG, SEMVER, parseChangelog, repositoryRoot } from "./check-versions.mjs";

/** The section's body for `which` (a tag, a version, or "Unreleased"), or throws. */
export function releaseNotes(text, which) {
  const unreleased = which === "Unreleased";
  const version = unreleased ? undefined : String(which ?? "").replace(/^v/, "");
  if (!unreleased && !SEMVER.test(version)) {
    throw new Error(`"${which}" is not a release tag such as v0.1.0, or "Unreleased"`);
  }
  const section = parseChangelog(text).find((s) =>
    unreleased ? s.kind === "unreleased" : s.kind === "release" && s.version === version,
  );
  if (!section) {
    throw new Error(
      unreleased
        ? `${CHANGELOG} has no "## Unreleased"`
        : `${CHANGELOG} has no section for ${version}`,
    );
  }
  const body = section.body.join("\n").trim();
  if (body === "") throw new Error(`${CHANGELOG}: "${section.heading}" is empty`);
  return `${body}\n`;
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
    console.error("usage: node scripts/release-notes.mjs vX.Y.Z | Unreleased");
    process.exit(2);
  }
  try {
    const text = readFileSync(join(repositoryRoot(), CHANGELOG), "utf8");
    process.stdout.write(releaseNotes(text, args[0]));
  } catch (error) {
    console.error(`release-notes: ${error.message}`);
    process.exit(1);
  }
}
