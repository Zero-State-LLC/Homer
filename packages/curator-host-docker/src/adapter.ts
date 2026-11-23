/**
 * The Docker host adapter: runs the curator's harness in a locked-down container on Linux,
 * including inside WSL2 on Windows. See specs/knowledge-loop/spec.md, "Docker host adapter".
 */
import type {
  Change,
  HostAdapter,
  HostDescription,
  ProviderSpec,
  SessionResult,
  SessionSpec,
  WorkspaceHandle,
} from "@zs-home/curator-runner";
import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { lineSplitter, runAcpTurn, type AcpTransport } from "./acp.js";
import { nodeProcesses, type Processes } from "./processes.js";
import { PROBE_EGRESS_OPEN, PROBE_SCRIPT, PROXY_PORT, PROXY_SCRIPT } from "./proxy.js";
import { listTreeChanges, readAcceptedFile } from "./tree.js";

/** Image label that states the harness version an image holds. */
export const HARNESS_VERSION_LABEL = "homer.curator.harness-version";
/** Label on every container and network a run creates, so cleanup can find them. */
export const RUN_LABEL = "homer.curator.run";
export const WORKSPACE_PATH = "/workspace";
export const INPUTS_PATH = "/inputs";

export interface HarnessImage {
  /** Pinned by digest: `name@sha256:<64 hex>`. */
  readonly image: string;
  /** The command that speaks ACP on standard input and output. */
  readonly command: readonly string[];
}

export interface DockerHostConfig {
  readonly hostId: string;
  /** The runner's own clone of Homer. Never mounted into a container. */
  readonly runnerClone: string;
  /** Parent folder of every run's folders. Must be on the Linux file system. */
  readonly workRoot: string;
  /** One file per credential, named by the credential, readable only by the runner. */
  readonly secretsDir: string;
  /** A Node image pinned by digest, for the proxy and the egress probe. */
  readonly proxyImage: string;
  readonly harnesses: Readonly<Record<string, HarnessImage>>;
  /** Needed for the `cloudflare` provider. Configuration, not a secret. */
  readonly cloudflareAccountId?: string;
  /** The internal network's /24 subnet. Default 172.31.250.0/24. */
  readonly subnet?: string;
  /** A public address the probe must fail to reach directly. Default 1.1.1.1. */
  readonly probeTarget?: string;
  /** User the harness runs as, so the runner owns every file it writes. Default: the runner. */
  readonly user?: { readonly uid: number; readonly gid: number };
  readonly memory?: string;
  readonly cpus?: string;
  /** Fetch `origin/main` before each export. Default true. */
  readonly fetch?: boolean;
  readonly gpu?: HostDescription["gpu"];
  readonly clientVersion?: string;
}

interface Run {
  readonly dir: string;
  readonly base: string;
  readonly work: string;
  readonly name: string;
}

const DIGEST = /^[a-z0-9][a-z0-9._/:-]*@sha256:[0-9a-f]{64}$/;
const CREDENTIAL = /^[A-Z][A-Z0-9_]*$/;
const SUBNET = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.0\/24$/;
const WINDOWS_DRIVE = /^\/mnt\/[a-z](\/|$)/i;

function requireLinuxPath(label: string, path: string): void {
  if (!isAbsolute(path)) throw new TypeError(`${label} must be an absolute path.`);
  if (WINDOWS_DRIVE.test(path)) {
    throw new TypeError(`${label} must be on the Linux file system, not a Windows drive.`);
  }
}

/** The OpenAI-compatible base URL a harness should use, or null for the harness default. */
export function providerBaseUrl(provider: ProviderSpec, config: DockerHostConfig): string | null {
  switch (provider.id) {
    case "openai":
      return "https://api.openai.com/v1";
    case "xai":
      return "https://api.x.ai/v1";
    case "cloudflare": {
      const account = config.cloudflareAccountId ?? "";
      if (!/^[0-9a-f]{32}$/.test(account)) throw new Error("cloudflare account id missing");
      return `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`;
    }
    default:
      return null;
  }
}

/** The prompt: fixed instructions, then where things are and which flags to report on. */
export function curatorPrompt(spec: SessionSpec): string {
  const flags = spec.inputs.flags.map((flag) => `- ${flag.link}`);
  return [
    spec.instructions,
    "",
    `The repository copy is ${spec.workspace.root}. The inputs, read-only, are in ${spec.workspace.inputsRoot}.`,
    flags.length > 0 ? "Flags:" : "Flags: none. Act only on the reviews in the inputs.",
    ...flags,
  ].join("\n");
}

