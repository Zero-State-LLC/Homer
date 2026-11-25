import type { FleetStatusMachine } from "@zs-home/projections";
import { adminHeaders } from "./admin-headers.js";
import type { FleetStatusView } from "./fleet-status.js";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const LABELS: Record<FleetStatusMachine["status"], string> = {
  up: "Up",
  down: "Down",
  stale: "Stale",
  unknown: "Unknown",
};

/** A time as written, with how long ago it was. */
function when(iso: string | null, now: number): string {
  if (!iso) return "never";
  const ms = now - Date.parse(iso);
  const ago =
    !Number.isFinite(ms) || ms < 0
      ? "ahead of Homer's clock"
      : ms < 60_000
        ? `${Math.floor(ms / 1000)} s ago`
        : `${Math.floor(ms / 60_000)} min ago`;
  return `<time datetime="${escape(iso)}">${escape(iso)}</time> (${ago})`;
}

function telemetry(machine: FleetStatusMachine, sparkdashUrl: string | null): string {
  if (machine.source === "sparkdash")
    return sparkdashUrl
      ? `<p>Telemetry: in sparkDash. <a href="${escape(sparkdashUrl)}" rel="noreferrer">Open the sparkDash page</a></p>`
      : "<p>Telemetry: in sparkDash. The sparkDash link is not configured.</p>";
  if (machine.source === "reachability")
    return "<p>Telemetry: unknown. A Reachability Check reads this machine's SSH banner only: a pass proves an SSH server is listening, not that a login works.</p>";
  return "<p>Telemetry: unknown.</p>";
}

function machine(m: FleetStatusMachine, view: FleetStatusView, now: number): string {
  const firing = m.firing.length
    ? `<ul>${m.firing.map((a) => `<li>${escape(a.name)} · ${a.severity} · since ${when(a.since, now)}</li>`).join("")}</ul>`
    : "<p>No firing alerts reported.</p>";
  const heading =
    m.status === "stale" || view.state !== "fresh"
      ? "Firing alerts in the last report"
      : "Firing alerts";
  return `<article class="machine ${m.status}" data-machine-id="${escape(m.machineId)}"><h3>${escape(m.name)}</h3><p class="status"><strong>${LABELS[m.status]}</strong> · ${escape(m.machineId)}${m.source ? ` · ${m.source === "sparkdash" ? "read by sparkDash" : "Reachability Check"}` : ""}${m.configured ? "" : " · not in the runner fleet configuration"}</p>${m.reason ? `<p>${escape(m.reason)}</p>` : ""}${m.reported && m.reported !== m.status ? `<p>The last report said: ${LABELS[m.reported]}.</p>` : ""}<p>Last seen: ${when(m.lastSeenAt, now)}</p><h4>${heading}</h4>${firing}${telemetry(m, view.sparkdashUrl)}</article>`;
}

function summary(view: FleetStatusView, now: number): string {
  if (view.state === "none")
    return "<p>No Fleet Report has arrived. Every machine is unknown until one does.</p>";
  const report = `<p>Last report collected ${when(view.collectedAt, now)}, received ${when(view.receivedAt, now)}.</p>`;
  if (view.state === "stale")
    return `<p><strong>Stale.</strong> ${escape(view.reason ?? "")} Every reported machine shows as stale until a fresh report arrives.</p>${report}`;
  return report;
}

function sparkdash(view: FleetStatusView, now: number): string {
  const s = view.sparkdash;
  const link = view.sparkdashUrl
    ? ` <a href="${escape(view.sparkdashUrl)}" rel="noreferrer">Open the sparkDash page</a>`
    : " The sparkDash link is not configured.";
  const state = s
    ? `<p>sparkDash: ${escape(s.state.replaceAll("_", " "))} · version ${escape(s.version ?? "unknown")}, pinned ${escape(s.pinnedVersion)}.${link}</p>`
    : `<p>sparkDash: unknown.${link}</p>`;
  const diagnostics = view.diagnostics.length
    ? `<ul>${view.diagnostics.map((d) => `<li>${escape(d.code.replaceAll("_", " "))} since ${when(d.since, now)}</li>`).join("")}</ul>`
    : "";
  return state + diagnostics;
}

export function fleetStatusPage(view?: FleetStatusView, error?: string, status = 200): Response {
  const now = Date.now();
  const body =
    !view || error
      ? `<section role="alert"><h2>Fleet status unavailable</h2><p>${escape(error ?? "fleet_status_unavailable")}</p></section>`
      : `<section aria-labelledby="report-title"><h2 id="report-title">Latest report</h2><div role="status">${summary(view, now)}</div>${sparkdash(view, now)}</section><section aria-labelledby="machines-title"><h2 id="machines-title">Machines</h2>${view.machines.length ? view.machines.map((m) => machine(m, view, now)).join("") : "<p>No machines are in the runner fleet configuration.</p>"}</section>`;
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fleet status | Homer</title><link rel="stylesheet" href="/v1/workspace/fleet.css"></head><body><main><header><p>Homer · Workspace</p><nav aria-label="Workspace"><a href="/v1/workspace/calendar">Activity Calendar</a> · <a href="/v1/workspace/fleet">Fleet status</a> · <a href="/v1/workspace/my-setup">My setup</a></nav><h1>Fleet status</h1><p>Every machine Homer watches: up, down, stale or unknown. A machine is up only when the latest report is under 2 minutes old and its own last read is too. Telemetry and its history stay in sparkDash.</p><p><a href="/v1/workspace/fleet">Refresh</a></p></header>${body}</main></body></html>`,
    { status, headers: adminHeaders() },
  );
}

export function fleetStatusStyle(): Response {
  return new Response(
    `:root{color-scheme:light dark;font:17px/1.6 system-ui,sans-serif}body{margin:0;background:#101a25;color:#eef3fa}main{max-width:1100px;margin:auto;padding:clamp(1rem,4vw,3rem)}a{color:#9dd9ff}section,article{min-width:0}article{border:1px solid #536b82;border-left-width:6px;border-radius:12px;padding:1rem;margin:1rem 0;background:#162638;overflow-wrap:anywhere}article.up{border-left-color:#5fd08a}article.down{border-left-color:#ff8a80}article.stale{border-left-color:#ffd477}article.unknown{border-left-color:#93a8bb}h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1.1}h2{color:#b4dfed}h3{margin:.2rem 0}h4{margin:.6rem 0 .2rem}a:focus-visible{outline:3px solid #ffd477;outline-offset:3px}p,li{overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;gap:.6rem}`,
    { headers: adminHeaders("text/css") },
  );
}
