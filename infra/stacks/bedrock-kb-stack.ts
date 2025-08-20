import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { S3ToS3VectorsKnowledgeBase } from "../constructs/s3-to-s3-vectors-knowledge-base";

export class BedrockKnowledgeBaseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create the Bedrock Knowledge Base with S3 Vectors storage
    const knowledgeBase = new S3ToS3VectorsKnowledgeBase(this, "BedrockKB", {
      // Use defaults for a simple setup
      // inclusionPrefixes: ["docs/"], // default
      // vectorDimension: 1024, // default (Titan v2)
      // useFoundationParsing: false, // default (uses native pipeline)
    });

    // Export CloudFormation outputs for easy access
    new cdk.CfnOutput(this, "KnowledgeBaseId", {
      value: knowledgeBase.knowledgeBaseId,
      description: "The ID of the created Knowledge Base",
    });

    new cdk.CfnOutput(this, "KnowledgeBaseArn", {
      value: knowledgeBase.knowledgeBaseArn,
      description: "The ARN of the created Knowledge Base",
    });

    new cdk.CfnOutput(this, "IngestionBucketName", {
      value: knowledgeBase.ingestionBucket.bucketName,
      description: "The name of the S3 bucket for document ingestion",
    });

    new cdk.CfnOutput(this, "KnowledgeBaseRoleArn", {
      value: knowledgeBase.knowledgeBaseRole.roleArn,
      description: "The ARN of the Knowledge Base service role",
    });
  }
}
