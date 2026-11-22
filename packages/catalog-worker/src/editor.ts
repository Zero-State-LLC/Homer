import { adminHeaders } from "./admin-headers.js";

/** Static assets only. Inventory is loaded through the authenticated runtime API. */
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Repository mappings | Homer</title>
<link rel="stylesheet" href="/v1/admin/catalog/editor.css">
<script src="/v1/admin/catalog/editor.js" defer></script></head>
<body><main><header><p>Homer administration</p><nav aria-label="Administration"><a href="/v1/admin/overview">Overview</a> · <a href="/v1/admin/repositories">Field-based Repository mappings</a></nav><h1>Repository mappings</h1>
<p>Changes apply to future collection immediately. Historical Activity Events stay unchanged.</p></header>
<p id="status" role="status" aria-live="polite">Loading current mappings…</p>
<button id="load" type="button">Reload current mappings</button>
<section aria-labelledby="edit-heading"><h2 id="edit-heading">Edit mappings</h2>
<label for="draft">Repositories (JSON array)</label>
<p id="help">Each mapping needs repositoryId, repository and enabled. Add projectId only when verified.
Set enabled to false to stop future collection. Removing a mapping also stops future collection.</p>
<textarea id="draft" rows="18" spellcheck="false" aria-describedby="help" readonly></textarea>
<button id="review" type="button" disabled>Review changes</button></section>
<section id="preview" aria-labelledby="review-heading" hidden><h2 id="review-heading">Review replacement</h2>
<p>This replaces the complete repository list. Check additions, removals and Project changes before saving.</p>
<div class="comparison"><div><h3>Current mappings</h3><pre id="before"></pre></div>
<div><h3>Proposed mappings</h3><pre id="after"></pre></div></div>
<button id="save" type="button" disabled>Save reviewed changes</button></section>
<noscript>JavaScript is required for this editor. The authenticated catalog API remains available.</noscript>
</main></body></html>`;

const css = `:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.5}
body{margin:0;background:light-dark(#f4f6f9,#101820);color:light-dark(#172638,#edf3fa)}
main{max-width:72rem;margin:auto;padding:clamp(1rem,4vw,3rem)}
header p:first-child{font-weight:650;color:light-dark(#245b83,#8ecaff)}
h1{font-size:clamp(1.8rem,5vw,2.8rem);line-height:1.2}section{margin-top:2rem}
label{display:block;font-weight:650}textarea,pre{box-sizing:border-box;width:100%;font:0.95rem/1.5 ui-monospace,monospace;padding:1rem;border:1px solid #789; border-radius:.4rem;background:light-dark(#fff,#182633);color:inherit}
textarea{resize:vertical}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:30rem;overflow:auto}
button{min-height:44px;padding:.6rem 1rem;margin:.5rem .5rem .5rem 0;border:1px solid #789;border-radius:.4rem;font:inherit;cursor:pointer}
button:disabled{opacity:.55;cursor:default}button:focus-visible,textarea:focus-visible{outline:3px solid #328dd0;outline-offset:3px}
#status{padding:1rem;border-left:4px solid #328dd0;background:light-dark(#e4eef7,#1a3044)}
.comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
@media(max-width:650px){.comparison{grid-template-columns:1fr}button{width:100%}}`;

export const editorScript = String.raw`"use strict";
(() => {
  const el = (id) => document.getElementById(id);
  const draft = el("draft"), status = el("status"), load = el("load");
  const review = el("review"), save = el("save"), preview = el("preview");
  let current = null, reviewed = null, busy = false, dirty = false;
  const options = {credentials: "same-origin", cache: "no-store", redirect: "error"};
  const format = (value) => JSON.stringify(value, null, 2);
  function controls() {
    load.disabled = busy;
    draft.readOnly = busy || current === null;
    review.disabled = busy || current === null;
    save.disabled = busy || reviewed === null;
  }
  function invalidate() {
    reviewed = null;
    preview.hidden = true;
    controls();
  }
  function checkSnapshot(value, response) {
    if (!value || value.version !== 1 || !Number.isSafeInteger(value.revision) ||
        value.revision < 0 || !Array.isArray(value.repositories) ||
        response.headers.get("ETag") !== '"' + value.revision + '"')
      throw new Error("invalid_response");
    return value;
  }
  function adopt(snapshot) {
    current = snapshot;
    draft.value = format(snapshot.repositories);
    dirty = false;
    invalidate();
  }
  async function reload() {
    if (busy || (dirty && !window.confirm("Discard this draft and load the current mappings?"))) return;
    busy = true;
    current = null;
    invalidate();
    status.textContent = "Loading current mappings…";
    try {
      const response = await fetch("/v1/admin/catalog/snapshot", options);
      if (!response.ok) throw new Error("load_failed");
      adopt(checkSnapshot(await response.json(), response));
      status.textContent = "Loaded revision " + current.revision + ". Edit and review before saving.";
    } catch {
      status.textContent = "Could not load mappings. Your draft is preserved. Sign in again or retry loading.";
    } finally { busy = false; controls(); }
  }
  draft.addEventListener("input", () => { dirty = true; invalidate(); });
  review.addEventListener("click", () => {
    if (busy || !current) return;
    invalidate();
    try {
      const repositories = JSON.parse(draft.value);
      if (!Array.isArray(repositories)) throw new Error("expected_array");
      if (!Number.isSafeInteger(current.revision + 1)) throw new Error("revision_exhausted");
      if (JSON.stringify(repositories) === JSON.stringify(current.repositories)) {
        status.textContent = "No mapping changes to save.";
        return;
      }
      reviewed = {version: 1, revision: current.revision + 1, repositories};
      el("before").textContent = format(current.repositories);
      el("after").textContent = format(repositories);
      preview.hidden = false;
      status.textContent = "Review the complete replacement below. The server validates mappings when you save.";
      controls();
    } catch {
      status.textContent = "Enter a valid JSON array of Repository mappings. Nothing was saved.";
    }
  });
  save.addEventListener("click", async () => {
    if (busy || !reviewed || !current) return;
    const next = reviewed, expected = current.revision;
    busy = true;
    controls();
    status.textContent = "Saving reviewed mappings…";
    try {
      const response = await fetch("/v1/admin/catalog", {...options, method: "PUT",
        headers: {"Content-Type": "application/json", "If-Match": '"' + expected + '"'},
        body: JSON.stringify(next)});
      if (response.status === 409) {
        status.textContent = "Another operator changed the catalog. Your draft is preserved. Copy it before reloading, then reconcile and review again.";
        current = null;
        invalidate();
        return;
      }
      if (response.status === 400 || response.status === 413 || response.status === 415) {
        status.textContent = "The server refused these mappings. Check field names, repository IDs, Project IDs, duplicates and size. Nothing was saved.";
        invalidate();
        return;
      }
      if (!response.ok) throw new Error("save_failed");
      const saved = checkSnapshot(await response.json(), response);
      if (saved.revision !== next.revision) throw new Error("unexpected_revision");
      adopt(saved);
      status.textContent = "Saved revision " + current.revision + ". Future collection uses these mappings.";
    } catch {
      current = null;
      invalidate();
      status.textContent = "Save could not be confirmed. Your draft is preserved. Sign in if needed, then reload and reconcile before retrying.";
    } finally { busy = false; controls(); }
  });
  load.addEventListener("click", reload);
  window.addEventListener("beforeunload", (event) => {
    if (dirty) { event.preventDefault(); event.returnValue = ""; }
  });
  void reload();
})();`;

export const editorPaths = new Set([
  "/v1/admin/catalog/editor",
  "/v1/admin/catalog/editor.js",
  "/v1/admin/catalog/editor.css",
]);
export function editorResponse(path: string): Response {
  const [body, type] =
    path === "/v1/admin/catalog/editor.js"
      ? [editorScript, "text/javascript"]
      : path === "/v1/admin/catalog/editor.css"
        ? [css, "text/css"]
        : [html, "text/html"];
  return new Response(body, {
    headers: adminHeaders(type),
  });
}