async function makeRemovable(dir: string): Promise<void> {
  const stats = await lstat(dir).catch(() => null);
  if (stats === null || !stats.isDirectory()) return;
  await chmod(dir, 0o700);
  for (const name of await readdir(dir)) await makeRemovable(join(dir, name));
}

export class DockerHostAdapter implements HostAdapter {
  private readonly runs = new Map<string, Run>();
  private readonly user: { uid: number; gid: number };
  private readonly proxyAddress: string;
  private readonly subnet: string;

  private readonly config: DockerHostConfig;
  private readonly processes: Processes;

  constructor(config: DockerHostConfig, processes: Processes = nodeProcesses) {
    this.config = config;
    this.processes = processes;
    requireLinuxPath("runnerClone", config.runnerClone);
    requireLinuxPath("workRoot", config.workRoot);
    requireLinuxPath("secretsDir", config.secretsDir);
    for (const image of [
      config.proxyImage,
      ...Object.values(config.harnesses).map((h) => h.image),
    ]) {
      if (!DIGEST.test(image)) throw new TypeError("Every image must be pinned by digest.");
    }
    this.subnet = config.subnet ?? "172.31.250.0/24";
    const match = SUBNET.exec(this.subnet);
    if (match === null) throw new TypeError("subnet must be an a.b.c.0/24 range.");
    this.proxyAddress = `${match[1]}.${match[2]}.${match[3]}.2`;
    const uid = config.user?.uid ?? process.getuid?.();
    const gid = config.user?.gid ?? process.getgid?.();
    if (uid === undefined || gid === undefined) throw new TypeError("user is required.");
    if (uid === 0) throw new TypeError("The harness must not run as root.");
    this.user = { uid, gid };
  }

  private docker(args: readonly string[]) {
    return this.processes.run("docker", args);
  }

  private async mustDocker(args: readonly string[]): Promise<string> {
    const result = await this.docker(args);
    if (result.code !== 0) throw new Error(`docker ${args[0] ?? ""} failed`);
    return result.stdout.trim();
  }

  private async git(args: readonly string[]): Promise<string> {
    const result = await this.processes.run("git", [
      "-C",
      this.config.runnerClone,
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ]);
    if (result.code !== 0) throw new Error(`git ${args[0] ?? ""} failed`);
    return result.stdout.trim();
  }

  private run(workspace: WorkspaceHandle): Run {
    const run = this.runs.get(workspace.id);
    if (run === undefined) throw new Error("unknown workspace");
    return run;
  }

  async describe(): Promise<HostDescription> {
    const os =
      process.platform === "linux" ? "linux" : process.platform === "darwin" ? "macos" : "windows";
    const version = await this.docker(["version", "--format", "{{.Server.Version}}"]).catch(
      () => null,
    );
    let container: HostDescription["container"] = null;
    if (version !== null && version.code === 0) {
      const proxy = await this.docker(["image", "inspect", this.config.proxyImage]);
      container = { runtime: `docker ${version.stdout.trim()}`, egressAllowlist: proxy.code === 0 };
    }
    const harnesses: Record<string, string> = {};
    if (container !== null) {
      for (const [id, harness] of Object.entries(this.config.harnesses)) {
        const label = await this.docker([
          "image",
          "inspect",
          "--format",
          `{{index .Config.Labels "${HARNESS_VERSION_LABEL}"}}`,
          harness.image,
        ]);
        const value = label.stdout.trim();
        if (label.code === 0 && value !== "" && value !== "<no value>") harnesses[id] = value;
      }
    }
    const credentials: string[] = [];
    for (const name of await readdir(this.config.secretsDir).catch(() => [] as string[])) {
      if (!CREDENTIAL.test(name)) continue;
      const stats = await lstat(join(this.config.secretsDir, name));
      if (stats.isFile()) credentials.push(name);
    }
    return {
      hostId: this.config.hostId,
      os,
      arch: process.arch,
      container,
      gpu: this.config.gpu ?? "none",
      localEndpoints: [],
      harnesses,
      credentials: credentials.sort(),
    };
  }

