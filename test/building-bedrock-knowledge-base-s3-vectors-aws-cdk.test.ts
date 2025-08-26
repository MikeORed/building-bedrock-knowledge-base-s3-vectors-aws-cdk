import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { BedrockKnowledgeBaseStack } from "../infra/stacks/bedrock-kb-stack";

describe("BedrockKnowledgeBaseStack", () => {
  let app: cdk.App;
  let stack: BedrockKnowledgeBaseStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new BedrockKnowledgeBaseStack(app, "TestStack", {
      env: { account: "123456789012", region: "us-east-1" },
    });
    template = Template.fromStack(stack);
  });

  describe("Resource Existence", () => {
    test("creates S3 ingestion bucket", () => {
      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: "AES256",
              },
            },
          ],
        },
        OwnershipControls: {
          Rules: [
            {
              ObjectOwnership: "BucketOwnerEnforced",
            },
          ],
        },
      });
    });

    test("creates Knowledge Base IAM role", () => {
      template.hasResourceProperties("AWS::IAM::Role", {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Action: "sts:AssumeRole",
              Effect: "Allow",
              Principal: {
                Service: "bedrock.amazonaws.com",
              },
            },
          ],
          Version: "2012-10-17",
        },
        Description: "Role for Bedrock Knowledge Base with S3 Vectors storage",
      });
    });

    test("creates S3 Vectors bucket custom resource", () => {
      template.hasResourceProperties("Custom::AWS", {
        Create: Match.stringLikeRegexp(".*createVectorBucket.*"),
        Delete: Match.stringLikeRegexp(".*deleteVectorBucket.*"),
      });
    });

    test("creates S3 Vectors index custom resource", () => {
      template.hasResourceProperties("Custom::AWS", {
        Create: Match.stringLikeRegexp(".*createIndex.*"),
        Delete: Match.stringLikeRegexp(".*deleteIndex.*"),
      });
    });

    test("creates Knowledge Base custom resource", () => {
      template.hasResourceProperties("Custom::AWS", {
        Create: Match.stringLikeRegexp(".*createKnowledgeBase.*"),
        Delete: Match.stringLikeRegexp(".*deleteKnowledgeBase.*"),
      });
    });

    test("creates Bedrock DataSource", () => {
      template.hasResourceProperties("AWS::Bedrock::DataSource", {
        DataSourceConfiguration: {
          Type: "S3",
          S3Configuration: {
            InclusionPrefixes: ["docs/"],
          },
        },
        VectorIngestionConfiguration: {
          ChunkingConfiguration: {
            ChunkingStrategy: "FIXED_SIZE",
            FixedSizeChunkingConfiguration: {
              MaxTokens: 1000,
              OverlapPercentage: 30,
            },
          },
        },
      });
    });

    test("creates cleanup Lambda function", () => {
      template.hasResourceProperties("AWS::Lambda::Function", {
        Runtime: "nodejs20.x",
        Timeout: 900,
        MemorySize: 256,
        Description:
          "Cleanup finalizer for Bedrock Knowledge Base and DataSource",
      });
    });

    test("creates cleanup finalizer custom resource", () => {
      template.hasResourceProperties("Custom::AWS", {
        Create: Match.stringLikeRegexp(".*Lambda.*invoke.*Event.*"),
        Delete: Match.stringLikeRegexp(".*Lambda.*invoke.*RequestResponse.*"),
      });
    });
  });

  describe("IAM Permissions", () => {
    test("Knowledge Base role has S3 permissions", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Sid: "S3ListBucket",
              Effect: "Allow",
              Action: ["s3:ListBucket", "s3:ListBucketVersions"],
            },
            {
              Sid: "S3GetObject",
              Effect: "Allow",
              Action: ["s3:GetObject", "s3:GetObjectVersion"],
            },
          ]),
        },
      });
    });

    test("Knowledge Base role has Bedrock model permissions", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: "BedrockModelAccess",
              Effect: "Allow",
              Action: ["bedrock:InvokeModel"],
              Resource: {
                "Fn::Join": Match.anyValue(), // Handle CloudFormation intrinsic function
              },
            }),
          ]),
        },
      });
    });

    test("Knowledge Base role has S3 Vectors permissions", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Sid: "S3VectorsDataPlane",
              Effect: "Allow",
              Action: [
                "s3vectors:PutVectors",
                "s3vectors:GetVectors",
                "s3vectors:ListVectors",
                "s3vectors:QueryVectors",
                "s3vectors:DeleteVectors",
              ],
              Resource: "*",
            },
          ]),
        },
      });
    });

    test("cleanup Lambda has Bedrock permissions", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Sid: "BedrockCleanupPermissions",
              Effect: "Allow",
              Action: [
                "bedrock:ListDataSources",
                "bedrock:GetDataSource",
                "bedrock:DeleteDataSource",
                "bedrock:ListIngestionJobs",
                "bedrock:GetIngestionJob",
                "bedrock:GetKnowledgeBase",
                "bedrock:DeleteKnowledgeBase",
              ],
              Resource: "*",
            },
          ]),
        },
      });
    });

    test("S3 Vectors custom resources have control plane permissions", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Sid: "S3VectorsControlPlane",
              Effect: "Allow",
              Action: [
                "s3vectors:CreateVectorBucket",
                "s3vectors:GetVectorBucket",
                "s3vectors:DeleteVectorBucket",
              ],
              Resource: "*",
            },
          ]),
        },
      });

      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Sid: "S3VectorsIndexControlPlane",
              Effect: "Allow",
              Action: [
                "s3vectors:CreateIndex",
                "s3vectors:GetIndex",
                "s3vectors:DeleteIndex",
                "s3vectors:ListIndexes",
              ],
              Resource: "*",
            },
          ]),
        },
      });
    });
  });

  describe("CloudFormation Outputs", () => {
    test("exports Knowledge Base ID", () => {
      template.hasOutput("KnowledgeBaseId", {
        Description:
          "The ID of the created Knowledge Base - use this for queries",
        Export: {
          Name: "TestStack-KnowledgeBaseId",
        },
      });
    });

    test("exports Knowledge Base ARN", () => {
      template.hasOutput("KnowledgeBaseArn", {
        Description: "The ARN of the created Knowledge Base",
        Export: {
          Name: "TestStack-KnowledgeBaseArn",
        },
      });
    });

    test("exports ingestion bucket name", () => {
      template.hasOutput("IngestionBucketName", {
        Description:
          "The name of the S3 bucket for document ingestion - upload your docs here",
        Export: {
          Name: "TestStack-IngestionBucketName",
        },
      });
    });

    test("exports Knowledge Base role ARN", () => {
      template.hasOutput("KnowledgeBaseRoleArn", {
        Description: "The ARN of the Knowledge Base service role",
        Export: {
          Name: "TestStack-KnowledgeBaseRoleArn",
        },
      });
    });

    test("exports vector bucket name", () => {
      template.hasOutput("VectorBucketName", {
        Description: "The name of the S3 Vectors bucket (managed by AWS)",
        Export: {
          Name: "TestStack-VectorBucketName",
        },
      });
    });

    test("exports vector index name", () => {
      template.hasOutput("VectorIndexName", {
        Description: "The name of the S3 Vectors index",
        Export: {
          Name: "TestStack-VectorIndexName",
        },
      });
    });
  });

  describe("Resource Dependencies", () => {
    test("has correct number of custom resources", () => {
      // Should have 4 custom resources:
      // 1. S3 Vectors bucket
      // 2. S3 Vectors index
      // 3. Knowledge Base
      // 4. Cleanup finalizer
      const customResources = template.findResources("Custom::AWS");
      expect(Object.keys(customResources)).toHaveLength(4);
    });

    test("has one DataSource", () => {
      const dataSources = template.findResources("AWS::Bedrock::DataSource");
      expect(Object.keys(dataSources)).toHaveLength(1);
    });

    test("has one cleanup Lambda function", () => {
      const lambdaFunctions = template.findResources("AWS::Lambda::Function", {
        Properties: {
          Description:
            "Cleanup finalizer for Bedrock Knowledge Base and DataSource",
        },
      });
      expect(Object.keys(lambdaFunctions)).toHaveLength(1);
    });

    test("cleanup finalizer depends on other resources", () => {
      const finalizerResources = template.findResources("Custom::AWS", {
        Properties: {
          Delete: Match.stringLikeRegexp(".*Lambda.*invoke.*RequestResponse.*"),
        },
      });

      const finalizerLogicalId = Object.keys(finalizerResources)[0];
      const finalizer = finalizerResources[finalizerLogicalId];

      // Cleanup finalizer should have dependencies to ensure proper deletion order
      expect(finalizer.DependsOn).toBeDefined();
      expect(Array.isArray(finalizer.DependsOn)).toBe(true);
      expect(finalizer.DependsOn.length).toBeGreaterThan(3); // Should depend on multiple resources
    });
  });

  describe("Security Configuration", () => {
    test("S3 bucket enforces SSL", () => {
      template.hasResourceProperties("AWS::S3::BucketPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            {
              Effect: "Deny",
              Condition: {
                Bool: {
                  "aws:SecureTransport": "false",
                },
              },
              Action: "s3:*",
            },
          ]),
        },
      });
    });

    test("S3 bucket has server-side encryption", () => {
      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: "AES256",
              },
            },
          ],
        },
      });
    });

    test("Lambda function has appropriate timeout", () => {
      template.hasResourceProperties("AWS::Lambda::Function", {
        Timeout: 900, // 15 minutes
        MemorySize: 256,
      });
    });
  });

  describe("Model Configuration", () => {
    test("uses correct embedding model", () => {
      // The Knowledge Base should be configured with Titan Embed Text v2
      template.hasResourceProperties("Custom::AWS", {
        Create: Match.stringLikeRegexp(".*amazon\\.titan-embed-text-v2:0.*"),
      });
    });

    test("uses correct vector dimensions", () => {
      // Should use 1024 dimensions for Titan v2
      template.hasResourceProperties("Custom::AWS", {
        Create: Match.stringLikeRegexp('.*"dimension":1024.*'),
      });
    });

    test("uses cosine distance metric", () => {
      template.hasResourceProperties("Custom::AWS", {
        Create: Match.stringLikeRegexp('.*"distanceMetric":"cosine".*'),
      });
    });
  });
});
