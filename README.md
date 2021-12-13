# clang-format-launcher

clang-format-launcher is a clang-format wrapper which is used to launch the clang-format with predefined rules.
This tool is designed for complex project, which `glob` pattern is not enough.

It provides features:

1. Complex filter rule: `includeEndsWith`, `excludePathContains`, `excludePathEndsWith`, `excludePathStartsWith` and `style`.
2. Simple command line. `npx clang-format-launcher -verify ` to verify the format, and `npx clang-format-launcher` to auto fix the format. It's easy to be used in the pipeline
3. Only source code is formatted. It automatically skipped buid output and node_modules which are not checked in to the repo.

Here is the idea:

1. It first runs `git ls-tree` to get the file list which is checked in.
2. Apply `includeEndsWith`, `excludePathContains`, `excludePathEndsWith`, `excludePathStartsWith` to filter the files.
3. Do clang-format check or format based on the existence of `-verify` flag.

# How to use it

## Step 1

- use clang-format npmjs binary:

```
npm i --save-dev clang-format clang-format-launcher
```

- use your own clang-format binary:

```
npm i --save-dev clang-format-launcher
```

then in your config, set clangFormatBinPath

```
"clangFormatBinPath" : "clang-format"
```

or

```
"clangFormatBinPath" : "${fullpath}/clang-format"
```

## Step 2 prepare clang.format.json or package.json

put clang.format.json or package.json in the `current` folder.

clang.format.json example:

```
{
  "includeEndsWith": [".h",".cpp"],
  "excludePathContains": ["/ios/", "/nodejs/", "/android/"],
  "excludePathEndsWith": [".g.h",".g.cpp"],
  "excludePathStartsWith": [],
  "style": "--style=file"
}
```

package.json example:

```
{
  "clang-format-launcher": {
    "includeEndsWith": [".h",".cpp"],
    "excludePathContains": ["/ios/", "/nodejs/", "/android/"],
    "excludePathEndsWith": [".g.h",".g.cpp"],
    "excludePathStartsWith": [],
    "style": "--style=file"
  }
}
```

# Usage

## Run scripts in package.json

`npm run format` and `npm run verify`

```
"scripts": {
...
"format": "clang-format-launcher --verbose",
"verify": "clang-format-launcher -verify --vebose"
},
```

`npm run format --verbose`

## Run with npx

`npx clang-format-launcher`

`npx clang-format-launcher -verify`

`npx clang-format-launcher --verbose`

## Command details

```
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
  "style": "--style=file",
  "clangFormatBinPath": ""
}

package.json example:
{
  "clang-format-launcher": {
    "includeEndsWith": [".h",".cpp"],
    "excludePathContains": ["/ios/", "/nodejs/", "/android/"],
    "excludePathEndsWith": [".g.h",".g.cpp"],
    "excludePathStartsWith": [],
    "style": "--style=file",
    "clangFormatBinPath": "clang-format"
  }
}

```
