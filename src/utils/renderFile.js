const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const { performance } = require("perf_hooks");
const moment = require("moment");

const fileCache = new Map();
const layoutCache = new Map();
const middlewareCache = new Map();
const PROJECT_ROOT = process.cwd();
const PAGES_DIR = path.join(PROJECT_ROOT, "pages");
const log = require("./logger");

const scripts = fs
  .readdirSync(path.join(__dirname, "../scripts"))
  .filter((script) => script.endsWith(".js"))
  .map(
    (script) =>
      `<script src="/__callflow_server__/scripts/${script}"></script>`,
  )
  .join("\n");

const findInDir = (curpath, searchedFor) => {
  if (!searchedFor || searchedFor === "") {
    if (fs.existsSync(path.join(curpath, "index.html"))) {
      return path.join(curpath, "index.html");
    } else if (fs.existsSync(path.join(curpath, "index.htm"))) {
      return path.join(curpath, "index.htm");
    }
    return null;
  }

  const inDir = fs.readdirSync(curpath);
  const files = [];
  const dirs = [];

  inDir.forEach((file) => {
    const fullPath = path.join(curpath, file);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      dirs.push(file);
    } else {
      files.push(file);
    }
  });

  const segment = searchedFor.split("/")[0];
  const remainingPath = searchedFor.split("/").slice(1).join("/");
  const isLastSegment = searchedFor.split("/").length === 1;

  for (const dir of dirs) {
    if (segment === dir) {
      const result = findInDir(path.join(curpath, dir), remainingPath);
      if (result) return result;
    }
  }

  for (const dir of dirs) {
    if (dir.startsWith("[") && dir.endsWith("]")) {
      const result = findInDir(path.join(curpath, dir), remainingPath);
      if (result) return result;
    }
  }

  for (const dir of dirs) {
    if (dir.startsWith("(") && dir.endsWith(")")) {
      const result = findInDir(path.join(curpath, dir), searchedFor);
      if (result) return result;
    }
  }

  if (isLastSegment) {
    if (files.includes(segment + ".html")) {
      return path.join(curpath, segment + ".html");
    } else if (files.includes(segment + ".htm")) {
      return path.join(curpath, segment + ".htm");
    }

    for (const file of files) {
      if (
        (file.startsWith("[") && file.endsWith("].html")) ||
        (file.startsWith("[") && file.endsWith("].htm"))
      ) {
        return path.join(curpath, file);
      }
    }
  }

  return null;
};

const findLayoutsAndMiddlewaresInPath = (matchedFile) => {
  const segments = matchedFile.split(path.sep).slice(0, -1);
  const layouts = [];
  const middlewares = [];

  if (segments.length === 0) {
    //check for _layout.html and _middleware.js in root
    const layoutPath = path.join(PAGES_DIR, "_layout.html");
    const middlewarePath = path.join(PAGES_DIR, "_middleware.js");

    if (fs.existsSync(layoutPath)) {
      layouts.push(layoutPath);
    }

    if (fs.existsSync(middlewarePath)) {
      middlewares.push(middlewarePath);
    }

    return { layouts, middlewares };
  }

  for (let i = 0; i < segments.length; i++) {
    const currentPath = path.join(PAGES_DIR, ...segments.slice(0, i + 1));
    const layoutPath = path.join(currentPath, "_layout.html");
    const middlewarePath = path.join(currentPath, "_middleware.js");

    if (fs.existsSync(layoutPath)) {
      layouts.push(layoutPath);
    }

    if (fs.existsSync(middlewarePath)) {
      middlewares.push(middlewarePath);
    }
  }

  return { layouts, middlewares };
};

