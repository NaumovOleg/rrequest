const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");
const watch = process.argv.includes("--watch");

// Load a local .env (git-ignored) so SYNC_SERVER_URL can be set for a dev build
// without exporting it. In CI it's set in the environment directly (from a
// GitHub environment variable), which takes precedence over the .env file.
function loadDotenv() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (m && !(m[1] in process.env))
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env file — fine, fall back to the prod URL below */
  }
}
loadDotenv();

// The sync backend URL baked into the build. Set SYNC_SERVER_URL (CI env var or
// local .env) to point a build at dev/prod; unset falls back to prod. The
// extension still lets a user override it via the `rrequest.syncServerUrl`
// setting at runtime.
const PROD_SYNC_URL =
  "https://slgvpoiwdpzymrlg6iu4zbowea0yneyw.lambda-url.eu-west-1.on.aws/api";
const SYNC_URL = process.env.SYNC_SERVER_URL || PROD_SYNC_URL;

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
    "@grpc/grpc-js",
    "@grpc/proto-loader",
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
