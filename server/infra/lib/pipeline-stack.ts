import { Stack, type StackProps } from "aws-cdk-lib";
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
  /**
   * CodeStar/CodeConnections connection ARN for the GitHub source. Created
   * once in the console (Developer Tools → Connections) and authorized to the
   * repo. Used instead of an OAuth token because CloudFormation does NOT
   * support an SSM-secure reference for the pipeline source token.
   */
  githubConnectionArn: string;
  /** SSM SecureString parameter name holding a GitHub token (repo scope) for the release tag push. */
  githubTokenSecret: string;
  /** SSM SecureString parameter name holding the VS Code Marketplace PAT (`vsce publish`). */
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
 * Deploy ONCE by hand (`cdk deploy RrequestPipelineStack`); thereafter it
 * maintains itself. Requires a GitHub CodeStar connection (source) + two SSM
 * SecureString parameters (release git token, VSCE PAT), all created by the
 * operator — see the CI/CD section of server/README.md.
 */
export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    // GitHub source via a CodeStar connection (no token in the template —
    // CloudFormation doesn't allow an ssm-secure ref for the source token).
    const source = CodePipelineSource.connection(props.githubRepo, props.branch, {
      connectionArn: props.githubConnectionArn,
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
    // step does a fresh authenticated clone. Tokens are fetched in-script from
    // SSM Parameter Store (SecureString) via the granted ssm:GetParameter, not
    // baked into the CodeBuild env config.
    const paramArn = (name: string) =>
      Stack.of(this).formatArn({ service: "ssm", resource: "parameter", resourceName: name.replace(/^\//, "") });
    const release = new CodeBuildStep("ReleaseExtension", {
      input: source,
      commands: [
        `export GITHUB_TOKEN=$(aws ssm get-parameter --name ${props.githubTokenSecret} --with-decryption --query Parameter.Value --output text)`,
        `export VSCE_PAT=$(aws ssm get-parameter --name ${props.vscePatSecret} --with-decryption --query Parameter.Value --output text)`,
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
        new PolicyStatement({
          actions: ["ssm:GetParameter"],
          resources: [paramArn(props.githubTokenSecret), paramArn(props.vscePatSecret)],
        }),
        new PolicyStatement({
          actions: ["kms:Decrypt"],
          resources: ["*"],
          conditions: { StringEquals: { "kms:ViaService": `ssm.${Stack.of(this).region}.amazonaws.com` } },
        }),
      ],
    });

    deploy.addPost(release);
  }
}
