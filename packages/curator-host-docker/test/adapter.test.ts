/* Test adapters intentionally implement async I/O contracts in memory. */
/* eslint-disable @typescript-eslint/require-await */
import {
  CURATOR_INSTRUCTIONS,
  PROVIDERS,
  decidePermission,
  type SessionSpec,
} from "@zs-home/curator-runner";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  DockerHostAdapter,
  curatorPrompt,
  providerBaseUrl,
  type DockerHostConfig,
  type InteractiveProcess,
  type ProcessResult,
  type Processes,
  type RunOptions,
} from "../src/index.js";

const digest = "@sha256:" + "a".repeat(64);
const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function folders() {
  const root = await mkdtemp(join(tmpdir(), "curator-docker-"));
  made.push(root);
  const secretsDir = join(root, "secrets");
  const workRoot = join(root, "runs");
  const inputs = join(root, "inputs");
  for (const dir of [secretsDir, workRoot, inputs]) await mkdir(dir);
  await writeFile(join(secretsDir, "CLOUDFLARE_AI_TOKEN"), "cf-test-value\n", { mode: 0o600 });
  await writeFile(join(secretsDir, "not a name"), "x");
  return { root, secretsDir, workRoot, inputs };
}

function config(dirs: { root: string; secretsDir: string; workRoot: string }): DockerHostConfig {
  return {
    hostId: "curator-1",
    runnerClone: join(dirs.root, "clone"),
    workRoot: dirs.workRoot,
    secretsDir: dirs.secretsDir,
    proxyImage: "node" + digest,
    harnesses: { hermes: { image: "homer/hermes" + digest, command: ["hermes", "acp"] } },
    cloudflareAccountId: "0123456789abcdef0123456789abcdef",
    user: { uid: 1000, gid: 1000 },
    fetch: false,
  };
}

interface Call {
  command: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
}

/** Fake docker, git and tar. `tar` writes the exported files; the agent speaks ACP. */
function fakeProcesses(options: { probe?: number; leftover?: string } = {}) {
  const calls: Call[] = [];
  const agentReceived: string[] = [];
  const processes: Processes = {
    async run(command, args, runOptions: RunOptions = {}): Promise<ProcessResult> {
      calls.push({ command, args, env: runOptions.env ?? {} });
      const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
      if (command === "git" && args.includes("rev-parse")) return ok("b".repeat(40) + "\n");
      if (command === "git" && args.includes("archive")) {
        await writeFile(args[args.indexOf("-o") + 1] ?? "", "tar");
        return ok();
      }
      if (command === "tar") {
        const target = args[args.indexOf("-C") + 1] ?? "";
        await writeFile(join(target, "CONTEXT.md"), "# Glossary\n");
        return ok();
      }
      if (args[0] === "version") return ok("29.1.0\n");
      if (args[0] === "image" && args.includes("--format")) return ok("0.15.2\n");
      if (args[0] === "run" && args.includes("/probe.mjs")) {
        return { code: options.probe ?? 0, stdout: "", stderr: "" };
      }
      if (args[0] === "ps") return ok(options.leftover ?? "");
      if (args[0] === "network" && args[1] === "inspect")
        return { code: 1, stdout: "", stderr: "" };
      return ok();
    },
    start(command, args, runOptions: RunOptions = {}): InteractiveProcess {
      calls.push({ command, args, env: runOptions.env ?? {} });
      let stdout: (chunk: string) => void = () => undefined;
      let exit: (code: number) => void = () => undefined;
      const exited = new Promise<number>((resolve) => {
        exit = resolve;
      });
      const send = (body: unknown) => queueMicrotask(() => stdout(JSON.stringify(body) + "\n"));
      return {
        write(chunk) {
          agentReceived.push(chunk);
          const message = JSON.parse(chunk) as { id?: number; method?: string };
          if (message.method === "initialize") {
            send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
          } else if (message.method === "session/new") {
            send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "s1" } });
          } else if (message.method === "session/prompt") {
            send({
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: "s1",
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "Report" },
                },
              },
            });
            send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
          }
        },
        endInput: () => undefined,
        onStdout(listener) {
          stdout = listener;
        },
        exited,
        kill: () => exit(137),
      };
    },
  };
  return { processes, calls, agentReceived };
}

const profile = {
  revision: 3,
  harness: "hermes",
  harnessVersion: "0.15.2",
  provider: "cloudflare" as const,
  model: "@cf/example/model",
  host: "curator-1",
  permissionPolicy: "curator-default" as const,
};

describe("configuration", () => {
  test("unpinned images, Windows drives, root and bad subnets are refused", async () => {
    const dirs = await folders();
    const good = config(dirs);
    expect(() => new DockerHostAdapter({ ...good, proxyImage: "node:22" })).toThrow(TypeError);
    expect(() => new DockerHostAdapter({ ...good, workRoot: "/mnt/c/curator" })).toThrow(TypeError);
    expect(() => new DockerHostAdapter({ ...good, user: { uid: 0, gid: 0 } })).toThrow(TypeError);
    expect(() => new DockerHostAdapter({ ...good, subnet: "10.0.0.0/16" })).toThrow(TypeError);
    expect(() => new DockerHostAdapter(good, fakeProcesses().processes)).not.toThrow();
  });

  test("Cloudflare needs an account id; Anthropic uses the harness default", async () => {
    const dirs = await folders();
    const good = config(dirs);
    expect(providerBaseUrl(PROVIDERS.cloudflare, good)).toBe(
      "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1",
    );
    expect(() =>
      providerBaseUrl(PROVIDERS.cloudflare, { ...good, cloudflareAccountId: "x" }),
    ).toThrow();
    expect(providerBaseUrl(PROVIDERS.anthropic, good)).toBeNull();
  });
});

