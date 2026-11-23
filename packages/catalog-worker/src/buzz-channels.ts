/**
 * Admin routes for the Buzz channel allowlist. Contract: specs/buzz/spec.md, "Channel
 * allowlist". Every route needs the admin Access audience; there is no read-audience route.
 */
import type { JWTVerifyGetKey } from "jose";
import { parseBuzzChannelSnapshot, type BuzzChannelSnapshot } from "@zs-home/buzz-collector";
import { validateAccessConfig, verifyAccess, type AccessConfig } from "./access.js";
import { MAX_BUZZ_CATALOG_BYTES, type BuzzChannelCatalogObject } from "./buzz-store.js";
import { json, readBytes } from "./http.js";

export const BUZZ_CHANNELS_PATH = "/v1/admin/buzz/channels";
export const BUZZ_CHANNELS_VIEW_PATH = "/v1/admin/buzz/channels/view";

export interface BuzzChannelsEnv extends AccessConfig {
  BUZZ_CHANNELS: DurableObjectNamespace<BuzzChannelCatalogObject>;
}

export function isBuzzChannelsPath(pathname: string): boolean {
  return pathname === BUZZ_CHANNELS_PATH || pathname === BUZZ_CHANNELS_VIEW_PATH;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** A read-only listing. Changes go through the reviewed PUT, never this page. */
export function channelListing(snapshot: BuzzChannelSnapshot): string {
  const rows = snapshot.channels
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.label)}</td><td><code>${escapeHtml(entry.channel)}</code></td>` +
        `<td>${entry.enabled ? "Yes" : "No"}</td><td>${entry.flagChannel ? "Yes" : "No"}</td></tr>`,
    )
    .join("");
  const body =
    snapshot.channels.length === 0
      ? "<p>No channels are listed, so Homer reads nothing from Buzz.</p>"
      : `<table><caption>Channels Homer may read</caption><thead><tr><th scope="col">Label</th>` +
        `<th scope="col">Channel</th><th scope="col">Enabled</th><th scope="col">Flag channel</th>` +
        `</tr></thead><tbody>${rows}</tbody></table>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Buzz channels | Homer</title>
<link rel="stylesheet" href="/v1/admin/catalog/editor.css"></head>
<body><main><header><p>Homer administration</p><h1>Buzz channels</h1>
<p>Revision ${snapshot.revision}. Read-only: changes are reviewed and saved through the catalog API.
Direct messages are never read, even when listed.</p></header>
${body}
</main></body></html>`;
}

function page(html: string): Response {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}

export async function handleBuzzChannels(
  request: Request,
  env: BuzzChannelsEnv,
  key?: JWTVerifyGetKey,
): Promise<Response> {
  const url = new URL(request.url);
  const view = url.pathname === BUZZ_CHANNELS_VIEW_PATH;
  if (request.method !== "GET" && (view || request.method !== "PUT")) {
    return json({ error: "method_not_allowed" }, 405);
  }
  try {
    validateAccessConfig(env);
  } catch {
    return json({ error: "access_not_configured" }, 503);
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "cross_origin_denied" }, 403);
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 16384) return json({ error: "unauthorized" }, 401);
  let principal: string;
  try {
    principal = await verifyAccess(token, env, true, key);
  } catch {
    return json({ error: "unauthorized" }, 401);
  }
  const store = env.BUZZ_CHANNELS.get(env.BUZZ_CHANNELS.idFromName(env.CATALOG_NAME));

  if (request.method === "GET") {
    try {
      // Re-checked here as well as in the object, so a bad stored row never renders.
      const snapshot = parseBuzzChannelSnapshot(await store.read());
      return view ? page(channelListing(snapshot)) : json(snapshot, 200, snapshot.revision);
    } catch {
      return json({ error: "catalog_unavailable" }, 503);
    }
  }

  const match = request.headers.get("If-Match");
  if (!match) return json({ error: "precondition_required" }, 428);
  if (!/^"(0|[1-9][0-9]*)"$/.test(match)) return json({ error: "invalid_precondition" }, 400);
  const expected = Number(match.slice(1, -1));
  if (!Number.isSafeInteger(expected)) return json({ error: "invalid_precondition" }, 400);
  if (
    request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  )
    return json({ error: "unsupported_media_type" }, 415);
  let snapshot: BuzzChannelSnapshot;
  try {
    snapshot = parseBuzzChannelSnapshot(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readBytes(request, MAX_BUZZ_CATALOG_BYTES),
        ),
      ),
    );
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "body_too_large";
    return json({ error: tooLarge ? "body_too_large" : "invalid_snapshot" }, tooLarge ? 413 : 400);
  }
  if (snapshot.revision !== expected + 1) return json({ error: "invalid_next_revision" }, 400);
  try {
    if (!(await store.replace(expected, snapshot, principal)))
      return json({ error: "revision_conflict" }, 409);
    return json(snapshot, 200, snapshot.revision);
  } catch {
    return json({ error: "catalog_unavailable" }, 503);
  }
}
