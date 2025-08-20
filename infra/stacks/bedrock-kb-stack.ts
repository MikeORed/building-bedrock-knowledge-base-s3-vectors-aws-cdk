import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { S3ToS3VectorsKnowledgeBase } from "../constructs/s3-to-s3-vectors-knowledge-base";

/**
 * A minimal CDK stack that demonstrates how to create a complete Bedrock Knowledge Base
 * with S3 Vectors storage using a single, self-contained construct.
 *
 * This stack serves as a blog-friendly example showing:
 * - Simple instantiation with sensible defaults
 * - CloudFormation outputs for integration with other systems
 * - Clean separation between stack and construct concerns
 *
 * The heavy lifting is done by the S3ToS3VectorsKnowledgeBase construct,
 * which handles all the complexity of creating and configuring:
 * - S3 bucket for document ingestion
 * - IAM roles with least-privilege permissions
 * - S3 Vectors bucket and index
 * - Bedrock Knowledge Base and DataSource
 * - Cleanup finalizer for proper resource deletion
 */
export class BedrockKnowledgeBaseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create the Bedrock Knowledge Base with S3 Vectors storage
    // Using construct defaults for simplicity - perfect for getting started
    const knowledgeBase = new S3ToS3VectorsKnowledgeBase(this, "BedrockKB", {
      // All parameters are optional with sensible defaults:
      // inclusionPrefixes: ["docs/"] - only process files in docs/ folder
      // vectorDimension: 1024 - matches Titan Embed Text v2 model
      // useFoundationParsing: false - uses native pipeline (lower cost)
      // Uncomment to customize behavior:
      // inclusionPrefixes: ["documents/", "manuals/"],
      // useFoundationParsing: true, // Enable custom parsing with Claude
      // parsingPromptText: "Extract key information from this document...",
    });

    // Export CloudFormation outputs for easy integration
    // These outputs can be referenced by other stacks or used in CI/CD pipelines
    new cdk.CfnOutput(this, "KnowledgeBaseId", {
      value: knowledgeBase.knowledgeBaseId,
      description:
        "The ID of the created Knowledge Base - use this for queries",
      exportName: `${this.stackName}-KnowledgeBaseId`,
    });

    new cdk.CfnOutput(this, "KnowledgeBaseArn", {
      value: knowledgeBase.knowledgeBaseArn,
      description: "The ARN of the created Knowledge Base",
      exportName: `${this.stackName}-KnowledgeBaseArn`,
    });

    new cdk.CfnOutput(this, "IngestionBucketName", {
      value: knowledgeBase.ingestionBucket.bucketName,
      description:
        "The name of the S3 bucket for document ingestion - upload your docs here",
      exportName: `${this.stackName}-IngestionBucketName`,
    });

    new cdk.CfnOutput(this, "KnowledgeBaseRoleArn", {
      value: knowledgeBase.knowledgeBaseRole.roleArn,
      description: "The ARN of the Knowledge Base service role",
      exportName: `${this.stackName}-KnowledgeBaseRoleArn`,
    });

    new cdk.CfnOutput(this, "VectorBucketName", {
      value: knowledgeBase.vectorBucketName,
      description: "The name of the S3 Vectors bucket (managed by AWS)",
      exportName: `${this.stackName}-VectorBucketName`,
    });

    new cdk.CfnOutput(this, "VectorIndexName", {
      value: knowledgeBase.vectorIndexName,
      description: "The name of the S3 Vectors index",
      exportName: `${this.stackName}-VectorIndexName`,
    });
  }
}
