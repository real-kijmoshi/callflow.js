"use strict";

const fs = require("node:fs");
const path = require("node:path");

const isGroup = (name) => /^\([^)]+\)$/.test(name);
const dynamicName = (name) => /^\[([A-Za-z_$][\w$]*)\]$/.exec(name);
const isFile = (dir, name) => {
  try { return fs.statSync(path.join(dir, name)).isFile(); }
  catch { return false; }
};
const isDir = (dir, name) => {
  try { return fs.statSync(path.join(dir, name)).isDirectory(); }
  catch { return false; }
};

function getAncestors(pagesDir, file) {
  const relative = path.relative(pagesDir, path.dirname(file));
  const parts = relative === "" ? [] : relative.split(path.sep);
  const layouts = [];
  const middlewares = [];
  let current = pagesDir;
  for (const segment of [null, ...parts]) {
    if (segment !== null) current = path.join(current, segment);
    if (isFile(current, "_layout.html")) layouts.push(path.join(current, "_layout.html"));
    const middlewareName = isFile(current, "_middleware.js") ? "_middleware.js" : "middleware.js";
    if (isFile(current, middlewareName)) middlewares.push(path.join(current, middlewareName));
  }
  return { layouts, middlewares };
}

/** Resolve only HTML pages under pagesDir; group folders don't consume URL segments. */
function resolveRoute(pagesDir, urlPath) {
  if (!fs.existsSync(pagesDir)) return null;
  let segments;
  try {
    segments = urlPath.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
  } catch { return null; }
  if (segments.some((s) => !s || s === "." || s === ".." || s.includes("/") || s.includes("\\") || s.includes("\0"))) return null;
  const candidates = [];
  const record = (file, params, priority, groups) => {
    candidates.push({ file, params, priority, groups });
  };
  function visit(dir, position, params, priority, groups) {
    if (position === segments.length) {
      for (const filename of ["index.html", "index.htm"]) {
        if (isFile(dir, filename)) {
          record(path.join(dir, filename), params, priority, groups);
          break;
        }
      }
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    if (position < segments.length) {
      const segment = segments[position];
      {
        if (position === segments.length - 1 && !segment.startsWith("_") && segment !== "404") {
          for (const ext of [".html", ".htm"]) {
            if (isFile(dir, segment + ext)) {
              record(path.join(dir, segment + ext), params, [...priority, 3], groups);
              break;
            }
          }
        }
        if (subdirs.includes(segment) && !isGroup(segment)) {
          visit(path.join(dir, segment), position + 1, params, [...priority, 3], groups);
        }
        for (const dirName of subdirs) {
          const match = dynamicName(dirName);
          if (match) {
            visit(path.join(dir, dirName), position + 1, { ...params, [match[1]]: segment }, [...priority, 1], groups);
          }
        }
        if (position === segments.length - 1) {
          for (const filename of entries.filter((e) => e.isFile()).map((e) => e.name).sort()) {
            const match = /^\[([A-Za-z_$][\w$]*)\]\.html?$/.exec(filename);
            if (match) record(path.join(dir, filename), { ...params, [match[1]]: segment }, [...priority, 1], groups);
          }
        }
      }
    }
    for (const dirName of subdirs) {
      if (isGroup(dirName)) visit(path.join(dir, dirName), position, params, priority, groups + 1);
    }
  }
  visit(pagesDir, 0, {}, [], 0);
  candidates.sort((a, b) => {
    for (let i = 0; i < Math.max(a.priority.length, b.priority.length); i++) {
      if ((a.priority[i] || 0) !== (b.priority[i] || 0)) return (b.priority[i] || 0) - (a.priority[i] || 0);
    }
    return a.groups - b.groups || a.file.localeCompare(b.file);
  });
  const match = candidates[0];
  return match ? { matchedFile: match.file, params: match.params, ...getAncestors(pagesDir, match.file) } : null;
}

module.exports = { resolveRoute };
