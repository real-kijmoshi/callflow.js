const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const chokidar = require("chokidar");

const log = require("./logger");

// Configuration
const PROJECT_ROOT = process.cwd();
const PAGES_DIR = path.join(PROJECT_ROOT, "pages");
const DEVELOPMENT = process.env.NODE_ENV === "development";

class Cache {
  constructor(name) {
    this.name = name;
    this.store = new Map();
    this.timestamps = new Map(); // Track when items were added
  }

  get(key) {
    return this.store.get(key);
  }

  set(key, value) {
    this.timestamps.set(key, Date.now());
    this.store.set(key, value);
    return value;
  }

  has(key) {
    return this.store.has(key);
  }

  invalidate(key) {
    if (this.store.has(key)) {
      log.debug(`Invalidating ${this.name} cache for: ${path.basename(key)}`);
      this.store.delete(key);
      this.timestamps.delete(key);
      return true;
    }
    return false;
  }

  clear() {
    const size = this.store.size;
    this.store.clear();
    this.timestamps.clear();
    log.info(`Cleared ${this.name} cache (${size} entries)`);
  }

  get size() {
    return this.store.size;
  }
}

// Initialize caches
const fileCache = new Cache("file");
const layoutCache = new Cache("layout");
const middlewareCache = new Cache("middleware");
const routeCache = new Cache("route");



// Improved file finding with memoization
const findInDir = (curpath, searchedFor) => {
  const cacheKey = `${curpath}:${searchedFor}`;
  
  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey);
  }

  let result = null;

  // Handle empty search (index files)
  if (!searchedFor || searchedFor === "") {
    if (fs.existsSync(path.join(curpath, "index.html"))) {
      result = path.join(curpath, "index.html");
    } else if (fs.existsSync(path.join(curpath, "index.htm"))) {
      result = path.join(curpath, "index.htm");
    }
    return routeCache.set(cacheKey, result);
  }

  try {
    const inDir = fs.readdirSync(curpath);
    const files = [];
    const dirs = [];

    // Separate files and directories for better organization
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

    // Search in exact match directories first
    for (const dir of dirs) {
      if (segment === dir) {
        const dirResult = findInDir(path.join(curpath, dir), remainingPath);
        if (dirResult) {
          result = dirResult;
          break;
        }
      }
    }

    // If not found, try dynamic route directories
    if (!result) {
      for (const dir of dirs) {
        if (dir.startsWith("[") && dir.endsWith("]")) {
          const dirResult = findInDir(path.join(curpath, dir), remainingPath);
          if (dirResult) {
            result = dirResult;
            break;
          }
        }
      }
    }

    // Try group directories (they don't consume path segments)
    if (!result) {
      for (const dir of dirs) {
        if (dir.startsWith("(") && dir.endsWith(")")) {
          const dirResult = findInDir(path.join(curpath, dir), searchedFor);
          if (dirResult) {
            result = dirResult;
            break;
          }
        }
      }
    }

    // If still not found and we're at the last segment, try file matches
    if (!result && isLastSegment) {
      // Direct match with .html or .htm
      if (files.includes(segment + ".html")) {
        result = path.join(curpath, segment + ".html");
      } else if (files.includes(segment + ".htm")) {
        result = path.join(curpath, segment + ".htm");
      } else {
        // Dynamic parameter files
        for (const file of files) {
          if (
            (file.startsWith("[") && file.endsWith("].html")) ||
            (file.startsWith("[") && file.endsWith("].htm"))
          ) {
            result = path.join(curpath, file);
            break;
          }
        }
      }
    }
  } catch (err) {
    log.error(`Error finding file in directory ${curpath}: ${err.message}`);
  }

  return routeCache.set(cacheKey, result);
};

