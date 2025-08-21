import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
  PhysicalResourceIdReference,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { createBedrockKnowledgeBasePolicy } from "../util/iam";

/**
 * Properties for BedrockKnowledgeBase construct
 */
export interface BedrockKnowledgeBaseProps {
  /** Name of the Knowledge Base */
  readonly name: string;
  /** IAM role for the Knowledge Base */
  readonly role: iam.IRole;
  /** S3 Vectors bucket ARN */
  readonly vectorBucketArn: string;
  /** S3 Vectors index ARN */
  readonly indexArn: string;
  /** Embedding model ARN */
  readonly embeddingModelArn: string;
  /** Vector dimension */
  readonly vectorDimension: number;
}

/**
 * Internal construct that wraps Bedrock Knowledge Base creation/deletion
 * Uses AWS SDK v3 service names and removes unnecessary installLatestAwsSdk
 */
export class BedrockKnowledgeBase extends Construct {
  public readonly knowledgeBaseId: string;
  public readonly knowledgeBaseArn: string;
  private readonly customResource: AwsCustomResource;

  constructor(scope: Construct, id: string, props: BedrockKnowledgeBaseProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    this.customResource = new AwsCustomResource(this, "Resource", {
      onCreate: {
        service: "bedrock-agent", // Use SDK v3 service name
        action: "createKnowledgeBase",
        parameters: {
          name: props.name,
          roleArn: props.role.roleArn,
          knowledgeBaseConfiguration: {
            type: "VECTOR",
            vectorKnowledgeBaseConfiguration: {
              embeddingModelArn: props.embeddingModelArn,
              embeddingModelConfiguration: {
                bedrockEmbeddingModelConfiguration: {
                  dimensions: props.vectorDimension,
                },
              },
            },
          },
          storageConfiguration: {
            type: "S3_VECTORS",
            s3VectorsConfiguration: {
              vectorBucketArn: props.vectorBucketArn,
              indexArn: props.indexArn,
            },
          },
          clientToken: `kb-${props.name}-${stack.account}-${stack.region}`,
        },
        physicalResourceId: PhysicalResourceId.fromResponse(
          "knowledgeBase.knowledgeBaseId"
        ),
        outputPaths: [
          "knowledgeBase.knowledgeBaseId",
          "knowledgeBase.knowledgeBaseArn",
        ],
      },
      onUpdate: {
        service: "bedrock-agent",
        action: "getKnowledgeBase",
        parameters: {
          knowledgeBaseId: new PhysicalResourceIdReference(),
        },
        outputPaths: [
          "knowledgeBase.knowledgeBaseId",
          "knowledgeBase.knowledgeBaseArn",
        ],
      },
      onDelete: {
        service: "bedrock-agent",
        action: "deleteKnowledgeBase",
        parameters: {
          knowledgeBaseId: new PhysicalResourceIdReference(),
        },
        ignoreErrorCodesMatching:
          "ResourceNotFoundException|NotFound|ConflictException",
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        createBedrockKnowledgeBasePolicy(),
        new iam.PolicyStatement({
          sid: "PassRole",
          actions: ["iam:PassRole"],
          resources: [props.role.roleArn],
        }),
      ]),
      timeout: cdk.Duration.minutes(10),
    });

    // Export response fields
    this.knowledgeBaseId = this.customResource.getResponseField(
      "knowledgeBase.knowledgeBaseId"
    );
    this.knowledgeBaseArn = this.customResource.getResponseField(
      "knowledgeBase.knowledgeBaseArn"
    );
  }

  /**
   * Get a response field from the custom resource
   * @param field The response field path
   * @returns The response field value
   */
  public getResponseField(field: string): string {
    return this.customResource.getResponseField(field);
  }
}
