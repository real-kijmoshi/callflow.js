#! /usr/bin/env node

const { Command } = require("commander");
const fs = require("fs");
const chalk = require("chalk");
const path = require("path");
const inquirer = require("inquirer").default;
const ora = require("ora");

const user_dir = process.cwd();
const callflow_dir = path.join(__dirname, "..");

function copyRecursiveSync(src, dest) {
  const stats = fs.statSync(src);

  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) {
      console.log(chalk.cyan(`Creating directory: ${dest}`));
      fs.mkdirSync(dest, { recursive: true });
    }

    const files = fs.readdirSync(src);
    files.forEach((file) => {
      const srcFile = path.join(src, file);
      const destFile = path.join(dest, file);
      copyRecursiveSync(srcFile, destFile);
    });
  } else if (stats.isFile()) {
    if (fs.existsSync(dest)) {
      console.log(chalk.yellow(`Skipping existing file: ${dest}`));
    } else {
      fs.copyFileSync(src, dest);
      console.log(chalk.green(`File copied: ${dest}`));
    }
  }
}

async function promptForProjectDetails() {
  return inquirer.prompt([
    {
      type: "input",
      name: "projectName",
      message: "Project name:",
      default: path.basename(user_dir),
    },
    {
      type: "confirm",
      name: "installDeps",
      message: "Install dependencies after setup?",
      default: true,
    },
  ]);
}

async function installDependencies(projectPath) {
  const spinner = ora("Installing dependencies...").start();

  return new Promise((resolve, reject) => {
    const { exec } = require("child_process");
    exec("npm install", { cwd: projectPath }, (error) => {
      if (error) {
        spinner.fail("Failed to install dependencies");
        reject(error);
        return;
      }

      spinner.succeed("Dependencies installed successfully");
      resolve();
    });
  });
}

const program = new Command();

process.env.user_dir = user_dir;

program
  .command("dev")
  .description("Start the development server")
  .option("-p, --port <port>", "Specify port to use", "3000")
  .action((options) => {
    console.log(
      chalk.blue(`Starting development server on port ${options.port}...`),
    );
    process.env.NODE_ENV = "development";
    process.env.PORT = options.port;

    try {
      require(path.join(callflow_dir, "index.js"));
      console.log(
        chalk.green(`Server is running at http://localhost:${options.port}`),
      );
    } catch (error) {
      console.error(chalk.red("Failed to start development server:"));
      console.error(error);
      process.exit(1);
    }
  });

program
  .command("start")
  .description("Start the production server")
  .option("-p, --port <port>", "Specify port to use", "3000")
  .action((options) => {
    console.log(
      chalk.blue(`Starting production server on port ${options.port}...`),
    );
    process.env.NODE_ENV = "production";
    process.env.PORT = options.port;

    try {
      require(path.join(callflow_dir, "index.js"));
      console.log(
        chalk.green(`Server is running at http://localhost:${options.port}`),
      );
    } catch (error) {
      console.error(chalk.red("Failed to start production server:"));
      console.error(error);
      process.exit(1);
    }
  });

program
  .command("init")
  .description("Initialize a new project")
  .option("-y, --yes", "Skip prompts and use defaults", false)
  .action(async (options) => {
    console.log(chalk.blue("Creating new CallFlow project..."));

    let projectDetails;
    if (options.yes) {
      projectDetails = {
        projectName: path.basename(user_dir),
        installDeps: true,
      };
    } else {
      projectDetails = await promptForProjectDetails();
    }

    const { projectName, installDeps } = projectDetails;
    const projectDir = path.join(user_dir, projectName);
    const templateDir = path.join(callflow_dir, "example");

    const spinner = ora(`Creating project: ${projectName}`).start();

    if (fs.existsSync(projectDir)) {
      spinner.warn(`Directory ${projectName} already exists`);
      const { overwrite } = await inquirer.prompt({
        type: "confirm",
        name: "overwrite",
        message: "Directory already exists. Continue anyway?",
        default: false,
      });

      if (!overwrite) {
        console.log(chalk.red("Project initialization canceled"));
        process.exit(1);
      }
    } else {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    spinner.succeed(`Project directory created at ${projectDir}`);

    try {
      console.log(chalk.blue("Copying template files..."));
      copyRecursiveSync(templateDir, projectDir);
      console.log(chalk.green("Template files copied successfully"));

      // Update package.json
      const packageJsonPath = path.join(projectDir, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = require(packageJsonPath);
        packageJson.name =
          projectName == "." ? path.basename(user_dir) : projectName;
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        console.log(chalk.green("Updated package.json with project name"));
      }

      // Install dependencies if requested
      if (installDeps) {
        await installDependencies(projectDir);
      }

      console.log(chalk.green("\nProject created successfully!"));
      console.log(chalk.blue("\nNext steps:"));
      console.log(`1. Change to project directory: cd ${projectName}`);
      console.log(
        `2. ${installDeps ? "Start development server: callflow dev" : "Install dependencies: npm install"}`,
      );
    } catch (error) {
      console.error(chalk.red("Error during project creation:"));
      console.error(error);
      process.exit(1);
    }
  });

program.parse(process.argv);
