#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { BedrockKnowledgeBaseStack } from "../infra/stacks/bedrock-kb-stack";

const app = new cdk.App();

new BedrockKnowledgeBaseStack(app, "BedrockKnowledgeBaseStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description:
    "Complete Bedrock Knowledge Base with S3 Bucket -> S3 Vectors storage",
  tags: {
    Project: "BedrockKnowledgeBase",
    Purpose: "Example",
    Service: "Bedrock",
  },
});
