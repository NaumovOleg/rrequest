import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import type { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Construct } from "constructs";
import { pollFunction, type ApiFunctionConfig, type DataSecrets, type DataTables } from "./functions";

export type SchedulerStackProps = StackProps & {
  tables: DataTables;
  secrets: DataSecrets;
  config: ApiFunctionConfig;
};

export class SchedulerStack extends Stack {
  public readonly rule: Rule;
  public readonly pollFn: NodejsFunction;

  constructor(scope: Construct, id: string, props: SchedulerStackProps) {
    super(scope, id, props);

    this.pollFn = pollFunction(this, { tables: props.tables, secrets: props.secrets, config: props.config });

    this.rule = new Rule(this, "PollRule", {
      schedule: Schedule.rate(Duration.minutes(1)),
      description: "Sweeps synced workspaces for outside-Drive-edit revision bumps",
    });
    this.rule.addTarget(new LambdaFunction(this.pollFn));
  }
}
