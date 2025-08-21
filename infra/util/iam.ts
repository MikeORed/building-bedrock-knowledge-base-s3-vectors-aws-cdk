import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";

/**
 * Create S3 bucket policy statements for Knowledge Base access
 * @param bucket The S3 bucket
 * @param prefixes Array of prefixes to allow access to
 * @returns Array of IAM policy statements
 */
export function createS3BucketPolicy(
  bucket: s3.IBucket,
  prefixes: string[]
): iam.PolicyStatement[] {
  const s3ObjectResources = prefixes.flatMap((prefix) => [
    bucket.arnForObjects(`${prefix}*`),
  ]);

  return [
    // ListBucket permission on bucket ARN only
    new iam.PolicyStatement({
      sid: "S3ListBucket",
      effect: iam.Effect.ALLOW,
      actions: ["s3:ListBucket", "s3:ListBucketVersions"],
      resources: [bucket.bucketArn],
    }),
    // GetObject permission on object ARNs only
    new iam.PolicyStatement({
      sid: "S3GetObject",
      effect: iam.Effect.ALLOW,
      actions: ["s3:GetObject", "s3:GetObjectVersion"],
      resources: s3ObjectResources,
    }),
  ];
}

/**
 * Create Bedrock model invocation policy statement
 * @param modelArns Array of model ARNs to allow access to
 * @returns IAM policy statement
 */
export function createBedrockInvokePolicy(
  modelArns: string[]
): iam.PolicyStatement {
  return new iam.PolicyStatement({
    sid: "BedrockModelAccess",
    effect: iam.Effect.ALLOW,
    actions: ["bedrock:InvokeModel"],
    resources: modelArns,
  });
}

/**
 * Create S3 Vectors data-plane policy statement
 * @param indexArn Optional specific index ARN (preferred when available)
 * @returns IAM policy statement
 */
export function createS3VectorsDataPlanePolicy(
  indexArn?: string
): iam.PolicyStatement {
  const s3VectorsDataPlaneActions = [
    "s3vectors:PutVectors",
    "s3vectors:GetVectors",
    "s3vectors:ListVectors",
    "s3vectors:QueryVectors",
    "s3vectors:DeleteVectors",
  ];

  // TODO: Use resource-scoped permissions when S3 Vectors GA supports them
  // For now, S3 Vectors data-plane operations require resources: ['*']
  const resources = indexArn ? [indexArn] : ["*"];

  return new iam.PolicyStatement({
    sid: "S3VectorsDataPlane",
    effect: iam.Effect.ALLOW,
    actions: s3VectorsDataPlaneActions,
    resources: resources,
  });
}

/**
 * Create S3 Vectors control-plane policy statement
 * @returns IAM policy statement for control-plane operations
 */
export function createS3VectorsControlPlanePolicy(): iam.PolicyStatement {
  return new iam.PolicyStatement({
    sid: "S3VectorsControlPlane",
    effect: iam.Effect.ALLOW,
    actions: [
      "s3vectors:CreateVectorBucket",
      "s3vectors:GetVectorBucket",
      "s3vectors:DeleteVectorBucket",
      "s3vectors:CreateIndex",
      "s3vectors:GetIndex",
      "s3vectors:DeleteIndex",
      "s3vectors:ListIndexes",
    ],
    resources: ["*"],
  });
}

/**
 * Create CloudWatch Logs policy statement
 * @param region AWS region
 * @param account AWS account ID
 * @returns IAM policy statement
 */
export function createCloudWatchLogsPolicy(
  region: string,
  account: string
): iam.PolicyStatement {
  return new iam.PolicyStatement({
    sid: "CloudWatchLogs",
    effect: iam.Effect.ALLOW,
    actions: [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
    ],
    resources: [
      `arn:aws:logs:${region}:${account}:log-group:/aws/bedrock/*`,
      `arn:aws:logs:${region}:${account}:log-group:/aws/bedrock/*:*`,
    ],
  });
}

/**
 * Create Bedrock Knowledge Base management policy statement
 * @returns IAM policy statement
 */
export function createBedrockKnowledgeBasePolicy(): iam.PolicyStatement {
  return new iam.PolicyStatement({
    sid: "BedrockKnowledgeBaseManagement",
    effect: iam.Effect.ALLOW,
    actions: [
      "bedrock:CreateKnowledgeBase",
      "bedrock:GetKnowledgeBase",
      "bedrock:DeleteKnowledgeBase",
      "bedrock:UpdateKnowledgeBase",
    ],
    resources: ["*"],
  });
}

/**
 * Create Bedrock cleanup permissions policy statement
 * @returns IAM policy statement for cleanup operations
 */
export function createBedrockCleanupPolicy(): iam.PolicyStatement {
  return new iam.PolicyStatement({
    sid: "BedrockCleanupPermissions",
    effect: iam.Effect.ALLOW,
    actions: [
      "bedrock:ListDataSources",
      "bedrock:GetDataSource",
      "bedrock:DeleteDataSource",
      "bedrock:ListIngestionJobs",
      "bedrock:GetIngestionJob",
      "bedrock:GetKnowledgeBase",
      "bedrock:DeleteKnowledgeBase",
    ],
    resources: ["*"],
  });
}
