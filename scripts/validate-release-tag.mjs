#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import https from "node:https";

const UPDATER_FEED_URL =
  "https://github.com/aj4abinjacob/chikku_parser/releases/latest/download/latest.json";

const args = process.argv.slice(2);
const tagArg = args.find((arg) => !arg.startsWith("--"));
const skipClean = args.includes("--skip-clean");
const skipRemote = args.includes("--skip-remote");
const allowExistingTag = args.includes("--allow-existing-tag");

function fail(message) {
  console.error(`error: ${message}`);
  process.exitCode = 1;
}

function run(command, commandArgs) {
  return execFileSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  return match.slice(1).map((part) => Number(part));
}

function compareVersions(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function versionToString(version) {
  return version.join(".");
}

function cargoTomlVersion() {
  const text = readFileSync("src-tauri/Cargo.toml", "utf8");
  const match = /^\[package\][\s\S]*?^version = "([^"]+)"/m.exec(text);
  return match?.[1] ?? null;
}

function cargoLockVersion() {
  const text = readFileSync("src-tauri/Cargo.lock", "utf8");
  const blocks = text.split(/\n(?=\[\[package\]\])/);
  for (const block of blocks) {
    if (/^name = "chikku-parser"$/m.test(block)) {
      return /^version = "([^"]+)"$/m.exec(block)?.[1] ?? null;
    }
  }
  return null;
}

function remoteTagExists(tag) {
  const output = run("git", ["ls-remote", "--tags", "--refs", "origin", `refs/tags/${tag}`]);
  return output.length > 0;
}

function allKnownReleaseTags(includeRemote) {
  const local = run("git", ["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*"])
    .split("\n")
    .filter(Boolean);
  if (!includeRemote) return local;

  const remoteOutput = run("git", ["ls-remote", "--tags", "--refs", "origin", "v*"]);
  const remote = remoteOutput
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[1]?.replace("refs/tags/", ""))
    .filter(Boolean);
  return [...new Set([...local, ...remote])];
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "user-agent": "chikku-parser-release-validator",
          },
        },
        (response) => {
          const { statusCode, headers } = response;
          if (
            statusCode
            && statusCode >= 300
            && statusCode < 400
            && headers.location
          ) {
            response.resume();
            fetchJson(new URL(headers.location, url).toString()).then(resolve, reject);
            return;
          }

          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () => {
            if (!statusCode || statusCode < 200 || statusCode >= 300) {
              reject(new Error(`HTTP ${statusCode ?? "unknown"}`));
              return;
            }
            try {
              resolve(JSON.parse(body));
            } catch (error) {
              reject(error);
            }
          });
        },
      )
      .on("error", reject);
  });
}

if (!tagArg) {
  console.error(
    "usage: npm run release:check -- vX.Y.Z [--skip-clean] [--skip-remote] [--allow-existing-tag]",
  );
  process.exit(2);
}

const targetVersion = parseVersion(tagArg);
if (!targetVersion || !tagArg.startsWith("v")) {
  fail("tag must use the vX.Y.Z format");
  process.exit(1);
}

const targetVersionString = versionToString(targetVersion);
const expectedTag = `v${targetVersionString}`;
if (tagArg !== expectedTag) {
  fail(`tag must be normalized as ${expectedTag}`);
}

if (!skipClean) {
  const status = run("git", ["status", "--porcelain"]);
  if (status) {
    fail("working tree must be clean before creating the release tag");
  }
}

if (!allowExistingTag) {
  const localTag = run("git", ["tag", "--list", expectedTag]);
  if (localTag) {
    fail(`local tag ${expectedTag} already exists`);
  }

  if (!skipRemote && remoteTagExists(expectedTag)) {
    fail(`remote tag ${expectedTag} already exists on origin`);
  }
}

const versions = {
  "package.json": readJson("package.json").version,
  "package-lock.json": readJson("package-lock.json").version,
  "package-lock.json packages[\"\"]": readJson("package-lock.json").packages?.[""]?.version,
  "src-tauri/Cargo.toml": cargoTomlVersion(),
  "src-tauri/Cargo.lock": cargoLockVersion(),
  "src-tauri/tauri.conf.json": readJson("src-tauri/tauri.conf.json").version,
};

for (const [path, version] of Object.entries(versions)) {
  if (version !== targetVersionString) {
    fail(`${path} has version ${version ?? "(missing)"}, expected ${targetVersionString}`);
  }
}

const knownVersions = allKnownReleaseTags(!skipRemote)
  .filter((tag) => !allowExistingTag || tag !== expectedTag)
  .map((tag) => parseVersion(tag))
  .filter(Boolean);
const latestKnown = knownVersions.sort(compareVersions).at(-1);
if (latestKnown && compareVersions(targetVersion, latestKnown) <= 0) {
  fail(
    `${expectedTag} must be newer than the latest known git tag v${versionToString(latestKnown)}`,
  );
}

if (!skipRemote) {
  try {
    const feed = await fetchJson(UPDATER_FEED_URL);
    const feedVersion = parseVersion(feed.version);
    if (!feedVersion) {
      fail(`published updater feed has an invalid version: ${feed.version}`);
    } else if (compareVersions(targetVersion, feedVersion) <= 0) {
      fail(
        `${expectedTag} must be newer than the published updater feed v${versionToString(feedVersion)}`,
      );
    }
  } catch (error) {
    fail(`could not verify published updater feed: ${error.message}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`[ok] ${expectedTag} is ready to tag from the current commit.`);