const getParamsFromPath = (matchedFile, filePath) => {
  const matchedParts = matchedFile.split(path.sep);
  const fileParts = filePath
    .split("?")[0]
    .split("/")
    .filter((part) => part !== "");
  const params = {};

  let filePartIndex = 0;

  for (let i = 0; i < matchedParts.length; i++) {
    const matchedPart = matchedParts[i];

    if (
      (matchedPart.startsWith("[") && matchedPart.endsWith("]")) ||
      (matchedPart.startsWith("[") && matchedPart.endsWith("].html")) ||
      (matchedPart.startsWith("[") && matchedPart.endsWith("].htm"))
    ) {
      let paramName = matchedPart.replace(/^\[|\](.html?)?$/g, "");

      if (filePartIndex < fileParts.length) {
        params[paramName] = fileParts[filePartIndex];
        filePartIndex++;
      }
    } else if (
      matchedPart !== "index.html" &&
      matchedPart !== "index.htm" &&
      !matchedPart.endsWith(".html") &&
      !matchedPart.endsWith(".htm")
    ) {
      if (!(matchedPart.startsWith("(") && matchedPart.endsWith(")"))) {
        if (
          filePartIndex < fileParts.length &&
          matchedPart === fileParts[filePartIndex]
        ) {
          filePartIndex++;
        }
      }
    }
  }

  return params;
};

const parseFile = (filePath) => {
  const fileParts = filePath
    .split("?")[0]
    .split("/")
    .filter((part) => part !== "");


  const matchedFile = findInDir(PAGES_DIR, fileParts.join("/"));

  if (!matchedFile) {
    return { layouts: [], middlewares: [], params: {}, matchedFile: null };
  }

  const relativePath = path.relative(PAGES_DIR, matchedFile)
  const { layouts, middlewares } =
    findLayoutsAndMiddlewaresInPath(relativePath);
  const params = getParamsFromPath(relativePath, filePath);

  return { layouts, middlewares, params, matchedFile };
};

const applyLayouts = (content, layoutPaths, params) => {
  const startTime = performance.now();

  const result = layoutPaths.reduce((acc, layoutPath, index) => {
    const layoutStartTime = performance.now();

    if (layoutCache.has(layoutPath)) {
      const layoutContent = layoutCache.get(layoutPath);
      let processedContent = layoutContent.replace("<%content%>", acc);

      Object.entries(params).forEach(([key, value]) => {
        const regex = new RegExp(`\\{${key}\\}`, "g");
        processedContent = processedContent.replace(regex, value);
      });

      const layoutEndTime = performance.now();
      log.debug(
        `Applied cached layout ${path.basename(layoutPath)} [${path.relative(PAGES_DIR, layoutPath)}] (${index + 1}/${layoutPaths.length}) in ${(layoutEndTime - layoutStartTime).toFixed(2)}ms`,
      );

      return processedContent;
    }

    try {
      const layoutContent = fs.readFileSync(layoutPath, "utf8");
      layoutCache.set(layoutPath, layoutContent);
      const processedContent = layoutContent.replace("<%content%>", acc);

      const layoutEndTime = performance.now();
      log.debug(
        `Applied layout ${path.basename(layoutPath)} [${path.relative(PAGES_DIR, layoutPath)}] (${index + 1}/${layoutPaths.length}) in ${(layoutEndTime - layoutStartTime).toFixed(2)}ms`,
      );

      return processedContent;
    } catch (err) {
      log.error(`Failed to read layout ${layoutPath}: ${err.message}`);
      return acc;
    }
  }, content);

  const endTime = performance.now();
  log.info(
    `Applied ${layoutPaths.length} layouts in ${(endTime - startTime).toFixed(2)}ms`,
  );

  return result;
};

