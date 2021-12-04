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
let folder = path.resolve(__dirname, '../..');

const VERIFY_FLAG = '-verify';
const CONFIG_FILE = 'clang.format.json'

function main() {
  const verify = process.argv.indexOf(VERIFY_FLAG) > 0;
  const args = process.argv.slice(2).filter((_) => _ !== VERIFY_FLAG);

  loadConfig();
  // Run clang-format.
  try {
    // Pass all arguments to clang-format, including e.g. -version etc.
    spawnClangFormat(args, verify ? queryNoOpenFiles : process.exit, 'inherit');
  } catch (e) {
    process.stdout.write((e as Error).message);
    process.exit(1);
  }
}

interface Config {
  includeEndsWith?: string[],
  excludePathContains?: string[],
  excludePathEndsWith?: string[],
  folder?: string,
};

function loadConfig() {
  const conf = path.resolve(__dirname, '../../' + CONFIG_FILE);
  console.log("Looking for conf: " + conf);

  if (fs.existsSync(conf)) {
    console.log("Using conf file: " + conf);
    try {
      const jsonString = fs.readFileSync(conf, { encoding: 'utf8', flag: 'r' });
      let config: Config = JSON.parse(jsonString);
      includeEndsWith = config.includeEndsWith ?? includeEndsWith;
      excludePathContains = config.excludePathContains ?? excludePathContains;
      excludePathEndsWith = config.excludePathEndsWith ?? excludePathEndsWith;
      folder = config.folder ?? folder;
      if (!path.isAbsolute(folder)) {
        folder = path.resolve(__dirname, '../..', folder);
      }
    }
    catch (e) {
      console.log("Fail to parse conf file");
      console.log((e as Error).message);
      process.exit(1);
    }
  }
  else {
    console.log("No config file is detected, use default setting");
  }

  console.log('  "includeEndsWith": ' + JSON.stringify(includeEndsWith));
  console.log('  "excludePathContains": ' + JSON.stringify(excludePathContains));
  console.log('  "excludePathEndsWith": ' + JSON.stringify(excludePathEndsWith));
  console.log('  "folder": ' + folder);
}

function queryNoOpenFiles() {
  const opened = execSync('git status -s').toString();
  if (opened) {
    console.error('The following files have incorrect formatting:');
    console.error(opened);
    console.error('Running `format` from the repo root should fix this.');
    process.exit(2);
  }
}

function errorFromExitCode(exitCode: number) {
  return new Error(`clang-format exited with exit code ${exitCode}.`);
}

function git(args: string[], options: SpawnSyncOptions) {
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
      !excludePathEndsWith.some((_) => file.endsWith(_)),
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
    }),
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

main();