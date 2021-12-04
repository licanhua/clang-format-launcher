/**
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 *
 * @format
 */

import async from 'async';
import path from 'path';
import fs from 'fs';

import {
  SpawnSyncOptions,
  StdioOptions,
  execSync,
  spawn,
  spawnSync,
} from 'child_process';

// @ts-ignore (no typings for clang-format)
import { getNativeBinary } from 'clang-format';

/// These variables control which files are formatted
let includeEndsWith = ['.h', '.cpp'];
let excludePathContains: string[] = [];
let excludePathEndsWith = ['.g.h', '.g.cpp'];
let excludePathStartsWith: string[] = [];
let folder = path.resolve(__dirname, '../../../');
let style = "--style=file";

let verbose = false;

const VERIFY_FLAG = '-verify';
const CONFIG_FILE = 'clang.format.json'
const VERBOSE_FLAG = '--verbose';
const RAW_FLAG = '-raw';
const HELP_FLAG = '--help';

function main() {
  const verify = process.argv.indexOf(VERIFY_FLAG) > 0;
  verbose = process.argv.indexOf(VERBOSE_FLAG) > 0;
  const raw = process.argv.indexOf(RAW_FLAG) > 0;
  const help = process.argv.indexOf(HELP_FLAG) > 0;
  if (help) {
    printHelp();
  }

  let args = process.argv.slice(2).filter((_) => _ !== VERIFY_FLAG && _ !== RAW_FLAG);

  if (!raw) {
    loadConfig();

    if (verify) {
      args = ["-Werror", "--dry-run", "--verbose", ...args];
    } else {
      args = ["-Werror", "-i", ...args];
    }
    if (style) {
      args = [style, ...args];
    }
  }

  let errors: any[] = [];

  const handleError = (error?: any) => {
    if (error) {
      errors.push(error);
    }
  }

  // Run clang-format.
  try {
    // Pass all arguments to clang-format, including e.g. -version etc.
    if (raw) {
      spawnClangFormat(args, handleError, 'inherit');
    } else {
      spawnClangFormat(args, handleError, 'inherit');
    }
  } catch (e) {
    process.stdout.write((e as Error).message);
    process.exit(1);
  }

  if (errors.length > 0) {
    errors.forEach((error) => {
      console.log((error as Error).message);
    })
    process.exit(1);
  }
  if (!raw && verify) {
    queryNoOpenFiles();
  }
}

interface Config {
  includeEndsWith?: string[],
  excludePathContains?: string[],
  excludePathEndsWith?: string[],
  excludePathStartsWith?: string[],
  folder?: string,
  style?: string,
};

function verboseLog(s: string) {
  if (verbose) {
    console.log(s);
  }
}
function loadConfig() {
  const conf = path.resolve(__dirname, '../../../' + CONFIG_FILE);
  verboseLog("Looking for conf: " + conf);

  if (fs.existsSync(conf)) {
    verboseLog("Using conf file: " + conf);
    try {
      const jsonString = fs.readFileSync(conf, { encoding: 'utf8', flag: 'r' });
      let config: Config = JSON.parse(jsonString);
      includeEndsWith = config.includeEndsWith ?? includeEndsWith;
      excludePathContains = config.excludePathContains ?? excludePathContains;
      excludePathEndsWith = config.excludePathEndsWith ?? excludePathEndsWith;
      excludePathStartsWith = config.excludePathStartsWith ?? excludePathStartsWith;
      folder = config.folder ?? folder;
      style = config.style ?? style;
      if (!path.isAbsolute(folder)) {
        folder = path.resolve(__dirname, '../../..', folder);
      }
    }
    catch (e) {
      console.log("Fail to parse conf file");
      console.log((e as Error).message);
      process.exit(1);
    }
  }
  else {
    verboseLog("No config file is detected, use default setting");
  }

  verboseLog('  "includeEndsWith": ' + JSON.stringify(includeEndsWith));
  verboseLog('  "excludePathContains": ' + JSON.stringify(excludePathContains));
  verboseLog('  "excludePathEndsWith": ' + JSON.stringify(excludePathEndsWith));
  verboseLog('  "excludePathStartsWith": ' + JSON.stringify(excludePathStartsWith));
  verboseLog('  "folder": ' + folder);
  verboseLog('  "style:' + JSON.stringify(style))
}

function queryNoOpenFiles() {
  const opened = execSync('git status -s').toString();
  if (opened) {
    console.error('The following files have incorrect formatting or not committed:');
    console.error(opened);
    process.exit(2);
  }
}

function errorFromExitCode(exitCode: number) {
  return new Error(`clang-format exited with exit code ${exitCode}.`);
}

function git(args: string[], options: SpawnSyncOptions) {
  verboseLog("git: " + JSON.stringify(args) + "  " + JSON.stringify(options))
  const results = spawnSync('git', args, options);

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
  const results = git(['ls-tree', '-r', '--name-only', '--full-tree', 'HEAD'], {
    cwd,
  });

  if (results.success) {
    return results.stdout.split('\n');
  }

  return [];
}

/**
 * Spawn the clang-format binary with given arguments.
 */
function spawnClangFormat(
  args: string[],
  done: (any?: any) => void,
  stdio: StdioOptions,
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

  let files = listAllTrackedFiles(folder);

  // Apply file filters from constants
  files = files.filter(
    (file) =>
      includeEndsWith.some((_) => file.endsWith(_)) &&
      !excludePathContains.some((_) => file.indexOf(_) > 0) &&
      !excludePathEndsWith.some((_) => file.endsWith(_)) &&
      !excludePathStartsWith.some((_) => file.startsWith(_)) ,
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
          cwd: folder,
          stdio: stdio,
        });
        clangFormatProcess.on('close', (exit) => {
          if (exit !== 0) {
            callback(errorFromExitCode(exit!));
          } else {
            callback();
          }
        });
      };
    }, (err: Error) => { if (err) { done(err) } }),
    (err) => {
      if (err) {
        done(err);
        return;
      }
      console.log('\n');
      console.log(
        `ran clang-format on ${files.length} ${files.length === 1 ? 'file' : 'files'
        }`,
      );
      done();
    },
  );
}

/**
 * Spawn the clang-format binary with given arguments.
 */
function spawnClangFormatRaw(
  args: string[],
  done: (any?: any) => void,
  stdio: StdioOptions,
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
    cwd: folder,
    stdio: stdio,
  });
  clangFormatProcess.on('close', (exit) => {
    if (exit !== 0) {
      errorFromExitCode(exit!);
    }
  }
  );
}

function printHelp() {
  console.log(
    `
clang-format-launcher is an clang-format wrapper.
It uses 'git ls-tree' to speed up the file lookup, then filters the files by the rule which is defined in clang.format.json.
Usage:
  npx clang-format-launcher [options] [other options]
    Options:
      -raw
      -verify 

  npx clang-format-launcher [other options]
    equal to 'npx clang-format --style=file -Werror -i [other options] [Files after filter]'

  npx clang-format-launcher -verify [other options]
    equal to 'npx clang-format --style=file -Werror --dry-run --verbose [other options] [Files after filter]'

  npx clang-format-launcher -raw [other options]
    equal to 'npx clang-format  [other options]

clang.format.json example:
{
  "includeEndsWith": [".h",".cpp"],
  "excludePathContains": ["/ios/", "/nodejs/", "/android/"],
  "excludePathEndsWith": [".g.h",".g.cpp"],  
  "excludePathStartsWith": [],
  "folder": "../..",
  "style": "--style=file"
}
    
`
  )
}

main();