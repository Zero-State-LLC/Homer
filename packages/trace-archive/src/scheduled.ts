import { collectTracePage } from "./collector.js";
import { d1Journal } from "./journal.js";
import { nativeManifestPrefix } from "./langfuse.js";
import type { LangfuseSource } from "./langfuse.js";
import { sha256 } from "./index.js";
import { r2Store } from "./r2.js";

export interface TraceArchiveEnv {
  TRACE_LANDING: R2Bucket;
  TRACE_ARCHIVE: R2Bucket;
  TRACE_INDEX: D1Database;
  TRACE_ARCHIVE_ENABLED?: string;
}
/** Compose with a reviewed runtime catalog/policy loader. No permissive default.
 * This module is not a deployable entrypoint until that loader is supplied. */
export function traceArchiveWorker(loadSource: (env: TraceArchiveEnv) => Promise<LangfuseSource>) {
  return {
    fetch() {
      return new Response(null, { status: 404 });
    },
    async scheduled(_controller: ScheduledController, env: TraceArchiveEnv): Promise<void> {
      if (env.TRACE_ARCHIVE_ENABLED !== "true") return;
      try {
        const source = await loadSource(env);
        const manifestPrefix = nativeManifestPrefix(source);
        const scope = await sha256(
          new TextEncoder().encode(
            JSON.stringify([
              source.policy.environment,
              source.projectId,
              source.prefix,
              source.policy.sourceProject,
              source.policy.version,
            ]),
          ),
        );
        const result = await collectTracePage(
          source,
          r2Store(env.TRACE_LANDING),
          r2Store(env.TRACE_ARCHIVE),
          {
            async list(prefix, cursor, limit) {
              if (prefix !== manifestPrefix) throw new Error("invalid_list_scope");
              const result = await env.TRACE_LANDING.list({
                prefix,
                limit,
                ...(cursor === null ? {} : { cursor }),
              });
              return {
                keys: result.objects.map((o) => o.key),
                cursor: result.truncated ? result.cursor : null,
              };
            },
          },
          d1Journal(env.TRACE_INDEX, scope),
          new Date().toISOString(),
        );
        // Durable attempts and discovery progress survive, but a partial failure
        // must not appear as a healthy scheduled invocation.
        if (result.failed > 0) throw new Error("trace_archive_batch_failed");
      } catch {
        // Do not leak native SDK, JSON parser or inspector errors into Worker logs.
        throw new Error("trace_archive_schedule_failed");
      }
    },
  };
}
