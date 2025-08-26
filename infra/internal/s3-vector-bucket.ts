import * as cdk from "aws-cdk-lib";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { createS3VectorsControlPlanePolicy } from "../util/iam";

/**
 * Properties for S3VectorBucket construct
 */
export interface S3VectorBucketProps {
  /** Name of the S3 Vectors bucket */
  readonly bucketName: string;
}

/**
 * Internal construct that wraps S3 Vectors bucket creation/deletion
 */
export class S3VectorBucket extends Construct {
  public readonly bucketName: string;
  public readonly bucketArn: string;

  constructor(scope: Construct, id: string, props: S3VectorBucketProps) {
    super(scope, id);

    this.bucketName = props.bucketName;

    const stack = cdk.Stack.of(this);
    this.bucketArn = `arn:aws:s3vectors:${stack.region}:${stack.account}:bucket/${props.bucketName}`;

    new AwsCustomResource(this, "Resource", {
      installLatestAwsSdk: true,
      onCreate: {
        service: "s3vectors",
        action: "createVectorBucket",
        parameters: {
          vectorBucketName: props.bucketName,
        },
        physicalResourceId: PhysicalResourceId.of(
          `s3vectors-bucket-${props.bucketName}`
        ),
        ignoreErrorCodesMatching:
          "ConflictException|ResourceAlreadyExistsException|ThrottlingException|TooManyRequestsException",
      },
      onDelete: {
        service: "s3vectors",
        action: "deleteVectorBucket",
        parameters: {
          vectorBucketArn: this.bucketArn,
        },
        ignoreErrorCodesMatching:
          "ResourceNotFoundException|NoSuchBucket|ThrottlingException|TooManyRequestsException",
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        createS3VectorsControlPlanePolicy(),
      ]),
      timeout: cdk.Duration.minutes(5),
    });
  }
}
