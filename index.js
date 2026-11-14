"use strict";

const express = require("express");
const chokidar = require("chokidar");
const fs = require("node:fs");
const path = require("node:path");
const renderFile = require("./src/utils/renderFile");
const log = require("./src/utils/logger");
const callflowModule = require("./callflow");

const app = express();
const port = process.env.PORT || 3000;
const projectRoot = path.resolve(process.env.user_dir || process.cwd());
const configPath = path.join(projectRoot, "callflow.config.js");
const callflow = {
  exposedFunctions: Object.create(null),
  exposedVariables: Object.create(null),
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.post("/__callflow_server__/invoke/:function", async (req, res) => {
  // Browser RPC is same-origin; consumers must still authorize sensitive actions themselves.
  const origin = req.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) {
        return res.status(403).json({ error: "Cross-origin invocation denied" });
      }
    } catch {
      return res.status(403).json({ error: "Invalid origin" });
    }
  }

  const functionData = Object.hasOwn(callflow.exposedFunctions, req.params.function)
    ? callflow.exposedFunctions[req.params.function]
    : null;
  if (!functionData) return res.status(404).json({ error: "Function not found" });
  if (!Array.isArray(req.body) || req.body.length !== functionData.args.length) {
    return res.status(400).json({ error: "Invalid arguments" });
  }

  try {
    const result = await functionData.fn(req, res, ...req.body);
    if (!res.headersSent) res.status(200).json({ result: result === undefined ? null : result });
  } catch (error) {
    log.error(`RPC ${req.params.function} failed: ${error.message}`);
    if (!res.headersSent) res.status(500).json({ error: "Failed to execute function" });
  }
});

app.get("*", (req, res) => renderFile(req, res, callflow));

callflowModule._setCallbacks(
  (name, args, fn) => {
    if (typeof name !== "string" || !/^[A-Za-z_$][\w$]*$/.test(name) || !Array.isArray(args) || typeof fn !== "function") {
      throw new TypeError("exposeFunction(name, args, fn): invalid function declaration");
    }
    callflow.exposedFunctions[name] = { args, fn };
  },
  (name, value) => {
    if (typeof name !== "string" || !/^[A-Za-z_$][\w$]*$/.test(name)) {
      throw new TypeError("exposeVariable(name, value): invalid variable name");
    }
    callflow.exposedVariables[name] = value;
  },
);

function loadConfig() {
  const previousFunctions = callflow.exposedFunctions;
  const previousVariables = callflow.exposedVariables;
  callflow.exposedFunctions = Object.create(null);
  callflow.exposedVariables = Object.create(null);
  try {
    delete require.cache[require.resolve(configPath)];
    require(configPath);
  } catch (err) {
    callflow.exposedFunctions = previousFunctions;
    callflow.exposedVariables = previousVariables;
    throw err;
  }
}

if (!fs.existsSync(configPath)) {
  throw new Error(`CallFlow config not found: ${configPath}. Run 'callflow init' first.`);
}
loadConfig();

if (process.env.NODE_ENV === "development") {
  chokidar.watch(configPath, { ignoreInitial: true }).on("change", () => {
    try {
      loadConfig();
      log.info("Reloaded callflow.config.js");
    } catch (err) {
      log.error(`Failed to reload callflow.config.js: ${err.message}`);
    }
  });
}

app.listen(port, () => log.info(`CallFlow server running at http://localhost:${port} (${process.env.NODE_ENV || "production"})`));
