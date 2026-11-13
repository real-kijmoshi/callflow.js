"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveRoute } = require("./routeResolver");
const log = require("./logger");

const pagesDir = path.join(path.resolve(process.env.user_dir || process.cwd()), "pages");
const development = process.env.NODE_ENV === "development";
const fileCache = new Map();
const layoutCache = new Map();
const middlewareCache = new Map();

function readFile(filename, cache) {
  if (!development && cache.has(filename)) return cache.get(filename);
  const contents = fs.readFileSync(filename, "utf8");
  if (!development) cache.set(filename, contents);
  return contents;
}

function escapeHtml(input) {
  return String(input).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function injectParams(content, params) {
  for (const [key, value] of Object.entries(params)) {
    content = content.replace(new RegExp(`\\{${key}\\}`, "g"), () => escapeHtml(value));
  }
  return content;
}

function serializeForScript(value) {
  // Avoid prematurely closing the inline script, even when values contain HTML.
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function clientRuntime(req, params, callflow) {
  const boot = serializeForScript({
    route: req.path,
    params,
    functions: Object.keys(callflow.exposedFunctions),
    variables: callflow.exposedVariables,
  });
  return `<script>
(() => {
  const boot = ${boot};
  window.__route = boot.route;
  window.__params = boot.params;
  const callflow = window.callflow = {
    HTTP_URL: window.location.origin,
    fn: Object.create(null),
    vars: boot.variables,
  };
  for (const name of boot.functions) {
    callflow.fn[name] = async (...args) => {
      const response = await fetch("/__callflow_server__/invoke/" + encodeURIComponent(name), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "CallFlow RPC failed");
      return body.result;
    };
  }
})();
</script>`;
}

async function runMiddlewares(paths, req, res) {
  for (const filename of paths) {
    try {
      if (development) delete require.cache[require.resolve(filename)];
      let fn = middlewareCache.get(filename);
      if (development || !fn) {
        fn = require(filename);
        if (typeof fn !== "function") throw new TypeError(`Middleware must export a function: ${filename}`);
        if (!development) middlewareCache.set(filename, fn);
      }
      await fn(req, res);
      if (res.headersSent || res.writableEnded) return false;
    } catch (error) {
      log.error(`Middleware failed in ${filename}: ${error.stack || error}`);
      if (!res.headersSent) res.status(500).send("Internal Server Error");
      return false;
    }
  }
  return true;
}

async function renderFile(req, res, callflow) {
  try {
    const route = resolveRoute(pagesDir, req.path);
    if (!route) {
      const notFound = path.join(pagesDir, "404.html");
      res.status(404).type("html").send(fs.existsSync(notFound) ? readFile(notFound, fileCache) : "Page Not Found");
      return;
    }
    const { matchedFile, layouts, middlewares, params } = route;
    req.params = { ...req.params, ...params };
    if (!(await runMiddlewares(middlewares, req, res))) return;

    let html = readFile(matchedFile, fileCache);
    // Inner layout first, outer layout last.
    for (const layout of [...layouts].reverse()) {
      html = readFile(layout, layoutCache).replace("<%content%>", () => html);
    }
    html = injectParams(html, params);
    const script = clientRuntime(req, params, callflow);
    html = /<\/head\s*>/i.test(html)
      ? html.replace(/<\/head\s*>/i, () => `${script}\n</head>`)
      : `${script}\n${html}`;
    res.setHeader("X-Request-ID", require("node:crypto").randomUUID());
    res.setHeader("Cache-Control", "no-store");
    res.status(200).type("html").send(html);
  } catch (error) {
    log.error(`Failed rendering ${req.path}: ${error.stack || error}`);
    if (!res.headersSent) res.status(500).send("Internal Server Error");
  }
}

module.exports = renderFile;
module.exports.clearFileCache = () => fileCache.clear();
module.exports.clearLayoutCache = () => layoutCache.clear();
module.exports.clearMiddlewareCache = () => middlewareCache.clear();
module.exports.clearRouteCache = () => {};
module.exports.clearAllCaches = () => { fileCache.clear(); layoutCache.clear(); middlewareCache.clear(); };
