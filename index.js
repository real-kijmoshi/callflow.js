const express = require("express");
const renderFile = require("./src/utils/renderFile");
const log = require("./src/utils/logger");
const path = require("path");
const callflowModule = require("./callflow");


const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let callflow = {
  TCP_URL: "tcp://localhost:3000",
  HTTP_URL: "http://localhost:3000",
  exposedFunctions: {},
  exposedVariables: {},
};

app.get("/__callflow_server__/scripts/:script", (req, res) => {
  let scriptPath = path.join(__dirname, "src", "scripts", req.params.script);
  if (fs.existsSync(scriptPath)) {
    log.debug(`Serving script: ${req.params.script}`);
    return res.status(200).sendFile(scriptPath);
  }
});

app.post("/__callflow_server__/invoke/:function", (req, res) => {
  let functionName = req.params.function;
  let functionData = callflow.exposedFunctions[functionName];
  if (!functionData) {
    return res.status(404).send({
      error: "Function not found",
    });
  }

  const args = req.body || [];
  if (args.length !== functionData.args.length) {
    return res.status(400).send({
      error: "Invalid arguments",
    });
  }

  try {
    const result = functionData.fn(req, res, ...args);
    return res.status(200).send({ result });
  } catch (err) {
    return res.status(500).send({
      error: "Failed to execute function",
    });
  }
});


app.get("*", (req, res) => {
  renderFile(req, res, callflow);
});

callflowModule._setCallbacks(
  (name, args, fn) => {
    callflow.exposedFunctions[name] = { args, fn };
  },
  (name, value) => {
    callflow.exposedVariables[name] = value;
  }
);

require(process.env.user_dir + "/callflow.config.js");

if(process.env.NODE_ENV === "development") {
  const chokidar = require("chokidar");
  const watcher = chokidar.watch(process.env.user_dir, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
  });

  watcher.on("change", (path) => {
    log.info(`File ${path} has been changed`);
    log.info("Reloading callflow.config.js");
    delete require.cache[require.resolve(process.env.user_dir + "/callflow.config.js")];
    
    // Reset the callflow state
    callflow.exposedFunctions = {};
    callflow.exposedVariables = {};
    
    require(process.env.user_dir + "/callflow.config.js");
  });
}

app.listen(port, () => {
  log.info(`-----------------------------------`)
  log.info(`Server is running at http://localhost:${port}`)
  log.info(`environment: ${process.env.NODE_ENV}`)
  log.info(`-----------------------------------`)
});
