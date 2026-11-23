import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { lineDistance, listTreeChanges, readAcceptedFile } from "../src/index.js";

const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A reference copy and an agent copy holding the same files. */
async function trees(files: Record<string, string | Buffer>) {
  const root = await mkdtemp(join(tmpdir(), "curator-tree-"));
  made.push(root);
  const base = join(root, "base");
  const work = join(root, "work");
  for (const dir of [base, work]) {
    for (const [path, contents] of Object.entries(files)) {
      const full = join(dir, path);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, contents, { mode: 0o644 });
    }
  }
  return { base, work };
}

const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);

describe("line distance", () => {
  test("counts added plus removed lines", () => {
    expect(lineDistance(["a", "b"], ["a", "b"])).toBe(0);
    expect(lineDistance(["a", "b", "c"], ["a", "x", "c"])).toBe(2);
    expect(lineDistance(["a", "c"], ["a", "b", "c"])).toBe(1);
    expect(lineDistance([], ["a", "b", "c"])).toBe(3);
    expect(lineDistance(["a", "b"], [])).toBe(2);
    expect(lineDistance(["a", "b", "c", "d"], ["d", "c", "b", "a"])).toBe(6);
  });

  test("stops counting past the cap", () => {
    const many = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    expect(lineDistance([], many, 10)).toBe(11);
  });
});

describe("tree changes", () => {
  test("identical trees, including binary files, have no changes", async () => {
    const { base, work } = await trees({ "CONTEXT.md": "# A\n", "docs/logo.png": binary });
    expect(await listTreeChanges(base, work)).toEqual([]);
  });

  test("edits, additions and deletions are reported with line counts", async () => {
    const { base, work } = await trees({
      "CONTEXT.md": "# Glossary\nold\nsame\n",
      "docs/map.md": "map\n",
    });
    await writeFile(join(work, "CONTEXT.md"), "# Glossary\nnew\nsame\nmore\n");
    await writeFile(join(work, "docs/agents.md"), "one\ntwo\n");
    await rm(join(work, "docs/map.md"));
    const plain = { type: "file", executable: false, modeChanged: false, text: true };
    expect(await listTreeChanges(base, work)).toEqual([
      { path: "CONTEXT.md", status: "modified", linesChanged: 3, ...plain },
      { path: "docs/agents.md", status: "added", linesChanged: 2, ...plain },
      { path: "docs/map.md", status: "deleted", linesChanged: 1, ...plain },
    ]);
  });

  test("symlinks, mode changes, executables and binary edits are visible to the checks", async () => {
    const { base, work } = await trees({ "AGENTS.md": "a\n", "docs/logo.png": binary });
    await symlink("/etc/passwd", join(work, "link.md"));
    await chmod(join(work, "AGENTS.md"), 0o755);
    await writeFile(join(work, "run.md"), "#!/bin/sh\n", { mode: 0o755 });
    await writeFile(join(work, "docs/logo.png"), Buffer.from([0x00, 0xff]));
    const changes = await listTreeChanges(base, work);
    expect(changes).toEqual([
      {
        path: "AGENTS.md",
        status: "modified",
        type: "file",
        executable: true,
        modeChanged: true,
        text: true,
        linesChanged: 0,
      },
      {
        path: "docs/logo.png",
        status: "modified",
        type: "file",
        executable: false,
        modeChanged: false,
        text: false,
        linesChanged: 0,
      },
      {
        path: "link.md",
        status: "added",
        type: "symlink",
        executable: true,
        modeChanged: false,
        text: false,
        linesChanged: 0,
      },
      {
        path: "run.md",
        status: "added",
        type: "file",
        executable: true,
        modeChanged: false,
        text: true,
        linesChanged: 1,
      },
    ]);
  });

  test("a folder replaced by a symlink shows as deletions and a symlink", async () => {
    const { base, work } = await trees({ "docs/agents/a.md": "a\n" });
    await rm(join(work, "docs/agents"), { recursive: true });
    await symlink("/home", join(work, "docs/agents"));
    const changes = await listTreeChanges(base, work);
    expect(changes.map((c) => [c.path, c.status, c.type])).toEqual([
      ["docs/agents", "added", "symlink"],
      ["docs/agents/a.md", "deleted", "file"],
    ]);
  });
});

describe("reading an accepted file", () => {
  test("reads a regular text file", async () => {
    const { work } = await trees({ "docs/agents/a.md": "hello\n" });
    expect(await readAcceptedFile(work, "docs/agents/a.md")).toBe("hello\n");
  });

  test("refuses traversal, symlinks anywhere on the path, and binary files", async () => {
    const { work } = await trees({ "docs/real/a.md": "x\n", "docs/b.md": "y\n" });
    await symlink(join(work, "docs/real"), join(work, "docs/agents"));
    await symlink(join(work, "docs/b.md"), join(work, "docs/c.md"));
    await writeFile(join(work, "docs/bin.md"), binary);
    await expect(readAcceptedFile(work, "../outside.md")).rejects.toThrow();
    await expect(readAcceptedFile(work, "/etc/passwd")).rejects.toThrow();
    await expect(readAcceptedFile(work, "docs/agents/a.md")).rejects.toThrow();
    await expect(readAcceptedFile(work, "docs/c.md")).rejects.toThrow();
    await expect(readAcceptedFile(work, "docs/bin.md")).rejects.toThrow();
  });
});
