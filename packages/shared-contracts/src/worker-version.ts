import { BUILD_VERSION, PRODUCT_VERSION } from "./generated/build-info.js";

/** What `GET /v1/version` answers (versioning spec, "Worker version"). */
export interface WorkerVersion {
  /** The product version this Worker was built from, as in `0.1.0`. */
  productVersion: string;
  /** The Build Version, as in `0.1.0+a1b2c3d`. */
  buildVersion: string;
  /** Cloudflare's id for the deployed Worker version, or null without the binding. */
  workerVersionId: string | null;
  /** The tag the version was uploaded with, as in `v0.1.0`, or null if it has none. */
  workerVersionTag: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" && value.length <= 128 ? value : null;
}

/**
 * The four fields, from the build and the Worker's `version_metadata` binding.
 * Nothing from the request reaches them, and they never carry an account id, a
 * hostname or a binding name.
 */
export function workerVersion(metadata: unknown): WorkerVersion {
  const m =
    metadata !== null && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  return {
    productVersion: PRODUCT_VERSION,
    buildVersion: BUILD_VERSION,
    workerVersionId: text(m["id"]),
    workerVersionTag: text(m["tag"]),
  };
}
