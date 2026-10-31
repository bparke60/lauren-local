import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  Store,
  LocalBrain,
  startWorker,
  publicUrl,
  definitions,
} from "../src/local-core.js";

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "lauren-test-"));
  const file = path.join(dir, "test.sqlite");
  const store = new Store(file);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, file };
}
const config = async () => ({
  local: { model: "test-local", baseUrl: "http://127.0.0.1:5321/v1" },
});
test("lists persist across database reopen and invalid data is rejected", (t) => {
  const { store, file } = fixture(t);
  store.saveList("Study", ["Vectors", "Gradients"]);
  assert.throws(() => store.saveList("bad", [{}]));
  const reopened = new Store(file);
  assert.deepEqual(reopened.lists()[0].items, ["Vectors", "Gradients"]);
  reopened.close();
});
test("only due queued jobs run; cancellation and explicit retry preserve state", (t) => {
  const { store } = fixture(t);
  const future = store.addJob("Later", "2099-01-01T00:00:00Z");
  assert.equal(store.claim(), null);
  assert.equal(store.cancel(future.id), 1);
  assert.equal(store.retry(future.id), 0);
  const due = store.addJob("Now", "2000-01-01T00:00:00Z");
  assert.equal(store.claim().id, due.id);
  assert.equal(store.claim(), null);
  store.finish(due.id, null, "Connection failed");
  assert.equal(store.retry(due.id), 1);
  assert.equal(store.claim().id, due.id);
});
test("an interrupted job is surfaced for review rather than silently replayed", (t) => {
  const { store, file } = fixture(t);
  store.addJob("One-time effect", "2000-01-01");
  store.claim();
  const recovered = new Store(file);
  assert.equal(recovered.jobs()[0].status, "interrupted");
  assert.equal(recovered.claim(), null);
  recovered.close();
});
test("real tool results are returned to the model before a success reply", async (t) => {
  const { store } = fixture(t);
  let calls = 0;
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.match(url, /127.0.0.1/);
    if (calls++ === 0)
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "one",
                    type: "function",
                    function: {
                      name: "save_list",
                      arguments: JSON.stringify({
                        title: "Demo",
                        items: ["One"],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      };
    assert.equal(body.messages.at(-1).role, "tool");
    assert.equal(JSON.parse(body.messages.at(-1).content).title, "Demo");
    return {
      ok: true,
      json: async () => ({
        choices: [
          { finish_reason: "stop", message: { content: "Saved your list." } },
        ],
      }),
    };
  };
  const brain = new LocalBrain({
    store,
    config,
    memory: async () => ({ facts: [] }),
    fetcher,
  });
  const result = await brain.run([{ role: "user", content: "Save a list" }]);
  assert.equal(store.lists().length, 1);
  assert.equal(result.trace[0].ok, true);
  assert.equal(result.text, "Saved your list.");
  assert.equal(brain.busy, false);
});
test("an offline run cannot call internet tools, even if the model requests one", async (t) => {
  const { store } = fixture(t);
  let calls = 0;
  const brain = new LocalBrain({
    store,
    config,
    memory: async () => ({}),
    fetcher: async (_, options) => {
      const body = JSON.parse(options.body);
      assert.equal(
        body.tools.some((t) => t.function.name === "web_search"),
        false,
      );
      if (calls++ === 0)
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: "blocked",
                      function: {
                        name: "read_page",
                        arguments: '{"url":"http://127.0.0.1"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        };
      assert.match(body.messages.at(-1).content, /unavailable/);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Internet is disabled." } }],
        }),
      };
    },
  });
  const result = await brain.run([{ role: "user", content: "Research" }]);
  assert.equal(result.trace[0].ok, false);
});
test("truncated thinking never masquerades as a completed answer", async (t) => {
  const { store } = fixture(t);
  const brain = new LocalBrain({
    store,
    config,
    memory: async () => ({}),
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ finish_reason: "length", message: { content: "Half an" } }],
      }),
    }),
  });
  await assert.rejects(
    brain.run([{ role: "user", content: "Hi" }]),
    /response limit/,
  );
  assert.equal(brain.busy, false);
  assert.equal(store.runs()[0].ok, 0);
});
test("worker saves reports and exposes model failures", async (t) => {
  const { store } = fixture(t);
  let fail = false;
  const worker = startWorker(
    store,
    {
      busy: false,
      run: async () => {
        if (fail) throw Error("Offline");
        return { text: "Done" };
      },
    },
    999999,
  );
  t.after(worker.stop);
  const first = store.addJob("Make report", "2000-01-01");
  await worker.tick();
  assert.equal(store.jobs().find((x) => x.id === first.id).status, "completed");
  fail = true;
  const second = store.addJob("Make report", "2000-01-01");
  await worker.tick();
  assert.equal(store.jobs().find((x) => x.id === second.id).error, "Offline");
});
test("background runs cannot recursively create more tasks", () =>
  assert.equal(
    definitions(true, true).some((t) => t.function.name === "schedule_task"),
    false,
  ));
test("page fetch rejects private IPs, unsafe protocols and mixed DNS results", async () => {
  for (const url of [
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://169.254.169.254",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "file:///etc/passwd",
    "https://user:pass@example.org",
    "http://example.org:4327",
  ])
    await assert.rejects(publicUrl(url));
  await assert.rejects(
    publicUrl("https://example.org", async () => [
      { address: "8.8.8.8" },
      { address: "127.0.0.1" },
    ]),
  );
  assert.equal(
    (
      await publicUrl("https://example.org", async () => [
        { address: "93.184.216.34" },
      ])
    ).hostname,
    "example.org",
  );
});
