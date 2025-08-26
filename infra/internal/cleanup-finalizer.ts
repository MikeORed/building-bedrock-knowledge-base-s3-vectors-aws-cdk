import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { createBedrockCleanupPolicy } from "../util/iam";

/**
 * Deletion behavior options
 */
export type DeletionBehavior = "DELETE" | "RETAIN";

/**
 * Properties for CleanupFinalizer construct
 */
export interface CleanupFinalizerProps {
  /** Knowledge Base ID to clean up */
  readonly knowledgeBaseId: string;
  /** Data source name prefix for matching */
  readonly dataSourceNamePrefix: string;
  /** Deletion behavior - DELETE (default) or RETAIN */
  readonly deletionBehavior?: DeletionBehavior;
  /** Polling interval in seconds (default: 5) */
  readonly pollSeconds?: number;
  /** Maximum cleanup time in minutes (default: 15) */
  readonly maxMinutes?: number;
}

/**
 * Internal construct that wraps Lambda-based cleanup finalizer
 * Handles proper resource deletion order for Bedrock Knowledge Base resources
 */
export class CleanupFinalizer extends Construct {
  public readonly cleanupFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: CleanupFinalizerProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    const deletionBehavior = props.deletionBehavior ?? "DELETE";

    const logGroup = new logs.LogGroup(this, "CleanupFnLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.cleanupFunction = new NodejsFunction(this, "CleanupFunction", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: "src/lambda/cleanup-handler.ts",
      handler: "handler",
      logGroup: logGroup,
      timeout: cdk.Duration.minutes(props.maxMinutes ?? 15),
      memorySize: 256,
      description:
        "Cleanup finalizer for Bedrock Knowledge Base and DataSource",
      bundling: {},
    });

    // Grant cleanup function permissions
    this.cleanupFunction.addToRolePolicy(createBedrockCleanupPolicy());

    // Only create the finalizer custom resource if deletion behavior is DELETE
    if (deletionBehavior === "DELETE") {
      // Create custom resource that invokes cleanup Lambda on DELETE
      new AwsCustomResource(this, "FinalizerResource", {
        onCreate: {
          service: "lambda",
          action: "invoke",
          parameters: {
            FunctionName: this.cleanupFunction.functionName,
            InvocationType: "Event",
            Payload: JSON.stringify({ noop: true }),
          },
          physicalResourceId: PhysicalResourceId.of(
            `finalizer-${cdk.Names.uniqueId(this).slice(-12)}`
          ),
        },
        onDelete: {
          service: "lambda",
          action: "invoke",
          parameters: {
            FunctionName: this.cleanupFunction.functionName,
            InvocationType: "RequestResponse", // Synchronous
            Payload: stack.toJsonString({
              region: stack.region,
              knowledgeBaseId: props.knowledgeBaseId,
              dataSourceNamePrefix: props.dataSourceNamePrefix,
              pollSeconds: props.pollSeconds ?? 5,
              maxMinutes: props.maxMinutes ?? 15,
            }),
          },
        },
        policy: AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            sid: "InvokeCleanupLambda",
            effect: iam.Effect.ALLOW,
            actions: ["lambda:InvokeFunction"],
            resources: [this.cleanupFunction.functionArn],
          }),
        ]),
        timeout: cdk.Duration.minutes((props.maxMinutes ?? 15) + 1), // Slightly longer than Lambda timeout
      });
    } else {
      // RETAIN behavior - document that resources will be left behind
      new cdk.CfnOutput(this, "RetainedResourcesWarning", {
        value: `Deletion behavior set to RETAIN. Knowledge Base ${props.knowledgeBaseId} and associated resources will not be automatically cleaned up.`,
        description: "Warning about retained resources",
      });
    }
  }
}