// Enhanced layout and middleware finder with caching
const findLayoutsAndMiddlewaresInPath = (matchedFile) => {
  const cacheKey = matchedFile;
  
  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey);
  }

  const segments = matchedFile.split(path.sep).slice(0, -1);
  const layouts = [];
  const middlewares = [];

  // Check root layouts and middlewares
  const rootLayoutPath = path.join(PAGES_DIR, "_layout.html");
  const rootMiddlewarePath = path.join(PAGES_DIR, "_middleware.js");

  if (fs.existsSync(rootLayoutPath)) {
    layouts.push(rootLayoutPath);
  }

  if (fs.existsSync(rootMiddlewarePath)) {
    middlewares.push(rootMiddlewarePath);
  }

  // Check all path segments for nested layouts and middlewares
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

  return routeCache.set(cacheKey, { layouts, middlewares });
};

// Parameter extraction from path
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

    // Extract parameter from dynamic route segment
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
    } 
    // Skip group segments (parentheses) but handle other static segments
    else if (
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

// File parsing with caching
const parseFile = (filePath) => {
  const cacheKey = filePath;
  
  if (routeCache.has(cacheKey) && !DEVELOPMENT) {
    return routeCache.get(cacheKey);
  }

  const fileParts = filePath
    .split("?")[0]
    .split("/")
    .filter((part) => part !== "");

  const matchedFile = findInDir(PAGES_DIR, fileParts.join("/"));

  if (!matchedFile) {
    return routeCache.set(cacheKey, { layouts: [], middlewares: [], params: {}, matchedFile: null });
  }

  const relativePath = path.relative(PAGES_DIR, matchedFile);
  const { layouts, middlewares } = findLayoutsAndMiddlewaresInPath(relativePath);
  const params = getParamsFromPath(relativePath, filePath);

  return routeCache.set(cacheKey, { layouts, middlewares, params, matchedFile });
};

// Layout application with improved caching and performance
const applyLayouts = (content, layoutPaths, params) => {
  const startTime = performance.now();

  const result = layoutPaths.reduce((acc, layoutPath, index) => {
    const layoutStartTime = performance.now();
    let layoutContent;

    // Get layout content with caching
    if (layoutCache.has(layoutPath)) {
      layoutContent = layoutCache.get(layoutPath);
      log.debug(
        `Using cached layout: ${path.basename(layoutPath)} [${path.relative(PAGES_DIR, layoutPath)}]`
      );
    } else {
      try {
        layoutContent = fs.readFileSync(layoutPath, "utf8");
        layoutCache.set(layoutPath, layoutContent);
        log.debug(
          `Loaded layout: ${path.basename(layoutPath)} [${path.relative(PAGES_DIR, layoutPath)}]`
        );
      } catch (err) {
        log.error(`Failed to read layout ${layoutPath}: ${err.message}`);
        return acc;
      }
    }

    // Apply layout and parameter injection
    let processedContent = layoutContent.replace("<%content%>", acc);

    // Inject parameters
    Object.entries(params).forEach(([key, value]) => {
      const regex = new RegExp(`\\{${key}\\}`, "g");
      processedContent = processedContent.replace(regex, value);
    });

    const layoutEndTime = performance.now();
    log.debug(
      `Applied layout ${path.basename(layoutPath)} (${index + 1}/${layoutPaths.length}) in ${(layoutEndTime - layoutStartTime).toFixed(2)}ms`
    );

    return processedContent;
  }, content);

  const endTime = performance.now();
  log.info(
    `Applied ${layoutPaths.length} layouts in ${(endTime - startTime).toFixed(2)}ms`
  );

  return result;
};

// Improved middleware handling with native async/await pattern
const applyMiddlewares = async (middlewarePaths, req, res) => {
  const startTime = performance.now();
  let appliedCount = 0;

  for (const middlewarePath of middlewarePaths) {
    let middleware;
    
    // Load or use cached middleware
    if (middlewareCache.has(middlewarePath) && !DEVELOPMENT) {
      middleware = middlewareCache.get(middlewarePath);
      log.debug(`Using cached middleware: ${path.basename(middlewarePath)}`);
    } else {
      try {
        // Always reload in development mode
        if (DEVELOPMENT && require.cache[require.resolve(middlewarePath)]) {
          delete require.cache[require.resolve(middlewarePath)];
          log.debug(`Hot reloading middleware: ${path.basename(middlewarePath)}`);
        }

        middleware = require(middlewarePath);
        middlewareCache.set(middlewarePath, middleware);
        log.debug(`Loaded middleware: ${path.basename(middlewarePath)}`);
      } catch (err) {
        log.error(
          `Failed to load middleware ${middlewarePath}: ${err.message}`
        );
        continue;
      }
    }

    // Execute middleware
    if (typeof middleware === "function") {
      try {
        const middlewareStartTime = performance.now();
        
        // Handle both sync and async middleware consistently
        await Promise.resolve(middleware(req, res));
        
        const middlewareEndTime = performance.now();
        log.debug(
          `Middleware ${path.basename(middlewarePath)} completed in ${(middlewareEndTime - middlewareStartTime).toFixed(2)}ms`
        );

        appliedCount++;

        // Stop chain if response was sent
        if (res.headersSent) {
          log.info(
            `Middleware sent response, stopping chain at ${path.basename(middlewarePath)}`
          );
          return false;
        }
      } catch (err) {
        log.error(`Error in middleware ${middlewarePath}: ${err.message}`);
        if (!res.headersSent) {
          res.status(500).send("Internal Server Error");
        }
        return false;
      }
    }
  }

  const endTime = performance.now();
  log.info(
    `Applied ${appliedCount}/${middlewarePaths.length} middlewares in ${(endTime - startTime).toFixed(2)}ms`
  );

  return true;
};

// More efficient parameter injection
const injectParams = (content, params) => {
  if (Object.keys(params).length === 0) return content;
  
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
    `Injected ${Object.keys(params).length} params with ${replacementsCount} replacements in ${(endTime - startTime).toFixed(2)}ms`
  );

  return result;
};

