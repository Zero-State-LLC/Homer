import type { Runner } from "./run.js";

/**
 * Reviewed configuration, the policy file and manual requests, is read from a
 * git ref, `origin/main` by default, never from the working tree, so an
 * unreviewed local edit cannot reach a recorded request or the judge.
 */

export const DEFAULT_REVIEWED_REF = "origin/main";

export class ReviewedRefUnreadableError extends Error {
  constructor(detail: string) {
    super(`the reviewed ref could not be read: ${detail}`);
    this.name = "ReviewedRefUnreadableError";
  }
}

/** A plain branch name: no option, range, reflog or path syntax. */
const GIT_REF = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/;

/** Throw unless `ref` is a plain branch name. Checked before anything runs. */
export function checkReviewedRef(ref: string): void {
  if (!GIT_REF.test(ref)) {
    throw new ReviewedRefUnreadableError(`${ref} is not a plain branch name.`);
  }
}

/**
 * `git show <ref>:<path>`. A path the ref lacks is `undefined`; a ref the
 * checkout lacks, or any other git failure, throws, since a fetch would fix it.
 */
export async function readReviewedFile(
  run: Runner,
  repositoryRoot: string,
  ref: string,
  path: string,
): Promise<string | undefined> {
  checkReviewedRef(ref);
  const result = await run("git", ["-C", repositoryRoot, "show", `${ref}:${path}`]);
  if (result.code === 0) return result.stdout;
  if (/does not exist in|exists on disk, but not in/.test(result.stderr)) return undefined;
  throw new ReviewedRefUnreadableError(`\`git show ${ref}:${path}\` failed; fetch ${ref} first.`);
}
