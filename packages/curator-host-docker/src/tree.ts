/**
 * Finds what the agent changed by comparing its folder with a reference copy it never saw.
 * Runs on the host after the container has stopped. Symlinks are reported, never followed.
 */
import type { Change } from "@zs-home/curator-runner";
import { Buffer } from "node:buffer";
import { constants } from "node:fs";
import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import { join, sep } from "node:path";

/** Entries walked per tree before the folder is treated as hostile. */
export const MAX_ENTRIES = 50_000;
/** Largest file compared as text. Anything bigger is reported as not text. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
/** Edit distance beyond which the exact count no longer matters. */
export const DISTANCE_CAP = 10_000;

type EntryType = Change["type"];

interface Entry {
  readonly type: EntryType;
  readonly mode: number;
  readonly size: number;
}

async function walk(root: string): Promise<Map<string, Entry>> {
  const entries = new Map<string, Entry>();
  const pending: string[] = [""];
  let seen = 0;
  while (pending.length > 0) {
    const relative = pending.pop() ?? "";
    for (const name of await readdir(join(root, relative))) {
      if (++seen > MAX_ENTRIES) throw new Error("too many entries");
      const path = relative === "" ? name : `${relative}/${name}`;
      const stats = await lstat(join(root, path));
      if (stats.isDirectory()) {
        pending.push(path);
        continue;
      }
      const type: EntryType = stats.isFile()
        ? "file"
        : stats.isSymbolicLink()
          ? "symlink"
          : "other";
      entries.set(path, { type, mode: stats.mode & 0o7777, size: stats.size });
    }
  }
  return entries;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/** The file's text, or null when it is too big, not UTF-8, or contains NUL. */
async function readText(path: string, size: number): Promise<string | null> {
  if (size > MAX_TEXT_BYTES) return null;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = await handle.readFile();
    if (bytes.length > MAX_TEXT_BYTES || bytes.includes(0)) return null;
    return decoder.decode(bytes);
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/** True when two regular files hold the same bytes. Reads in chunks, so size does not matter. */
async function sameBytes(left: string, right: string): Promise<boolean> {
  const a = await open(left, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const b = await open(right, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const size = 1024 * 1024;
      const bufferA = Buffer.alloc(size);
      const bufferB = Buffer.alloc(size);
      for (;;) {
        const [readA, readB] = await Promise.all([
          a.read(bufferA, 0, size),
          b.read(bufferB, 0, size),
        ]);
        if (readA.bytesRead !== readB.bytesRead) return false;
        if (readA.bytesRead === 0) return true;
        if (!bufferA.subarray(0, readA.bytesRead).equals(bufferB.subarray(0, readB.bytesRead))) {
          return false;
        }
      }
    } finally {
      await b.close();
    }
  } finally {
    await a.close();
  }
}

/**
 * True when the text holds one of the secrets: as is, split by whitespace or line breaks, or
 * base64-encoded. Best effort: an agent determined to disguise a secret can, so the token must
 * also be narrow and revocable, and every pull request is reviewed.
 */
export function holdsSecret(text: string, secrets: readonly string[]): boolean {
  if (secrets.length === 0) return false;
  const squeezed = text.replace(/\s+/g, "");
  return secrets.some((secret) => {
    if (secret === "") return false;
    const forms = [
      secret,
      Buffer.from(secret).toString("base64").replace(/=+$/, ""),
      Buffer.from(secret).toString("base64url"),
    ];
    return forms.some((form) => text.includes(form) || squeezed.includes(form));
  });
}

function lines(text: string): string[] {
  if (text === "") return [];
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * Lines added plus lines removed between two texts (Myers), as `git diff --numstat` counts
 * them. Returns more than `cap` once the distance passes it.
 */
export function lineDistance(
  before: readonly string[],
  after: readonly string[],
  cap = DISTANCE_CAP,
): number {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  const a = before.slice(start, endBefore);
  const b = after.slice(start, endAfter);
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, cap);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return d;
    }
  }
  return cap + 1;
}

async function unchanged(
  baseRoot: string,
  workRoot: string,
  path: string,
  before: Entry,
  after: Entry,
): Promise<boolean> {
  if (before.type !== after.type || before.mode !== after.mode) return false;
  if (before.type === "file") {
    return before.size === after.size && sameBytes(join(baseRoot, path), join(workRoot, path));
  }
  if (before.type === "symlink") {
    return (await readlink(join(baseRoot, path))) === (await readlink(join(workRoot, path)));
  }
  return false;
}

async function compare(
  baseRoot: string,
  workRoot: string,
  path: string,
  before: Entry | undefined,
  after: Entry | undefined,
  secrets: readonly string[],
): Promise<Change | null> {
  const current = after ?? before;
  if (current === undefined) return null;
  if (
    before !== undefined &&
    after !== undefined &&
    (await unchanged(baseRoot, workRoot, path, before, after))
  ) {
    return null;
  }
  const textOf = async (root: string, entry: Entry | undefined) =>
    entry?.type === "file" ? readText(join(root, path), entry.size) : null;
  const oldText = await textOf(baseRoot, before);
  const newText = await textOf(workRoot, after);
  const status: Change["status"] =
    before === undefined ? "added" : after === undefined ? "deleted" : "modified";
  return {
    path,
    status,
    type: current.type,
    executable: after !== undefined && (after.mode & 0o111) !== 0,
    modeChanged: before !== undefined && after !== undefined && before.mode !== after.mode,
    text: status === "deleted" ? oldText !== null : newText !== null,
    linesChanged: lineDistance(lines(oldText ?? ""), lines(newText ?? "")),
    containsSecret: newText !== null && holdsSecret(newText, secrets),
  };
}

/**
 * Every path that differs between the reference copy and the agent's folder. `secrets` are the
 * credentials the agent's container was given; a change holding one is marked.
 */
export async function listTreeChanges(
  baseRoot: string,
  workRoot: string,
  secrets: readonly string[] = [],
): Promise<Change[]> {
  const [base, work] = await Promise.all([walk(baseRoot), walk(workRoot)]);
  const paths = [...new Set([...base.keys(), ...work.keys()])].sort();
  const changes: Change[] = [];
  for (const path of paths) {
    const change = await compare(baseRoot, workRoot, path, base.get(path), work.get(path), secrets);
    if (change !== null) changes.push(change);
  }
  return changes;
}

/**
 * Reads an accepted file from the agent's folder. Refuses a symlink anywhere on the path, and
 * anything that is not a regular UTF-8 text file.
 */
export async function readAcceptedFile(
  workRoot: string,
  path: string,
  secrets: readonly string[] = [],
): Promise<string> {
  if (path.startsWith("/") || path.split("/").some((part) => part === "" || part === "..")) {
    throw new Error("unsafe path");
  }
  const root = await realpath(workRoot);
  const full = join(root, path);
  if ((await realpath(full)) !== full || !full.startsWith(root + sep)) {
    throw new Error("path leaves the folder");
  }
  const stats = await lstat(full);
  if (!stats.isFile()) throw new Error("not a regular file");
  const text = await readText(full, stats.size);
  if (text === null) throw new Error("not text");
  if (holdsSecret(text, secrets)) throw new Error("holds a credential");
  return text;
}
