// Single source of local env for the whole repo. Every folder (extension build,
// server/infra deploy) loads THIS file instead of keeping its own .env.
//
// - Reads a root env file into process.env, WITHOUT overriding anything already
//   set (so CI / an explicit `export` always wins over the file).
// - Which file: process.env.ENV_FILE, else ".env". So `ENV_FILE=.env.prod ...`
//   loads production values for a local prod build/deploy.
// - Root is resolved from this file's location, so it works regardless of the
//   caller's cwd.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

module.exports = function loadRootEnv() {
  const file = process.env.ENV_FILE || ".env";
  const full = path.join(ROOT, file);
  try {
    const txt = fs.readFileSync(full, "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no env file — fine, callers fall back to their own defaults */
  }
  return { root: ROOT, file: full };
};
