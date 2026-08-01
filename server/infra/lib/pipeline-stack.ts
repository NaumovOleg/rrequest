import { SecretValue, Stack, type StackProps } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { CodeBuildStep, CodePipeline, CodePipelineSource, ShellStep } from "aws-cdk-lib/pipelines";
import type { Construct } from "constructs";
import { RrequestStage } from "./rrequest-stage";
import type { ApiFunctionConfig } from "./functions";

export type PipelineStackProps = StackProps & {
  /** "owner/repo" on GitHub, e.g. "naumovoleg/rrequest". */
  githubRepo: string;
  /** Branch that triggers a deploy + release. */
  branch: string;
  /** Secrets Manager secret holding a GitHub token (repo + workflow scope) for the source + release tag push. */
  githubTokenSecret: string;
  /** Secrets Manager secret holding the VS Code Marketplace PAT (`vsce publish`). */
  vscePatSecret: string;
  /** Backend runtime config baked into the deployed Lambdas. */
  config: ApiFunctionConfig;
};

/**
 * Self-mutating CI/CD pipeline (AWS CodePipeline via CDK Pipelines). On every
 * push to `branch` it:
 *   1. re-synths the CDK app and updates ITSELF if the pipeline definition
 *      changed (selfMutation),
 *   2. deploys the backend (`RrequestStage` → `RrequestStack`),
 *   3. bumps the extension version from Conventional Commits, packages the
 *      .vsix, publishes to the VS Code Marketplace, and pushes a git tag.
 *
 * Deploy ONCE by hand (`cdk --app 'npx tsx bin/pipeline.ts' deploy
 * RrequestPipelineStack`); thereafter it maintains itself. Requires two
 * Secrets Manager secrets (GitHub token, VSCE PAT) created by the operator —
 * see the CI/CD section of server/README.md.
 */
export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const source = CodePipelineSource.gitHub(props.githubRepo, props.branch, {
      authentication: SecretValue.secretsManager(props.githubTokenSecret),
    });

    // The CDK app lives in server/infra (it resolves aws-cdk-lib etc. from
    // server/node_modules — no separate lockfile), so install at server level
    // then synth from infra. esbuild is installed for NodejsFunction bundling.
    const synth = new ShellStep("Synth", {
      input: source,
      commands: [
        "cd server && npm ci && npm i --no-save esbuild",
        "cd infra && npx cdk synth",
      ],
      primaryOutputDirectory: "server/infra/cdk.out",
    });

    const pipeline = new CodePipeline(this, "Pipeline", {
      pipelineName: "rrequest-pipeline",
      selfMutation: true,
      synth,
    });

    const stage = new RrequestStage(this, "Prod", { env: props.env, config: props.config });
    const deploy = pipeline.addStage(stage);

    // After the backend deploys: bump the extension version from Conventional
    // Commits, package + publish to the Marketplace, push a git tag. A tag push
    // (not a branch commit) does NOT re-trigger the branch source, so no loop.
    //
    // CodePipeline's GitHub source is a code ZIP with no .git history, and
    // conventional-recommended-bump + tagging both need real history, so this
    // step does a fresh authenticated clone. Secrets are fetched in-script (not
    // baked into the CodeBuild env config) via the granted GetSecretValue.
    const release = new CodeBuildStep("ReleaseExtension", {
      input: source,
      commands: [
        `export GITHUB_TOKEN=$(aws secretsmanager get-secret-value --secret-id ${props.githubTokenSecret} --query SecretString --output text)`,
        `export VSCE_PAT=$(aws secretsmanager get-secret-value --secret-id ${props.vscePatSecret} --query SecretString --output text)`,
        `git clone --quiet "https://x-access-token:$GITHUB_TOKEN@github.com/${props.githubRepo}.git" repo`,
        `cd repo && git checkout ${props.branch}`,
        "git config user.email ci@rrequest.dev && git config user.name 'rrequest ci'",
        // semver bump from Conventional Commits since the last tag (default patch).
        "BUMP=$(npx --yes conventional-recommended-bump -p angular 2>/dev/null || echo patch)",
        'echo "conventional bump: $BUMP"',
        "npm ci && npm run build",
        // vsce bumps package.json to the new version, packages, and publishes.
        'npx --yes @vscode/vsce publish "$BUMP" -p "$VSCE_PAT" --no-git-tag-version',
        // Persist the version as a git tag (tag push does not re-trigger the branch pipeline).
        'NEW=$(node -p "require(\'./package.json\').version")',
        'git tag "v$NEW" && git push origin "v$NEW"',
      ],
      rolePolicyStatements: [
        new PolicyStatement({ actions: ["secretsmanager:GetSecretValue"], resources: ["*"] }),
      ],
    });

    deploy.addPost(release);
  }
}