// Client-side function injection
const injectExposedFunctions = (callflow) => {
  if (Object.keys(callflow.exposedFunctions).length === 0) return "";
  
  let result = "<script>\n";

  Object.entries(callflow.exposedFunctions).forEach(([key, value]) => {
    if (typeof value.fn === "function") {
      result += `callflow.fn.${key} = async function(${value.args.map((arg) => arg.name).join(", ")}) {
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
};\n`;
    }
  });

  result += "</script>\n";
  return result;
};

// Client-side variable injection
const injectExposedVariables = (callflow) => {
  if (Object.keys(callflow.exposedVariables).length === 0) return "";
  
  let result = "<script>\n";

  Object.entries(callflow.exposedVariables).forEach(([key, value]) => {
    result += `callflow.vars["${key}"] = ${JSON.stringify(value)};\n`;
  });

  result += "</script>\n";
  return result;
};

// File system watcher for hot reloading
let watcher;
const setupWatcher = () => {
  if (!DEVELOPMENT || watcher) return;

  watcher = chokidar.watch(PAGES_DIR, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
  });

  watcher
    .on('add', path => invalidateRelatedCaches(path))
    .on('change', path => invalidateRelatedCaches(path))
    .on('unlink', path => invalidateRelatedCaches(path));
    
  log.info('File watcher started for hot reloading');
};

// Smart cache invalidation
const invalidateRelatedCaches = (filePath) => {
  const relativePath = path.relative(PAGES_DIR, filePath);
  
  // Clear specific cache entries related to the changed file
  if (filePath.endsWith('.html') || filePath.endsWith('.htm')) {
    fileCache.invalidate(filePath);
    
    if (filePath.endsWith('_layout.html')) {
      layoutCache.invalidate(filePath);
      
      // Clear route cache completely on layout changes
      // as they affect potentially many pages
      routeCache.clear();
    } else {
      // For regular HTML files, only invalidate related route entries
      for (const [key, value] of routeCache.store.entries()) {
        if (value.matchedFile === filePath) {
          routeCache.invalidate(key);
        }
      }
    }
  } else if (filePath.endsWith('_middleware.js')) {
    middlewareCache.invalidate(filePath);
    
    // Clear route cache completely on middleware changes
    routeCache.clear();
  }
  
  log.debug(`File changed: ${relativePath}, related caches invalidated`);
};

