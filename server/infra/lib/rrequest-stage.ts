import { Stage, type StageProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { RrequestStack, type RrequestStackProps } from "./rrequest-stack";

export type RrequestStageProps = StageProps & {
  config: RrequestStackProps["config"];
};

/**
 * A deployable unit of the app for CDK Pipelines: wraps the single
 * `RrequestStack`. The pipeline (`pipeline-stack.ts`) adds this stage so the
 * backend deploys automatically on every push to master.
 */
export class RrequestStage extends Stage {
  constructor(scope: Construct, id: string, props: RrequestStageProps) {
    super(scope, id, props);
    new RrequestStack(this, "RrequestStack", { config: props.config });
  }
}
