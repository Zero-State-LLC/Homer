import type { MappingSnapshot } from "@zs-home/github-sync";
import { repositoryScript } from "./repositories.js";
import { adminHeaders } from "./admin-headers.js";

export const adminPaths = new Set([
  "/v1/admin/overview",
  "/v1/admin/repositories",
  "/v1/admin/repositories.js",
  "/v1/admin/admin.css",
]);
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export function adminPage(title: string, content: string, script = ""): Response {
  const headers = adminHeaders();
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} | Homer</title><link rel="stylesheet" href="/v1/admin/catalog/editor.css"><link rel="stylesheet" href="/v1/admin/admin.css">${script ? `<script src="${script}" defer></script>` : ""}</head><body><main><header><p>Homer administration</p><nav aria-label="Administration"><a href="/v1/admin/overview">Overview</a> · <a href="/v1/admin/repositories">Repository mappings</a></nav><p>Scope: catalog administration. Environment: catalog-wide configuration; no environment-specific mutation is available.</p><h1>${escape(title)}</h1></header>${content}</main></body></html>`,
    { headers },
  );
}
export function overviewResponse(snapshot: MappingSnapshot): Response {
  return adminPage(
    "Overview",
    `<p>Observed catalog revision ${snapshot.revision}</p><h2>Attention</h2><p>Collection health: Unknown. Admission configuration is not evidence of successful collection or Source Freshness.</p><p>Next safe action: inspect Repository mappings. Historical Activity Events stay unchanged.</p><h2>Repository admission</h2>${snapshot.repositories.length ? snapshot.repositories.map((r) => `<article><h3>${escape(r.repository)}</h3><p>Repository ID: ${r.repositoryId}. Project: ${escape(r.projectId ?? "Unmapped")}. ${r.enabled ? "Enabled" : "Disabled"}.</p></article>`).join("") : "<p>No Repository mappings configured.</p>"}<h2>Unavailable modules</h2><p>Credentials, My setup, Traces and archives, People and agents, Operations, and Audit and recovery are not available in this catalog surface. No collection health or credential status has been verified.</p>`,
  );
}

export function adminAsset(path: string): Response | undefined {
  if (path === "/v1/admin/overview") return undefined;
  if (path === "/v1/admin/repositories")
    return adminPage(
      "Repository mappings",
      `
<p>Changes apply to future collection. Historical Activity Events stay unchanged. Enter source-verified Repository and Project IDs; source identity lookup is unavailable.</p>
<p id="status" role="status" aria-live="polite">Loading current mappings…</p>
<button id="load" type="button">Read current mappings for reconciliation</button>
<section id="validation-summary" tabindex="-1" aria-labelledby="validation-title" hidden><h2 id="validation-title">Correct Repository mapping fields</h2><p>Nothing was saved. Follow a link to correct the field.</p><ul id="validation-errors"></ul></section>
<p id="revision"></p><form id="mappings"><fieldset id="fields" disabled><legend>Edit Repository admission</legend><div id="rows"></div><button id="add" type="button">Add Repository mapping</button></fieldset></form>
<button id="review" type="button" disabled>Review changes</button>
<section id="reconciliation" hidden><h2>Reconcile retained draft</h2><p>Compare the original revision, current stored mappings, and your proposed mappings. No write has been retried.</p><h3>Original</h3><pre id="original"></pre><h3>Current readback</h3><pre id="readback"></pre><h3>Retained draft</h3><pre id="retained"></pre><button id="rebase" type="button">Use current revision and review my draft</button></section>
<section id="preview" hidden><h2>Review changes</h2><p>This replaces the complete Repository admission list. Removing or disabling a mapping stops future collection. Project changes affect the Project reference on future Activity Events.</p><div id="changes"></div><button id="save" type="button" disabled>Save reviewed changes</button></section>
<noscript>JavaScript is required to edit mappings.</noscript>`,
      "/v1/admin/repositories.js",
    );
  const headers = adminHeaders();
  headers.set(
    "Content-Type",
    path.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8",
  );
  return new Response(
    path.endsWith(".js")
      ? repositoryScript
      : `input{box-sizing:border-box;max-width:100%;min-height:44px;font:inherit;padding:.5rem}input[type=checkbox]{min-width:24px}fieldset{min-width:0;padding:1rem;margin:1rem 0;border:1px solid #789;border-radius:.4rem}a{color:inherit}nav{display:flex;gap:1rem;flex-wrap:wrap}#validation-summary:focus,a:focus-visible,input:focus-visible{outline:3px solid #328dd0;outline-offset:3px}article{overflow-wrap:anywhere}.mapping-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}@media(max-width:650px){.mapping-fields{grid-template-columns:1fr}}`,
    { headers },
  );
}
