const chalk = require("chalk");
const moment = require("moment");

const log = {
  info: (message) => {
    if (process.env.NODE_ENV === "development") {
      console.log(
        chalk.greenBright(
          `[${moment().format("YYYY-MM-DD HH:mm:ss")}] ${message}`,
        ),
      );
    }
  },
  error: (message) =>
    console.error(
      chalk.redBright(`[${moment().format("YYYY-MM-DD HH:mm:ss")}] ${message}`),
    ),
  warn: (message) =>
    console.warn(
      chalk.yellowBright(
        `[${moment().format("YYYY-MM-DD HH:mm:ss")}] ${message}`,
      ),
    ),
  debug: (message) => {
    if (process.env.DEBUG || process.env.NODE_ENV === "development") {
      console.log(
        chalk.blueBright(
          `[${moment().format("YYYY-MM-DD HH:mm:ss")}] ${message}`,
        ),
      );
    }
  },
};

module.exports = log;