  async exportTree(): Promise<WorkspaceHandle> {
    const dir = await mkdtemp(join(this.config.workRoot, "run-"));
    try {
      if (this.config.fetch ?? true) {
        await this.git(["fetch", "--quiet", "--no-tags", "origin", "main"]);
      }
      const sha = await this.git(["rev-parse", "--verify", "origin/main^{commit}"]);
      if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error("bad commit");
      const archive = join(dir, "main.tar");
      await this.git(["archive", "--format=tar", "-o", archive, sha]);
      const base = join(dir, "base");
      const work = join(dir, "work");
      for (const target of [base, work]) {
        await mkdir(target, { mode: 0o700 });
        const tar = await this.processes.run("tar", [
          "-x",
          "--no-same-owner",
          "-f",
          archive,
          "-C",
          target,
        ]);
        if (tar.code !== 0) throw new Error("tar failed");
      }
      await rm(archive);
      const id = randomBytes(6).toString("hex");
      this.runs.set(id, { dir, base, work, name: `homer-curator-${id}` });
      return { id, root: WORKSPACE_PATH, inputsRoot: INPUTS_PATH };
    } catch (error) {
      await makeRemovable(dir);
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }

  private async readSecret(name: string): Promise<string> {
    if (!CREDENTIAL.test(name)) throw new Error("bad credential name");
    const path = join(this.config.secretsDir, name);
    const stats = await lstat(path);
    if (!stats.isFile()) throw new Error("credential is not a regular file");
    const value = (await readFile(path, "utf8")).replace(/\r?\n$/, "");
    if (value === "" || /[\r\n]/.test(value)) throw new Error("credential is malformed");
    return value;
  }

  /** Starts the allowlist proxy and proves, with a probe, that nothing else gets out. */
  private async openEgress(run: Run, provider: ProviderSpec): Promise<void> {
    const { name } = run;
    const label = `${RUN_LABEL}=${name}`;
    const proxyScript = join(run.dir, "proxy.mjs");
    const probeScript = join(run.dir, "probe.mjs");
    await writeFile(proxyScript, PROXY_SCRIPT, { mode: 0o444 });
    await writeFile(probeScript, PROBE_SCRIPT, { mode: 0o444 });
    const locked = [
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      "65534:65534",
      "--pids-limit",
      "64",
      "--memory",
      "256m",
    ];
    await this.mustDocker([
      "network",
      "create",
      "--internal",
      "--subnet",
      this.subnet,
      "--label",
      label,
      `${name}-net`,
    ]);
    await this.mustDocker([
      "create",
      "--name",
      `${name}-proxy`,
      "--label",
      label,
      "--network",
      "bridge",
      ...locked,
      "--mount",
      `type=bind,src=${proxyScript},dst=/proxy.mjs,readonly`,
      this.config.proxyImage,
      "node",
      "/proxy.mjs",
      this.proxyAddress,
      String(PROXY_PORT),
      ...provider.egressHosts,
    ]);
    await this.mustDocker([
      "network",
      "connect",
      "--ip",
      this.proxyAddress,
      `${name}-net`,
      `${name}-proxy`,
    ]);
    await this.mustDocker(["start", `${name}-proxy`]);
    const probe = await this.docker([
      "run",
      "--rm",
      "--name",
      `${name}-probe`,
      "--label",
      label,
      "--network",
      `${name}-net`,
      "--dns",
      "127.0.0.1",
      ...locked,
      "--mount",
      `type=bind,src=${probeScript},dst=/probe.mjs,readonly`,
      this.config.proxyImage,
      "node",
      "/probe.mjs",
      this.proxyAddress,
      String(PROXY_PORT),
      this.config.probeTarget ?? "1.1.1.1",
    ]);
    if (probe.code === PROBE_EGRESS_OPEN) throw new Error("egress is not limited");
    if (probe.code !== 0) throw new Error("egress probe failed");
  }

  async runSession(spec: SessionSpec): Promise<SessionResult> {
    const run = this.run(spec.workspace);
    const harness = Object.hasOwn(this.config.harnesses, spec.profile.harness)
      ? this.config.harnesses[spec.profile.harness]
      : undefined;
    if (harness === undefined) throw new Error("harness image not configured");
    if (spec.provider.local) throw new Error("this adapter has no local model endpoint");
    if (!isAbsolute(spec.inputs.hostPath) || !(await lstat(spec.inputs.hostPath)).isDirectory()) {
      throw new Error("inputs must be a directory");
    }

    // Plain settings go on the command line. The credential travels only in the docker
    // client's environment and is named, never valued, on the command line.
    const settings: Record<string, string> = {
      HOME: "/tmp",
      HTTPS_PROXY: `http://${this.proxyAddress}:${PROXY_PORT}`,
      https_proxy: `http://${this.proxyAddress}:${PROXY_PORT}`,
      HTTP_PROXY: `http://${this.proxyAddress}:${PROXY_PORT}`,
      http_proxy: `http://${this.proxyAddress}:${PROXY_PORT}`,
      NO_PROXY: "",
      no_proxy: "",
      CURATOR_PROVIDER: spec.provider.id,
      CURATOR_MODEL: spec.profile.model,
    };
    const baseUrl = providerBaseUrl(spec.provider, this.config);
    if (baseUrl !== null) settings.CURATOR_BASE_URL = baseUrl;
    const secrets: Record<string, string> = {};
    if (spec.provider.credential !== null) {
      secrets[spec.provider.credential] = await this.readSecret(spec.provider.credential);
    }

    await this.openEgress(run, spec.provider);

    const agent = `${run.name}-agent`;
    const args = [
      "run",
      "-i",
      "--rm",
      "--name",
      agent,
      "--label",
      `${RUN_LABEL}=${run.name}`,
      "--network",
      `${run.name}-net`,
      "--dns",
      "127.0.0.1",
      "--user",
      `${this.user.uid}:${this.user.gid}`,
      "--read-only",
      "--tmpfs",
      "/tmp:rw,size=1g,mode=1777",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "512",
      "--memory",
      this.config.memory ?? "8g",
      "--cpus",
      this.config.cpus ?? "4",
      ...Object.entries(settings).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      ...Object.keys(secrets).flatMap((key) => ["-e", key]),
      "--mount",
      `type=bind,src=${run.work},dst=${WORKSPACE_PATH}`,
      "--mount",
      `type=bind,src=${spec.inputs.hostPath},dst=${INPUTS_PATH},readonly`,
      "--workdir",
      WORKSPACE_PATH,
      harness.image,
      ...harness.command,
    ];
    const child = this.processes.start("docker", args, { env: secrets });
    let closeListener: () => void = () => undefined;
    const transport: AcpTransport = {
      send: (line) => child.write(`${line}\n`),
      onLine: (listener) => child.onStdout(lineSplitter(listener, () => closeListener())),
      onClose: (listener) => {
        closeListener = listener;
        void child.exited.then(() => listener());
      },
    };
    try {
      return await runAcpTurn(transport, {
        cwd: WORKSPACE_PATH,
        prompt: curatorPrompt(spec),
        decide: spec.decide,
        timeoutMs: spec.maxDurationMs,
        clientVersion: this.config.clientVersion ?? "0.0.0",
      });
    } finally {
      // The core checks the folder next, so the agent must be gone first.
      child.endInput();
      await this.docker(["rm", "-f", agent]).catch(() => null);
      child.kill();
      await child.exited;
      const left = await this.mustDocker(["ps", "-a", "-q", "--filter", `name=^${agent}$`]);
      if (left !== "") throw new Error("agent container still present");
    }
  }

  async listChanges(workspace: WorkspaceHandle): Promise<readonly Change[]> {
    const run = this.run(workspace);
    return listTreeChanges(run.base, run.work);
  }

  async readFile(workspace: WorkspaceHandle, path: string): Promise<string> {
    return readAcceptedFile(this.run(workspace).work, path);
  }

  async cleanup(workspace: WorkspaceHandle): Promise<void> {
    const run = this.runs.get(workspace.id);
    if (run === undefined) return;
    for (const suffix of ["agent", "probe", "proxy"]) {
      await this.docker(["rm", "-f", `${run.name}-${suffix}`]).catch(() => null);
    }
    await this.docker(["network", "rm", `${run.name}-net`]).catch(() => null);
    const leftover = await this.docker([
      "ps",
      "-a",
      "-q",
      "--filter",
      `label=${RUN_LABEL}=${run.name}`,
    ]);
    const network = await this.docker(["network", "inspect", `${run.name}-net`]);
    await makeRemovable(run.dir);
    await rm(run.dir, { recursive: true, force: true });
    this.runs.delete(workspace.id);
    if (leftover.code !== 0 || leftover.stdout.trim() !== "" || network.code === 0) {
      throw new Error("run containers or network left behind");
    }
  }
}
