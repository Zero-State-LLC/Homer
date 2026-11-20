import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { editorScript } from "../packages/catalog-worker/dist/editor.js";

const initial = { version: 1, revision: 4, repositories: [] };
const mappings = [{ repositoryId: 123, repository: "Zero-State-LLC/example", enabled: true }];
const response = (snapshot = initial, status = 200) =>
  new Response(JSON.stringify(snapshot), {
    status,
    headers: { ETag: `"${snapshot.revision}"` },
  });
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function setup(replies = [response()]) {
  const elements = new Map(),
    calls = [],
    events = {};
  let confirmed = true;
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        textContent: "",
        disabled: false,
        readOnly: false,
        hidden: true,
        handlers: {},
        addEventListener(name, fn) {
          this.handlers[name] = fn;
        },
      });
    return elements.get(id);
  };
  vm.runInNewContext(editorScript, {
    document: { getElementById: element },
    window: {
      confirm: () => confirmed,
      addEventListener: (name, fn) => {
        events[name] = fn;
      },
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      if (!reply) throw new Error("unexpected request");
      return await reply;
    },
  });
  await settle();
  const edit = async (value = mappings) => {
    element("draft").value = JSON.stringify(value);
    await element("draft").handlers.input();
  };
  const click = async (id) => {
    await element(id).handlers.click();
    await settle();
  };
  return {
    element,
    calls,
    replies,
    edit,
    click,
    events,
    confirm: (value) => {
      confirmed = value;
    },
  };
}

test("editor loads runtime inventory without a write and requires a fresh review", async () => {
  const s = await setup();
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, "/v1/admin/catalog/snapshot");
  assert.equal(s.element("draft").value, "[]");
  assert.equal(s.element("save").disabled, true);
  await s.click("review");
  assert.equal(s.element("save").disabled, true);
  await s.edit();
  await s.click("review");
  assert.equal(s.element("save").disabled, false);
  await s.edit([]);
  assert.equal(s.element("save").disabled, true);
  await s.click("save");
  assert.equal(s.calls.length, 1);
});

test("editor submits the reviewed snapshot once with the loaded revision precondition", async () => {
  const s = await setup();
  await s.edit();
  await s.click("review");
  let complete;
  s.replies.push(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const saving = s.click("save");
  assert.equal(s.element("draft").readOnly, true);
  await s.click("save");
  await s.click("load");
  assert.equal(s.calls.length, 2);
  const { url, options } = s.calls[1];
  assert.equal(url, "/v1/admin/catalog");
  assert.equal(options.method, "PUT");
  assert.equal(options.headers["If-Match"], '"4"');
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.redirect, "error");
  assert.deepEqual(JSON.parse(options.body), { version: 1, revision: 5, repositories: mappings });
  complete(response({ version: 1, revision: 5, repositories: mappings }));
  await saving;
  assert.match(s.element("status").textContent, /Saved revision 5/);
  assert.equal(s.element("save").disabled, true);
});

test("conflict preserves the draft, prevents retry, and does not reload without confirmation", async () => {
  const s = await setup();
  await s.edit();
  await s.click("review");
  s.replies.push(response(initial, 409));
  await s.click("save");
  assert.deepEqual(JSON.parse(s.element("draft").value), mappings);
  assert.equal(s.element("save").disabled, true);
  await s.click("save");
  s.confirm(false);
  await s.click("load");
  assert.equal(s.calls.length, 2);
  assert.match(s.element("status").textContent, /Another operator/);
  s.confirm(true);
  s.replies.push(response({ ...initial, revision: 6 }));
  await s.click("load");
  assert.equal(s.element("draft").value, "[]");
  assert.match(s.element("status").textContent, /Loaded revision 6/);
});

test("failed initial loads cannot replace live inventory with an empty draft", async () => {
  for (const reply of [new Error("network"), response(initial, 401), new Response("sign in")]) {
    const s = await setup([reply]);
    assert.equal(s.element("review").disabled, true);
    assert.equal(s.element("save").disabled, true);
    await s.click("review");
    await s.click("save");
    assert.equal(s.calls.length, 1);
  }
});

test("uncertain writes preserve drafts and require reconciliation without an automatic retry", async () => {
  for (const reply of [
    new Error("network"),
    response(initial, 401),
    response(initial, 503),
    new Response("sign in"),
    response({ ...initial, revision: 90 }),
  ]) {
    const s = await setup();
    await s.edit();
    await s.click("review");
    s.replies.push(reply);
    await s.click("save");
    assert.deepEqual(JSON.parse(s.element("draft").value), mappings);
    assert.match(s.element("status").textContent, /could not be confirmed/);
    await s.click("save");
    await s.click("review");
    assert.equal(s.calls.length, 2);
    assert.equal(s.element("save").disabled, true);
  }
});

test("invalid mappings can be repaired after a server refusal and untrusted text remains text", async () => {
  const s = await setup();
  await s.edit([{ repository: '<img src=x onerror="alert(1)">' }]);
  await s.click("review");
  assert.match(s.element("after").textContent, /<img/);
  assert.equal(s.element("after").innerHTML, undefined);
  s.replies.push(response(initial, 400));
  await s.click("save");
  assert.equal(s.element("draft").readOnly, false);
  assert.equal(s.element("save").disabled, true);
  await s.edit();
  await s.click("review");
  assert.equal(s.element("save").disabled, false);
  let warned = false;
  s.events.beforeunload({
    preventDefault() {
      warned = true;
    },
  });
  assert.equal(warned, true);
});
