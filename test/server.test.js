"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const getPort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});

async function startServer(t, mode = "start") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "callflow-http-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "pages", "(root)", "users", "[id]"), { recursive: true });
  fs.writeFileSync(path.join(dir, "pages", "(root)", "_layout.html"), "<!doctype html><html><head></head><body>LAYOUT:<%content%></body></html>");
  fs.writeFileSync(path.join(dir, "pages", "(root)", "index.html"), "<h1>Home</h1>");
  fs.writeFileSync(path.join(dir, "pages", "(root)", "users", "[id]", "index.html"), "<h1>User {id}</h1>");
  fs.writeFileSync(path.join(dir, "callflow.config.js"), `const callflow = require(${JSON.stringify(path.join(root, "callflow.js"))});
callflow.exposeFunction("add", ["a", "b"], async (req, res, a, b) => a + b);
callflow.exposeFunction("explode", [], async () => { throw new Error("internal secret"); });
callflow.exposeVariable("name", "CallFlow");`);
  const port = await getPort();
  const child = spawn(process.execPath, [path.join(root, "bin", "callflow.js"), mode, "-p", String(port)], { cwd: dir, stdio: "pipe" });
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  let response;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${child.exitCode}`);
    try { response = await fetch(base); break; }
    catch { await new Promise((r) => setTimeout(r, 50)); }
  }
  if (!response) throw new Error("server did not start");
  return { base, dir, response };
}

test("HTTP: grouped root, params, RPC validation and async results", async (t) => {
  const { base, response } = await startServer(t);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /LAYOUT:<h1>Home<\/h1>/);
  assert.match(html, /callflow\.fn/);
  assert.match(html, /CallFlow/);

  const user = await fetch(`${base}/users/%3Cimg%20src=x%20onerror=alert(1)%3E`);
  const userHtml = await user.text();
  assert.match(userHtml, /User &lt;img/);
  assert.doesNotMatch(userHtml, /<img src=x onerror=/);

  const invoke = (name, args, extra = {}) => fetch(`${base}/__callflow_server__/invoke/${name}`, {
    method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(args),
  });
  const ok = await invoke("add", [2, 3]);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { result: 5 });
  assert.equal((await invoke("add", [1])).status, 400);
  assert.equal((await invoke("unknown", [])).status, 404);
  assert.equal((await invoke("add", [2, 3], { origin: "https://evil.example" })).status, 403);
  const error = await invoke("explode", []);
  assert.equal(error.status, 500);
  assert.deepEqual(await error.json(), { error: "Failed to execute function" });
});

test("dev mode reloads changed HTML", async (t) => {
  const { base, dir } = await startServer(t, "dev");
  const file = path.join(dir, "pages", "(root)", "index.html");
  fs.writeFileSync(file, "<h1>Updated page</h1>");
  const response = await fetch(base);
  assert.match(await response.text(), /Updated page/);
});