// Main render function
const renderFile = async (req, res, callflow) => {
  const startTime = performance.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

  // Initialize watcher on first request in dev mode
  if (DEVELOPMENT) {
    setupWatcher();
  }

  log.info(`[${requestId}] Processing request for ${req.method} ${req.path}`);

  try {
    const routeStartTime = performance.now();
    const { layouts, middlewares, params, matchedFile } = parseFile(req.path);
    const routeEndTime = performance.now();

    log.info(
      `[${requestId}] Route parsing completed in ${(routeEndTime - routeStartTime).toFixed(2)}ms`
    );

    if (layouts.length > 0) {
      log.debug(
        `[${requestId}] Found layouts: ${layouts.map((l) => path.relative(PAGES_DIR, l)).join(", ")}`
      );
    }

    // Apply middlewares
    const middlewareStartTime = performance.now();
    const shouldContinue = await applyMiddlewares(middlewares, req, res);
    const middlewareEndTime = performance.now();

    log.info(
      `[${requestId}] Middleware chain completed in ${(middlewareEndTime - middlewareStartTime).toFixed(2)}ms`
    );

    if (!shouldContinue) {
      log.info(`[${requestId}] Request handled by middleware`);
      return;
    }

    // Handle file rendering
    if (matchedFile) {
      try {
        const renderStartTime = performance.now();
        let fileContent;

        // Get file content with caching in production
        if (fileCache.has(matchedFile) && !DEVELOPMENT) {
          fileContent = fileCache.get(matchedFile);
          log.debug(`[${requestId}] Using cached file: ${path.basename(matchedFile)}`);
        } else {
          log.debug(`[${requestId}] Reading file: ${matchedFile}`);
          fileContent = fs.readFileSync(matchedFile, "utf8");
          fileCache.set(matchedFile, fileContent);
        }

        // Base script injection
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

        // Apply layouts and inject parameters
        log.debug(`[${requestId}] Applying ${layouts.length} layouts`);
        const layoutContent = applyLayouts(fileContent, layouts, params);

        log.debug(
          `[${requestId}] Injecting params: ${Object.keys(params).join(", ")}`
        );
        const contentWithParams = injectParams(layoutContent, params);

        // Inject exposed functions and variables
        const exposedFunctionsInjection = injectExposedFunctions(callflow);
        const exposedVariablesInjection = injectExposedVariables(callflow);

        // Assemble final content
        const finalContent = `${scriptsInjection}
${exposedFunctionsInjection}
${exposedVariablesInjection}
${contentWithParams}`;

        // Set response headers
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("X-Powered-By", "CallflowJS");
        res.setHeader("X-Request-ID", requestId);

        // Cache control
        if (!DEVELOPMENT) {
          res.setHeader("Cache-Control", "public, max-age=3600");
        } else {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
        }

        res.status(200).send(finalContent);

        const renderEndTime = performance.now();
        log.info(
          `[${requestId}] Rendered ${path.relative(PAGES_DIR, matchedFile)} in ${(renderEndTime - renderStartTime).toFixed(2)}ms`
        );

        const endTime = performance.now();
        log.info(
          `[${requestId}] Total request time: ${(endTime - startTime).toFixed(2)}ms`
        );
      } catch (err) {
        log.error(
          `[${requestId}] Failed to read file ${matchedFile}: ${err.message}`
        );
        res.status(500).send("Internal Server Error");
      }
    } else {
      // Handle 404
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

// Cache management functions
const clearFileCache = () => fileCache.clear();
const clearLayoutCache = () => layoutCache.clear();
const clearMiddlewareCache = () => middlewareCache.clear();
const clearRouteCache = () => routeCache.clear();

const clearAllCaches = () => {
  clearFileCache();
  clearLayoutCache();
  clearMiddlewareCache();
  clearRouteCache();
};

// Clean up watcher on exit
process.on('SIGINT', () => {
  if (watcher) {
    watcher.close();
    log.info('File watcher closed');
  }
  process.exit(0);
});

module.exports = renderFile;
module.exports.clearFileCache = clearFileCache;
module.exports.clearLayoutCache = clearLayoutCache;
module.exports.clearMiddlewareCache = clearMiddlewareCache;
module.exports.clearRouteCache = clearRouteCache;
module.exports.clearAllCaches = clearAllCaches;