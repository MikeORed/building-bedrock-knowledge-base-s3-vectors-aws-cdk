import * as cdk from "aws-cdk-lib";

/**
 * Interface for all deterministic names used by the construct
 */
export interface NameSet {
  readonly knowledgeBaseName: string;
  readonly dataSourceName: string;
  readonly vectorBucketName: string;
  readonly vectorIndexName: string;
  readonly bucketName: string;
  readonly roleName: string;
}

/**
 * Properties that can override default names
 */
export interface NameOverrides {
  readonly knowledgeBaseName?: string;
  readonly dataSourceName?: string;
  readonly vectorBucketName?: string;
  readonly vectorIndexName?: string;
}

/**
 * Generate deterministic names based on stack ID to avoid collisions
 * @param stack The CDK stack
 * @param overrides Optional name overrides
 * @returns Complete set of deterministic names
 */
export function deterministicNames(
  stack: cdk.Stack,
  overrides?: NameOverrides
): NameSet {
  // Extract short suffix from stack ID for collision-proof naming
  // Clean the suffix to ensure S3 bucket name compliance (lowercase, alphanumeric, hyphens only)
  const rawSuffix = stack.stackId.split("/").pop()?.slice(-8) ?? "default";
  const suffix =
    rawSuffix
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 8) || "default";

  // Include account and region for S3 bucket uniqueness
  const account = stack.account;
  const region = stack.region;

  return {
    knowledgeBaseName: overrides?.knowledgeBaseName ?? `kb-s3vectors-${suffix}`,
    dataSourceName: overrides?.dataSourceName ?? `ds-s3-${suffix}`,
    vectorBucketName: overrides?.vectorBucketName ?? `s3vectors-${suffix}`,
    vectorIndexName: overrides?.vectorIndexName ?? `index-${suffix}`,
    bucketName: `bedrock-kb-ingestion-${region}-${account}-${suffix}`,
    roleName: `BedrockKB-Role-${suffix}`,
  };
}
