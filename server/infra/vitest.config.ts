import { defineConfig } from "vitest/config";

// Isolated from the root `server` vitest config (which only picks up
// `src/**/*.test.ts`) so the CDK synth test runs as its own suite:
// `cd server/infra && npx vitest run`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // NodejsFunction bundling shells out to esbuild via child_process.
    // Vitest's default "threads" pool runs tests in worker threads, whose
    // stdio streams aren't valid targets for that spawn -- run tests in
    // child processes instead ("forks") so `cdk synth`-style bundling works.
    pool: "forks",
    testTimeout: 30000,
  },
});
