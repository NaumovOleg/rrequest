import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Construct } from "constructs";
import { apiFunction, type ApiFunctionConfig, type DataSecrets, type DataTables } from "./functions";

export type ApiStackProps = StackProps & {
  tables: DataTables;
  secrets: DataSecrets;
  config: ApiFunctionConfig;
};

export class ApiStack extends Stack {
  public readonly httpApi: HttpApi;
  public readonly apiFn: NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    this.apiFn = apiFunction(this, { tables: props.tables, secrets: props.secrets, config: props.config });

    this.httpApi = new HttpApi(this, "RestmanHttpApi", {
      apiName: "restman-sync-api",
    });

    const integration = new HttpLambdaIntegration("ApiIntegration", this.apiFn);

    // Helios's own router dispatches by method/path inside the Lambda, so
    // API Gateway just needs to forward everything through one catch-all
    // proxy route.
    this.httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [HttpMethod.ANY],
      integration,
    });

    new CfnOutput(this, "ApiUrl", {
      value: this.httpApi.apiEndpoint,
      description: "Base URL of the restman sync HTTP API",
    });
  }
}