const applyMiddlewares = async (middlewarePaths, req, res) => {
  const startTime = performance.now();
  let appliedCount = 0;

  for (const middlewarePath of middlewarePaths) {
    let middleware;
    if (middlewareCache.has(middlewarePath)) {
      middleware = middlewareCache.get(middlewarePath);
      log.debug(`Using cached middleware: ${middlewarePath}`);
    } else {
      try {
        if (process.env.NODE_ENV === "development") {
          delete require.cache[require.resolve(middlewarePath)];
          log.debug(`Hot reloading middleware: ${middlewarePath}`);
        }

        middleware = require(middlewarePath);
        middlewareCache.set(middlewarePath, middleware);
        log.debug(`Loaded middleware: ${middlewarePath}`);
      } catch (err) {
        log.error(
          `Failed to load middleware ${middlewarePath}: ${err.message}`,
        );
        continue;
      }
    }

    if (typeof middleware === "function") {
      try {
        const middlewareStartTime = performance.now();
        const result = middleware(req, res);

        if (result instanceof Promise) {
          await result;
          log.debug(`Executed async middleware: ${middlewarePath}`);
        } else {
          log.debug(`Executed sync middleware: ${middlewarePath}`);
        }

        const middlewareEndTime = performance.now();
        log.debug(
          `Middleware ${path.basename(middlewarePath)} took ${(middlewareEndTime - middlewareStartTime).toFixed(2)}ms`,
        );

        appliedCount++;

        if (res.headersSent) {
          log.info(
            `Middleware sent response, stopping chain at ${path.basename(middlewarePath)}`,
          );
          return false;
        }
      } catch (err) {
        log.error(`Error in middleware ${middlewarePath}: ${err.message}`);
        res.status(500).send("Internal Server Error");
        return false;
      }
    }
  }

  const endTime = performance.now();
  log.info(
    `Applied ${appliedCount}/${middlewarePaths.length} middlewares in ${(endTime - startTime).toFixed(2)}ms`,
  );

  return true;
};

const injectParams = (content, params) => {
  const startTime = performance.now();
  let result = content;
  let replacementsCount = 0;

  Object.entries(params).forEach(([key, value]) => {
    const regex = new RegExp(`\\{${key}\\}`, "g");
    const matches = result.match(regex) || [];
    replacementsCount += matches.length;
    result = result.replace(regex, value);
  });

  const endTime = performance.now();
  log.debug(
    `Injected ${Object.keys(params).length} params with ${replacementsCount} replacements in ${(endTime - startTime).toFixed(2)}ms`,
  );

  return result;
};

const injectExposedFunctions = (callflow) => {
  let result = "";

  result += `
<script>
`;

  Object.entries(callflow.exposedFunctions).forEach(([key, value]) => {
    if (typeof value.fn === "function") {
      result += `
      callflow.fn.${key} = async function(${value.args.map((arg) => arg.name).join(", ")}) {
          return await fetch("${callflow.HTTP_URL}/__callflow_server__/invoke/${key}", {
              method: "POST",
              headers: {
                  "Content-Type": "application/json"
              },
              body: JSON.stringify(Array.from(arguments))
          }).then(res => res.json()).then(data => {
            return data.result;
          }).catch(err => {
            console.error("Error invoking function ${key}", err);
            throw err;
          });
      };`;
    }
  });

  result += `
</script>
`;

  return result;
};

const injectExposedVariables = (callflow) => {
  let result = "";

  result += `
<script>
`;

  Object.entries(callflow.exposedVariables).forEach(([key, value]) => {
    result += `
      callflow.vars["${key}"] = ${JSON.stringify(value)};
    `;
  });

  result += `
</script>
`;

  return result;
};

const clearFileCache = () => {
  const cacheSize = fileCache.size;
  fileCache.clear();
  log.info(`Cleared file cache (${cacheSize} entries)`);
};

const clearLayoutCache = () => {
  const cacheSize = layoutCache.size;
  layoutCache.clear();
  log.info(`Cleared layout cache (${cacheSize} entries)`);
};

const clearMiddlewareCache = () => {
  const cacheSize = middlewareCache.size;
  middlewareCache.clear();
  log.info(`Cleared middleware cache (${cacheSize} entries)`);
};

const clearAllCaches = () => {
  clearFileCache();
  clearLayoutCache();
  clearMiddlewareCache();
};

