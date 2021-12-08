/**
 * Licensed under the MIT License.
 */

import async from "async";
import path from "path";
import fs from "fs";

import {
  SpawnSyncOptions,
  StdioOptions,
  execSync,
  spawn,
  spawnSync,
} from "child_process";

// @ts-ignore (no typings for clang-format)
import { getNativeBinary } from "clang-format";

const config: Config = {
  includeEndsWith: [],
  excludePathContains: [],
  excludePathEndsWith: [],
  excludePathStartsWith: [],
  gitRoot: process.cwd(),
  style: "--style=file",
};

let verbose = false;

const VERIFY_FLAG = "-verify";
const RAW_FLAG = "-raw";
const CONFIG_FILE = "clang.format.json";
const VERBOSE_FLAG = "--verbose";
const HELP_FLAG = "--help";
const VERSION_FLAG = "--version";
const LAUNCHER = "clang-format-launcher";

interface Config {
  includeEndsWith?: string[];
  excludePathContains?: string[];
  excludePathEndsWith?: string[];
  excludePathStartsWith?: string[];
  gitRoot?: string;
  style?: string;
}

const hasPackageJsonLauncherKey = (packagePath: string) => {
  const content = fs.readFileSync(packagePath, "utf8");
  try {
    return LAUNCHER in JSON.parse(content);
  } catch {
    // If package is not a valid JSON
    return false;
  }
};

const resolveConfigPath = (cwd: string) => {
  const candidates = [
    path.resolve(cwd, "package.json"),
    path.resolve(cwd, CONFIG_FILE),
    path.resolve(__dirname, "../", CONFIG_FILE),
  ];
  return candidates.filter((name) => {
    if (fs.existsSync(name)) {
      if (path.basename(name) === "package.json") {
        return hasPackageJsonLauncherKey(name);
      }
      return true;
    }
    return false;
  })[0];
};

function main() {
  const verify = process.argv.indexOf(VERIFY_FLAG) !== -1;
  verbose = process.argv.indexOf(VERBOSE_FLAG) !== -1;
  let useRaw = process.argv.indexOf(RAW_FLAG) !== -1;
  useRaw = useRaw || process.argv.indexOf(VERSION_FLAG) !== -1;
  const help = process.argv.indexOf(HELP_FLAG) !== -1;
  useRaw = useRaw || help;
  if (help) {
    printHelp();
  }

  let args = process.argv
    .slice(2)
    .filter((_) => _ !== VERIFY_FLAG && _ !== RAW_FLAG);

  if (!useRaw) {
    loadConfig();

    if (verify) {
      args = ["-Werror", "--dry-run", ...args];
    } else {
      args = ["-Werror", "-i", ...args];
    }
    if (config.style) {
      args = [config.style, ...args];
    }
  }

  const handleDone = (checkGitStatus: boolean) => (error?: Error) => {
    if (error) {
      process.stdout.write(error.message);
      process.exit(3);
    }
    if (checkGitStatus) {
      queryNoOpenFiles();
    }
  };

  // Run clang-format.
  try {
    // Pass all arguments to clang-format, including e.g. -version etc.
    if (useRaw) {
      spawnClangFormatRaw(args, handleDone(false), "inherit");
    } else {
      spawnClangFormat(args, handleDone(verify), "inherit");
    }
  } catch (e) {
    process.stdout.write((e as Error).message);
    process.exit(1);
  }
}

function verboseLog(s: string) {
  if (verbose) {
    console.log(s);
  }
}
function loadConfig() {
  const cwd = process.cwd();
  const resolvedPath: string = resolveConfigPath(cwd);
  verboseLog("Using conf file: " + resolvedPath);
  try {
    const jsonString = fs.readFileSync(resolvedPath, {
      encoding: "utf8",
      flag: "r",
    });
    const json = JSON.parse(jsonString);
    let conf: Config = LAUNCHER in json ? json[LAUNCHER] : json;

    config.includeEndsWith = conf.includeEndsWith ?? config.includeEndsWith;
    config.excludePathContains =
      conf.excludePathContains ?? config.excludePathContains;
    config.excludePathEndsWith =
      conf.excludePathEndsWith ?? config.excludePathEndsWith;
    config.excludePathStartsWith =
      conf.excludePathStartsWith ?? config.excludePathStartsWith;
    config.gitRoot = conf.gitRoot ?? config.gitRoot;
    config.style = conf.style ?? config.style;
    if (!path.isAbsolute(config.gitRoot)) {
      config.gitRoot = path.resolve(cwd, config.gitRoot);
    }
  } catch (e) {
    console.log("Fail to parse conf file");
    console.log((e as Error).message);
    process.exit(1);
  }

  verboseLog("Resolved Config:");
  verboseLog(JSON.stringify(config));
}

function queryNoOpenFiles() {
  const opened = execSync("git status -s").toString();
  if (opened) {
    console.error(
      "The following files have incorrect formatting or not committed:"
    );
    console.error(opened);
    process.exit(2);
  }
}

function errorFromExitCode(exitCode: number) {
  return new Error(`clang-format exited with exit code ${exitCode}.`);
}

