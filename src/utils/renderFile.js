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

const shouldIgnoreFolder = (folderName) => {
  return folderName.startsWith("(") && folderName.endsWith(")");
};

const findLayouts = (directory) => {
  const layoutPath = path.join(directory, "_layout.html");
  const layouts = [];

  if (fs.existsSync(layoutPath)) {
    layouts.push(layoutPath);
  }

  return layouts;
};

const findFile = (directory, segment) => {
  let possibleEntries = [];
  let matchedDir = null;
  let isParam = false;
  let paramName = "";

  try {
    possibleEntries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (err) {
    log.error(`Failed to read directory ${directory}: ${err.message}`);
    return { matchedDir: null, isParam: false, paramName: "" };
  }

  for (const entry of possibleEntries) {
    if (!entry.isDirectory()) continue;

    if (shouldIgnoreFolder(entry.name)) continue;

    if (entry.name === segment) {
      matchedDir = entry;
      break;
    }

    if (entry.name.startsWith("[") && entry.name.endsWith("]")) {
      matchedDir = entry;
      isParam = true;
      paramName = entry.name.slice(1, -1);
    }
  }

  return { matchedDir, isParam, paramName };
};

const recursivelyFindFiles = (directory, targetFile) => {
  let result = [];

  try {
    const entries = fs.readdirSync(directory, { withFileTypes: true });

    const targetPath = path.join(directory, targetFile);
    if (fs.existsSync(targetPath)) {
      result.push(targetPath);
    }

    for (const entry of entries) {
      if (entry.isDirectory() && shouldIgnoreFolder(entry.name)) {
        const subResults = recursivelyFindFiles(
          path.join(directory, entry.name),
          targetFile,
        );
        result = result.concat(subResults);
      }
    }
  } catch (err) {
    log.error(`Error searching for files in ${directory}: ${err.message}`);
  }

  return result;
};

function traverseAllLayouts(baseDir, relativePath = "") {
  const layouts = [];
  const currentDir = path.join(baseDir, relativePath);

  const layoutPath = path.join(currentDir, "_layout.html");
  if (fs.existsSync(layoutPath)) {
    layouts.push(layoutPath);
  }

  try {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    const orgFolders = entries.filter(
      (entry) => entry.isDirectory() && shouldIgnoreFolder(entry.name),
    );

    for (const orgFolder of orgFolders) {
      const orgPath = path.join(relativePath, orgFolder.name);
      const orgLayouts = traverseAllLayouts(baseDir, orgPath);
      layouts.push(...orgLayouts);
    }
  } catch (err) {
    log.error(`Error reading directory ${currentDir}: ${err.message}`);
  }

  return layouts;
}

const parseFile = (route) => {
  const cacheKey = `route_${route}`;
  if (fileCache.has(cacheKey)) {
    log.debug(`Cache hit for route: ${route}`);
    return fileCache.get(cacheKey);
  }

  const startTime = performance.now();
  const segments = route.split("/").filter(Boolean);

  let currentDir = PAGES_DIR;
  let layouts = [];
  let middlewares = [];
  let params = {};
  let matchedFile = null;

  // Get all layouts from organizational folders
  layouts = traverseAllLayouts(PAGES_DIR);

  // Check for root middleware
  const rootMiddleware = path.join(PAGES_DIR, "middleware.js");
  if (fs.existsSync(rootMiddleware)) {
    middlewares.push(rootMiddleware);
  }

  // Special case for root route "/"
  if (segments.length === 0) {
    const rootIndexPath = path.join(PAGES_DIR, "index.html");
    if (fs.existsSync(rootIndexPath)) {
      const result = {
        layouts,
        middlewares,
        params,
        matchedFile: rootIndexPath
      };
      fileCache.set(cacheKey, result);
      
      const endTime = performance.now();
      log.info(`Parsed root route in ${(endTime - startTime).toFixed(2)}ms | Found ${layouts.length} layouts`);
      
      return result;
    }
  }

  let pathSoFar = "";

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    pathSoFar += "/" + segment;

    const { matchedDir, isParam, paramName } = findFile(currentDir, segment);

    if (matchedDir) {
      const newDir = path.join(currentDir, matchedDir.name);

      if (isParam) {
        params[paramName] = segment;
      }

      const segmentLayouts = findLayouts(newDir);
      layouts = [...layouts, ...segmentLayouts];

      try {
        const entries = fs.readdirSync(newDir, { withFileTypes: true });
        const orgFolders = entries.filter(
          (entry) => entry.isDirectory() && shouldIgnoreFolder(entry.name),
        );

        for (const orgFolder of orgFolders) {
          const orgDir = path.join(newDir, orgFolder.name);
          const orgLayouts = findLayouts(orgDir);
          layouts = [...layouts, ...orgLayouts];
        }
      } catch (err) {
        log.error(`Error finding org layouts in ${newDir}: ${err.message}`);
      }

      const middlewarePath = path.join(newDir, "middleware.js");
      if (fs.existsSync(middlewarePath)) {
        middlewares.push(middlewarePath);
      }

      if (i === segments.length - 1) {
        const pageFilePath = path.join(newDir, `${segment}.html`);
        const indexFilePath = path.join(newDir, "index.html");
        
        if (fs.existsSync(pageFilePath)) {
          matchedFile = pageFilePath;
        } else if (fs.existsSync(indexFilePath)) {
          matchedFile = indexFilePath;
        } else {
          const orgIndexFiles = recursivelyFindFiles(
            newDir,
            "index.html",
          ).filter((file) => {
            const relPath = path.relative(newDir, file);
            const segments = relPath.split(path.sep);
            return segments.length === 2 && shouldIgnoreFolder(segments[0]);
          });

          if (orgIndexFiles.length > 0) {
            matchedFile = orgIndexFiles[0];
          }
        }
      } else {
        currentDir = newDir;
      }
    } else {
      let foundInOrgFolder = false;

      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory() && shouldIgnoreFolder(entry.name)) {
            const orgDir = path.join(currentDir, entry.name);
            const orgResult = findFile(orgDir, segment);

            if (orgResult.matchedDir) {
              const newDir = path.join(orgDir, orgResult.matchedDir.name);

              if (orgResult.isParam) {
                params[orgResult.paramName] = segment;
              }

              const dirLayouts = findLayouts(newDir);
              layouts = [...layouts, ...dirLayouts];

              const middlewarePath = path.join(newDir, "middleware.js");
              if (fs.existsSync(middlewarePath)) {
                middlewares.push(middlewarePath);
              }

              if (i === segments.length - 1) {
                const pageFilePath = path.join(newDir, `${segment}.html`);
                const indexFilePath = path.join(newDir, "index.html");
                
                if (fs.existsSync(pageFilePath)) {
                  matchedFile = pageFilePath;
                } else if (fs.existsSync(indexFilePath)) {
                  matchedFile = indexFilePath;
                }
              }

              currentDir = newDir;
              foundInOrgFolder = true;
              break;
            }
          }
        }
      } catch (err) {
        log.error(`Error searching for segment in org folders: ${err.message}`);
      }

      if (!foundInOrgFolder) {
        if (i === segments.length - 1) {
          const directFilePath = path.join(currentDir, `${segment}.html`);
          if (fs.existsSync(directFilePath)) {
            matchedFile = directFilePath;
            break;
          }
        }
        
        log.debug(`No matching directory found for segment: ${segment}`);
        break;
      }
    }
  }

  layouts.sort((a, b) => {
    const aDepth = a.split(path.sep).length;
    const bDepth = b.split(path.sep).length;
    return aDepth - bDepth;
  });

  const result = { layouts, middlewares, params, matchedFile };
  fileCache.set(cacheKey, result);

  const endTime = performance.now();
  log.info(
    `Parsed route ${route} in ${(endTime - startTime).toFixed(2)}ms | Found ${layouts.length} layouts`,
  );

  return result;
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
