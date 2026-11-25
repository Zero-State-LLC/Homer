import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RequestStore, StoreUnavailableError } from "../src/index.js";

const ID = "WR-2026-11-23-zer-62";
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "work-request-store-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("Work Request store", () => {
  it("refuses a missing directory and a file in its place", async () => {
    await expect(RequestStore.open(join(directory, "missing"))).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
    const file = join(directory, "file");
    await writeFile(file, "");
    await expect(RequestStore.open(file)).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it("refuses a store it cannot write", async () => {
    if (process.getuid?.() === 0) return; // root ignores permissions
    await chmod(directory, 0o500);
    try {
      await expect(RequestStore.open(directory)).rejects.toBeInstanceOf(StoreUnavailableError);
    } finally {
      await chmod(directory, 0o700);
    }
  });

  it("records once and returns the exact bytes", async () => {
    const store = await RequestStore.open(directory);
    expect(await store.read(ID)).toBeUndefined();
    expect(await store.record(ID, '{"a": 1}\n', '{"tier": "low"}\n')).toBe("recorded");
    const record = await store.read(ID);
    expect(record?.bytes).toBe('{"a": 1}\n');
    expect(record?.request).toEqual({ a: 1 });
    expect(record?.risk).toEqual({ tier: "low" });
  });

  it("never overwrites a record", async () => {
    const store = await RequestStore.open(directory);
    await store.record(ID, '{"first": true}\n', '{"tier": "low"}\n');
    expect(await store.record(ID, '{"second": true}\n', '{"tier": "high"}\n')).toBe("exists");
    expect(await readFile(join(directory, `${ID}.json`), "utf8")).toBe('{"first": true}\n');
    expect(await readFile(join(directory, `${ID}.risk.json`), "utf8")).toBe('{"tier": "low"}\n');
  });

  it("treats a decision file without its request as no record, and replaces it", async () => {
    await writeFile(join(directory, `${ID}.risk.json`), '{"orphan": true}\n');
    const store = await RequestStore.open(directory);
    expect(await store.read(ID)).toBeUndefined();
    expect(await store.record(ID, '{"a": 1}\n', '{"tier": "medium"}\n')).toBe("recorded");
    expect((await store.read(ID))?.risk).toEqual({ tier: "medium" });
  });

  it("leaves no temporary or lock files behind", async () => {
    const store = await RequestStore.open(directory);
    await store.record(ID, "{}\n", "{}\n");
    expect((await readdir(directory)).sort()).toEqual([`${ID}.json`, `${ID}.risk.json`]);
  });

  it("refuses while another emission holds the id's lock", async () => {
    await writeFile(join(directory, `.${ID}.lock`), "");
    const store = await RequestStore.open(directory);
    await expect(store.record(ID, "{}\n", "{}\n")).rejects.toThrow(/stale lock/);
    expect(await store.read(ID)).toBeUndefined();
  });

  it("stops on a record that is not JSON rather than replace it", async () => {
    await writeFile(join(directory, `${ID}.json`), "not json");
    const store = await RequestStore.open(directory);
    await expect(store.read(ID)).rejects.toBeInstanceOf(StoreUnavailableError);
  });

  it("refuses an id that is not a requestId", async () => {
    const store = await RequestStore.open(directory);
    await expect(store.read("../escape")).rejects.toThrow(/requestId/);
  });
});