describe("the Docker host adapter", () => {
  test("describes the host with credential names only", async () => {
    const dirs = await folders();
    const adapter = new DockerHostAdapter(config(dirs), fakeProcesses().processes);
    const description = await adapter.describe();
    expect(description).toMatchObject({
      hostId: "curator-1",
      container: { runtime: "docker 29.1.0", egressAllowlist: true },
      gpu: "none",
      localEndpoints: [],
      harnesses: { hermes: "0.15.2" },
      credentials: ["CLOUDFLARE_AI_TOKEN"],
    });
    expect(JSON.stringify(description)).not.toContain("cf-test-value");
  });

  test("runs a session in a locked-down container behind the proxy, then stops it", async () => {
    const dirs = await folders();
    const fake = fakeProcesses();
    const adapter = new DockerHostAdapter(config(dirs), fake.processes);
    const workspace = await adapter.exportTree();
    expect(workspace).toMatchObject({ root: "/workspace", inputsRoot: "/inputs" });
    const spec: SessionSpec = {
      workspace,
      inputs: { hostPath: dirs.inputs, flags: [{ link: "buzz://message?id=e1", complete: true }] },
      profile,
      provider: PROVIDERS.cloudflare,
      instructions: CURATOR_INSTRUCTIONS,
      maxDurationMs: 60_000,
      decide: (request) =>
        decidePermission(request, { workspace: "/workspace", inputs: "/inputs" }),
    };
    expect(await adapter.runSession(spec)).toEqual({ outcome: "completed", report: "Report" });

    const docker = fake.calls.filter((c) => c.command === "docker");
    const network = docker.find((c) => c.args[0] === "network" && c.args[1] === "create");
    expect(network?.args).toContain("--internal");
    const proxy = docker.find((c) => c.args[0] === "create");
    expect(proxy?.args.slice(-3)).toEqual(["172.31.250.2", "3128", "api.cloudflare.com"]);
    const probeIndex = docker.findIndex((c) => c.args.includes("/probe.mjs"));
    const agentIndex = docker.findIndex((c) => c.args[0] === "run" && c.args.includes("-i"));
    expect(probeIndex).toBeGreaterThan(-1);
    expect(agentIndex).toBeGreaterThan(probeIndex);

    const agent = docker[agentIndex];
    const args = agent?.args ?? [];
    for (const flag of ["--read-only", "--cap-drop", "ALL", "no-new-privileges", "1000:1000"]) {
      expect(args).toContain(flag);
    }
    expect(args).toContain(`type=bind,src=${dirs.inputs},dst=/inputs,readonly`);
    expect(args).toContain("HTTPS_PROXY=http://172.31.250.2:3128");
    expect(args).toContain("CURATOR_MODEL=@cf/example/model");
    expect(args).toContain("CLOUDFLARE_AI_TOKEN");
    expect(args.join(" ")).not.toContain("cf-test-value");
    expect(agent?.env).toEqual({ CLOUDFLARE_AI_TOKEN: "cf-test-value" });
    expect(args.slice(-3)).toEqual(["homer/hermes" + digest, "hermes", "acp"]);

    const prompt = fake.agentReceived.find((line) => line.includes("session/prompt")) ?? "";
    expect(prompt).toContain("buzz://message?id=e1");
    const after = docker.slice(agentIndex + 1).map((c) => c.args.slice(0, 2).join(" "));
    expect(after).toEqual(["rm -f", "ps -a"]);

    await adapter.cleanup(workspace);
    expect(await readdir(dirs.workRoot)).toEqual([]);
  });

  test("open egress stops the session before the harness starts", async () => {
    const dirs = await folders();
    const fake = fakeProcesses({ probe: 2 });
    const adapter = new DockerHostAdapter(config(dirs), fake.processes);
    const workspace = await adapter.exportTree();
    const spec: SessionSpec = {
      workspace,
      inputs: { hostPath: dirs.inputs, flags: [] },
      profile,
      provider: PROVIDERS.cloudflare,
      instructions: "x",
      maxDurationMs: 60_000,
      decide: () => ({ outcome: { outcome: "cancelled" } }),
    };
    await expect(adapter.runSession(spec)).rejects.toThrow("egress is not limited");
    expect(fake.calls.some((c) => c.args.includes("-i"))).toBe(false);
    await adapter.cleanup(workspace);
  });

  test("cleanup reports containers left behind, after removing the folders", async () => {
    const dirs = await folders();
    const adapter = new DockerHostAdapter(
      config(dirs),
      fakeProcesses({ leftover: "abc123\n" }).processes,
    );
    const workspace = await adapter.exportTree();
    await expect(adapter.cleanup(workspace)).rejects.toThrow("left behind");
    expect(await readdir(dirs.workRoot)).toEqual([]);
  });

  test("the prompt names every flag", () => {
    const text = curatorPrompt({
      workspace: { id: "w", root: "/workspace", inputsRoot: "/inputs" },
      inputs: {
        hostPath: "/x",
        flags: [
          { link: "a", complete: true },
          { link: "b", complete: false },
        ],
      },
      profile,
      provider: PROVIDERS.cloudflare,
      instructions: "Rules.",
      maxDurationMs: 1,
      decide: () => ({ outcome: { outcome: "cancelled" } }),
    });
    expect(text).toBe(
      "Rules.\n\nThe repository copy is /workspace. The inputs, read-only, are in /inputs.\nFlags:\n- a\n- b",
    );
  });
});
