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
  /** Distance metric for similarity search */
  readonly distanceMetric?: "cosine" | "euclidean" | "dotProduct";
  /** Data type for vectors */
  readonly dataType?: "float32";
}

/**
 * Internal construct that wraps S3 Vectors index creation/deletion
 * Uses AWS SDK v3 service names and removes unnecessary installLatestAwsSdk
 */
export class S3VectorIndex extends Construct {
  public readonly indexName: string;
  public readonly indexArn: string;

  constructor(scope: Construct, id: string, props: S3VectorIndexProps) {
    super(scope, id);

    this.indexName = props.indexName;
    this.indexArn = `${props.vectorBucketArn}/index/${props.indexName}`;

    new AwsCustomResource(this, "Resource", {
      onCreate: {
        service: "s3vectors", // Use SDK v3 service name
        action: "createIndex",
        parameters: {
          vectorBucketArn: props.vectorBucketArn,
          indexName: props.indexName,
          dataType: props.dataType ?? "float32",
          dimension: props.dimension,
          distanceMetric: props.distanceMetric ?? "cosine",
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
          vectorBucketArn: props.vectorBucketArn,
          indexName: props.indexName,
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
