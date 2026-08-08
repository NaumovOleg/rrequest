const esbuild = require("esbuild");
const fs = require("node:fs");
const watch = process.argv.includes("--watch");

// Load the single root env file (git-ignored) so SYNC_SERVER_URL can be set for
// a dev build without exporting it. CI sets it in the environment directly,
// which wins over the file. `ENV_FILE=.env.prod` selects prod values.
require("./scripts/load-root-env.cjs")();

// The sync backend URL baked into the build. Set SYNC_SERVER_URL (CI env var or
// local .env) only if a specific build must point at your own backend; unset
// leaves it empty and the user's `rrequest.syncServerUrl` setting is the only
// source. Nothing is baked by default, so each user brings their own backend.
const SYNC_URL = process.env.SYNC_SERVER_URL || "";

const options = {
  entryPoints: ["src/extension/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  external: [
    "vscode",
    "bufferutil",
    "utf-8-validate",
  ],
  outfile: "dist/extension.js",
  sourcemap: true,
  define: { "process.env.SYNC_SERVER_URL": JSON.stringify(SYNC_URL) },
};

function copyCodicons() {
  fs.mkdirSync("media", { recursive: true });
  const src = "node_modules/@vscode/codicons/dist";
  fs.copyFileSync(`${src}/codicon.css`, "media/codicon.css");
  fs.copyFileSync(`${src}/codicon.ttf`, "media/codicon.ttf");
}

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    copyCodicons();
    console.log("esbuild watching...");
  } else {
    await esbuild.build(options);
    copyCodicons();
    console.log(`esbuild done (sync url: ${SYNC_URL})`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
