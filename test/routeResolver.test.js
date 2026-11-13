"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveRoute } = require("../src/utils/routeResolver");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "callflow-test-"));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const page = (name, content = "") => {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
page("index.html");
page("_layout.html");
page("middleware.js");
page("about.html");
page("blog/[slug]/index.html");
page("blog/new/index.html");
page("blog/_layout.html");
page("blog/_middleware.js");
page("(group)/users/[id]/index.html");
page("(group)/_layout.html");
page("docs/[doc].html");
page("404.html");
page("(extra)/landing/index.htm");

const route = (value) => resolveRoute(root, value);
test("root index, root layout and legacy middleware", () => {
  const found = route("/");
  assert.equal(found.matchedFile, path.join(root, "index.html"));
  assert.deepEqual(found.layouts, [path.join(root, "_layout.html")]);
  assert.deepEqual(found.middlewares, [path.join(root, "middleware.js")]);
});
test("plain HTML route", () => assert.equal(route("/about").matchedFile, path.join(root, "about.html")));
test("static wins over dynamic", () => assert.equal(route("/blog/new").matchedFile, path.join(root, "blog/new/index.html")));
test("dynamic directory captures and decodes parameter", () => {
  const found = route("/blog/hello%20world");
  assert.deepEqual(found.params, { slug: "hello world" });
  assert.deepEqual(found.layouts, [path.join(root,"_layout.html"), path.join(root,"blog/_layout.html")]);
  assert.deepEqual(found.middlewares, [path.join(root,"middleware.js"), path.join(root,"blog/_middleware.js")]);
});
test("group directory doesn't consume URL segments", () => {
  const found = route("/users/42");
  assert.deepEqual(found.params, { id: "42" });
  assert.deepEqual(found.layouts, [path.join(root,"_layout.html"), path.join(root,"(group)/_layout.html")]);
});
test("dynamic HTML filename works", () => assert.deepEqual(route("/docs/intro").params, { doc: "intro" }));
test("group index with .htm works", () => assert.equal(route("/landing").matchedFile, path.join(root,"(extra)/landing/index.htm")));
test("metadata and custom 404 aren't routes", () => {
  for (const routePath of ["/_layout", "/middleware", "/404"]) assert.equal(route(routePath), null);
  assert.deepEqual(route("/blog/_middleware").params, { slug: "_middleware" });
});
test("bad encoding and traversal aren't routes", () => {
  for (const routePath of ["/%2e%2e", "/foo%2fbar", "/%00", "/%EF%BF"]) assert.equal(route(routePath), null);
});
test("missing route returns null", () => assert.equal(route("/this/does/not/exist"), null));
