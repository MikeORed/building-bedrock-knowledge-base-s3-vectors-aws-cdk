import * as cdk from "aws-cdk-lib";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { createS3VectorsControlPlanePolicy } from "../util/iam";

/**
 * Properties for S3VectorIndex construct
 */
export interface S3VectorIndexProps {
  /** ARN of the S3 Vectors bucket */
  readonly vectorBucketArn: string;
  /** Name of the index */
  readonly indexName: string;
  /** Vector dimension */
  readonly dimension: number;
  /** Distance metric for similarity search - S3 Vectors supports euclidean | cosine only */
  readonly distanceMetric?: "cosine" | "euclidean";
  /** Data type for vectors */
  readonly dataType?: "float32";
}

/**
 * Internal construct that wraps S3 Vectors index creation/deletion
 */
export class S3VectorIndex extends Construct {
  public readonly indexName: string;
  public readonly indexArn: string;

  constructor(scope: Construct, id: string, props: S3VectorIndexProps) {
    super(scope, id);

    this.indexName = props.indexName;
    this.indexArn = `${props.vectorBucketArn}/index/${props.indexName}`;

    new AwsCustomResource(this, "Resource", {
      installLatestAwsSdk: true,
      onCreate: {
        service: "s3vectors",
        action: "createIndex",
        parameters: {
          vectorBucketArn: props.vectorBucketArn,
          indexName: props.indexName,
          dataType: props.dataType ?? "float32",
          dimension: props.dimension,
          distanceMetric: props.distanceMetric ?? "cosine",
          metadataConfiguration: {
            nonFilterableMetadataKeys: [
              "AMAZON_BEDROCK_TEXT", //for s3 vectors this is effectively required, read further: https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-setup.html
            ],
          },
        },
        physicalResourceId: PhysicalResourceId.of(
          `s3vectors-index-${props.indexName}`
        ),
        ignoreErrorCodesMatching:
          "ConflictException|ResourceAlreadyExistsException|ThrottlingException|TooManyRequestsException",
      },
      onDelete: {
        service: "s3vectors",
        action: "deleteIndex",
        parameters: {
          indexArn: this.indexArn,
        },
        ignoreErrorCodesMatching:
          "ResourceNotFoundException|NoSuchIndex|ThrottlingException|TooManyRequestsException",
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        createS3VectorsControlPlanePolicy(),
      ]),
      timeout: cdk.Duration.minutes(10),
    });
  }
}