const renderFile = async (req, res, callflow) => {
  const startTime = performance.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

  log.info(`[${requestId}] Processing request for ${req.method} ${req.path}`);

  try {
    const routeStartTime = performance.now();
    const { layouts, middlewares, params, matchedFile } = parseFile(req.path);
    const routeEndTime = performance.now();

    log.info(
      `[${requestId}] Route parsing completed in ${(routeEndTime - routeStartTime).toFixed(2)}ms`,
    );

    if (layouts.length > 0) {
      log.debug(
        `[${requestId}] Found layouts: ${layouts.map((l) => path.relative(PAGES_DIR, l)).join(", ")}`,
      );
    }

    const middlewareStartTime = performance.now();
    const shouldContinue = await applyMiddlewares(middlewares, req, res);
    const middlewareEndTime = performance.now();

    log.info(
      `[${requestId}] Middleware chain completed in ${(middlewareEndTime - middlewareStartTime).toFixed(2)}ms`,
    );

    if (!shouldContinue) {
      log.info(`[${requestId}] Request handled by middleware`);
      return;
    }

    if (matchedFile) {
      try {
        const renderStartTime = performance.now();

        log.debug(`[${requestId}] Reading file: ${matchedFile}`);
        const fileContent = fs.readFileSync(matchedFile, "utf8");

        const scriptsInjection = `
  <script>
      window.__params = ${JSON.stringify(params)};
      window.__route = "${req.path}";
      const callflow = {
        HTTP_URL: "${callflow.HTTP_URL}",

        fn: {},
        vars: {},
      }
  </script>`;

        log.debug(`[${requestId}] Applying ${layouts.length} layouts`);
        const layoutContent = applyLayouts(fileContent, layouts, params);

        log.debug(
          `[${requestId}] Injecting params: ${Object.keys(params).join(", ")}`,
        );
        const contentWithParams = injectParams(layoutContent, params);

        const exposedFunctionsInjection = injectExposedFunctions(callflow);

        const exposedVariablesInjection = injectExposedVariables(callflow);

        const finalContent = `
${scriptsInjection}
${scripts}
${exposedFunctionsInjection}
${exposedVariablesInjection}
${contentWithParams}`;

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("X-Powered-By", "CallflowJS");
        res.setHeader("X-Request-ID", requestId);

        if (process.env.NODE_ENV === "production") {
          res.setHeader("Cache-Control", "public, max-age=3600");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }

        res.status(200).send(finalContent);

        const renderEndTime = performance.now();
        log.info(
          `[${requestId}] Rendered ${path.relative(PAGES_DIR, matchedFile)} in ${(renderEndTime - renderStartTime).toFixed(2)}ms`,
        );

        const endTime = performance.now();
        log.info(
          `[${requestId}] Total request time: ${(endTime - startTime).toFixed(2)}ms`,
        );
      } catch (err) {
        log.error(
          `[${requestId}] Failed to read file ${matchedFile}: ${err.message}`,
        );
        res.status(500).send("Internal Server Error");
      }
    } else {
      log.debug(`[${requestId}] No matching file found, trying custom 404`);

      const custom404 = path.join(PAGES_DIR, "404.html");
      if (fs.existsSync(custom404)) {
        const notFoundContent = fs.readFileSync(custom404, "utf8");
        res.status(404).send(notFoundContent);
        log.info(`[${requestId}] Served custom 404 page`);
      } else {
        res.status(404).send("Page Not Found");
        log.info(`[${requestId}] Served default 404 response`);
      }
    }
  } catch (err) {
    log.error(`[${requestId}] Error rendering file: ${err.message}`);
    log.error(`[${requestId}] Stack trace: ${err.stack}`);
    res.status(500).send("Internal Server Error");
  }
};

module.exports = renderFile;
module.exports.clearFileCache = clearFileCache;
module.exports.clearLayoutCache = clearLayoutCache;
module.exports.clearMiddlewareCache = clearMiddlewareCache;
module.exports.clearAllCaches = clearAllCaches;
