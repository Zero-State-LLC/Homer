import { describe, expect, test } from "vitest";
import { MAX_PENDING_INPUT_BYTES, nodeProcesses } from "../src/index.js";

describe("real processes", () => {
  test("output is captured without a shell", async () => {
    const result = await nodeProcesses.run(process.execPath, ["-e", "console.log('$HOME')"]);
    expect(result).toEqual({ code: 0, stdout: "$HOME\n", stderr: "" });
  });

  test("a child that stops reading its input is killed before the host buffers too much", async () => {
    const child = nodeProcesses.start(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
    const line = "x".repeat(64 * 1024) + "\n";
    for (let sent = 0; sent <= MAX_PENDING_INPUT_BYTES * 2; sent += line.length) child.write(line);
    expect(await child.exited).not.toBe(0);
  });
});
