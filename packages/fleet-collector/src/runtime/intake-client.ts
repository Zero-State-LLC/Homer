import type { FleetReport } from "@zs-home/shared-contracts";

/** The Collector's Access service token: its workload credential under the runner controller protocol. */
export interface IntakeCredential {
  clientId: string;
  clientSecret: string;
}

export interface IntakeClient {
  /** The response's status only, or `unreachable`. Nothing in a response makes the Collector act. */
  post(report: FleetReport): Promise<number | "unreachable">;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function intakeClient(
  url: string,
  credential: IntakeCredential,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): IntakeClient {
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("the intake URL must be https://");
  const doFetch = options.fetch ?? fetch;
  return {
    async post(report) {
      try {
        const response = await doFetch(target, {
          method: "POST",
          // Access answers a bad token with a redirect to its sign-in page: never follow it.
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            "CF-Access-Client-Id": credential.clientId,
            "CF-Access-Client-Secret": credential.clientSecret,
          },
          body: JSON.stringify(report),
          signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
        await response.body?.cancel();
        return response.status;
      } catch {
        return "unreachable";
      }
    },
  };
}