function git(args: string[], options: SpawnSyncOptions) {
  verboseLog("git: " + JSON.stringify(args) + "  " + JSON.stringify(options));
  const results = spawnSync("git", args, options);

  if (results.status === 0) {
    return {
      stderr: results.stderr.toString().trim(),
      stdout: results.stdout.toString().trim(),
      success: true,
    };
  } else {
    return {
      stderr: results.stderr.toString().trim(),
      stdout: results.stdout.toString().trim(),
      success: false,
    };
  }
}

function listAllTrackedFiles(cwd: string) {
  const results = git(["ls-tree", "-r", "--name-only", "--full-tree", "HEAD"], {
    cwd,
  });

  if (results.success) {
    return results.stdout.split("\n");
  }

  return [];
}

/**
 * Spawn the clang-format binary with given arguments.
 */
function spawnClangFormat(
  args: string[],
  done: (Error?: any) => void,
  stdio: StdioOptions
) {
  // WARNING: This function's interface should stay stable across versions for the cross-version
  // loading below to work.
  let nativeBinary: string;

  try {
    nativeBinary = getNativeBinary();
    verboseLog("native Clang-format: " + nativeBinary);
  } catch (e) {
    setImmediate(done.bind(e));
    return;
  }

  let files = listAllTrackedFiles(config.gitRoot);

  // Apply file filters from constants
  files = files.filter(
    (file) =>
      config.includeEndsWith.some((_) => file.endsWith(_)) &&
      !config.excludePathContains.some((_) => file.indexOf(_) >= 0) &&
      !config.excludePathEndsWith.some((_) => file.endsWith(_)) &&
      !config.excludePathStartsWith.some((_) => file.startsWith(_))
  );

  // split file array into chunks of 30
  let i: number;
  let j: number;
  const chunks = [];
  const chunkSize = 30;

  for (i = 0, j = files.length; i < j; i += chunkSize) {
    chunks.push(files.slice(i, i + chunkSize));
  }

  // launch a new process for each chunk
  async.series<number, Error>(
    chunks.map((chunk) => {
      return function (callback) {
        const clangFormatProcess = spawn(nativeBinary, args.concat(chunk), {
          cwd: config.gitRoot,
          stdio: stdio,
        });
        clangFormatProcess.on("close", (exit) => {
          if (exit !== 0) {
            callback(errorFromExitCode(exit!));
          } else {
            callback();
          }
        });
      };
    }),
    (err) => {
      if (err) {
        done(err);
        return;
      }
      console.log("\n");
      console.log(
        `ran clang-format on ${files.length} ${
          files.length === 1 ? "file" : "files"
        }`
      );
      done();
    }
  );
}

/**
 * Spawn the clang-format binary with given arguments.
 */
function spawnClangFormatRaw(
  args: string[],
  done: (any?: Error) => void,
  stdio: StdioOptions
) {
  // WARNING: This function's interface should stay stable across versions for the cross-version
  // loading below to work.
  let nativeBinary: string;

  try {
    nativeBinary = getNativeBinary();
    verboseLog("native Clang-format: " + nativeBinary);
  } catch (e) {
    setImmediate(done.bind(e));
    return;
  }

  verboseLog("clang-format " + JSON.stringify(args));
  const clangFormatProcess = spawn(nativeBinary, args, {
    cwd: config.gitRoot,
    stdio: stdio,
  });
  clangFormatProcess.on("close", (exit) => {
    if (exit !== 0) {
      done(errorFromExitCode(exit!));
    } else {
      done();
    }
  });
}

function printHelp() {
  console.log(
    `
clang-format-launcher is a clang-format wrapper.
It uses 'git ls-tree' to speed up the file lookup and reduce the noise, then filters the files by the rule which is defined in clang.format.json or package.json.
It looks cwd/package.json, cwd/clang.format.json and finally fallback to node_modules/clang-format-launcher/clang.format.json.
Usage:
  npx clang-format-launcher [options] [other options]
    Options:
      -raw
      -verify 

  npx clang-format-launcher [other options]
    equal to 'npx clang-format --style=file -Werror -i [other options] [Files after filter]'

  npx clang-format-launcher -verify [other options]
    equal to 'npx clang-format --style=file -Werror --dry-run [other options] [Files after filter]'

  npx clang-format-launcher -raw [other options]
    equal to 'npx clang-format  [other options]

  npx clang-format-launcher --verbose
  
  npx clang-format-launcher --help

clang.format.json example:
{
  "includeEndsWith": [".h",".cpp"],
  "excludePathContains": ["/ios/", "/nodejs/", "/android/"],
  "excludePathEndsWith": [".g.h",".g.cpp"],  
  "excludePathStartsWith": [],
  "gitRoot": "../..",
  "style": "--style=file"
}

package.json example:
{
  "clang-format-launcher": {
    "includeEndsWith": [".h",".cpp"],
    "excludePathContains": ["/ios/", "/nodejs/", "/android/"],
    "excludePathEndsWith": [".g.h",".g.cpp"],  
    "excludePathStartsWith": [],
    "gitRoot": ".",
    "style": "--style=file"
  }
}

`
  );
}

main();
