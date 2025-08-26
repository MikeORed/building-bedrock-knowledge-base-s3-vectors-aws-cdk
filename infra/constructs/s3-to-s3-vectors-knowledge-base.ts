import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import { Construct } from "constructs";

import {
  resolveEmbeddingModelArn,
  resolveParsingModelArn,
  validateEmbeddingDims,
} from "../util/models";
import { deterministicNames, NameOverrides } from "../util/names";
import {
  createS3BucketPolicy,
  createBedrockInvokePolicy,
  createS3VectorsDataPlanePolicy,
  createS3VectorsControlPlanePolicy,
  createCloudWatchLogsPolicy,
} from "../util/iam";

// Import internal constructs
import { S3VectorBucket } from "../internal/s3-vector-bucket";
import { S3VectorIndex } from "../internal/s3-vector-index";
import { BedrockKnowledgeBase } from "../internal/bedrock-knowledge-base";
import {
  CleanupFinalizer,
  DeletionBehavior,
} from "../internal/cleanup-finalizer";

/**
 * Properties for the S3ToS3VectorsKnowledgeBase construct
 */
export interface S3ToS3VectorsKnowledgeBaseProps extends NameOverrides {
  // Core configuration
  /** Prefixes within the ingestion bucket to include. Default: ["docs/"] */
  readonly inclusionPrefixes?: string[];

  // Model configuration
  /** Embedding model ARN (computed from region if omitted) */
  readonly embeddingModelArn?: string;
  /** Vector dimension - supports 256/512/1024 for Titan v2, 1536 for Titan v1 */
  readonly vectorDimension?: number;

  // Optional parsing
  /** Enable foundation model parsing (default: false, uses native pipeline) */
  readonly useFoundationParsing?: boolean;
  /** Parsing model ARN (default: Claude 3 Sonnet in Stack region) */
  readonly parsingModelArn?: string;
  /** Optional custom parsing prompt */
  readonly parsingPromptText?: string;

  // Future-proofing (optional)
  /** Distance metric for similarity search (default: cosine) */
  readonly distanceMetric?: "cosine" | "euclidean" | "dotProduct";
  /** Data type for vectors (default: float32) */
  readonly dataType?: "float32";

  // Lifecycle
  /** Deletion behavior - DELETE (default) or RETAIN */
  readonly deletionBehavior?: DeletionBehavior;

  // Advanced overrides
  /** Optional: provide a role; otherwise construct creates a least-privilege role for KB */
  readonly knowledgeBaseRole?: iam.IRole;
  /** Optional: provide an ingestion bucket; otherwise construct creates one */
  readonly ingestionBucket?: s3.IBucket;
}

/**
 * A single CDK construct that creates a complete Bedrock Knowledge Base with S3 Vectors storage.
 *
 * This construct combines all functionality needed for a Bedrock Knowledge Base:
 * - S3 bucket for document ingestion (optional, can be provided)
 * - IAM role with least-privilege permissions
 * - S3 Vectors bucket and index via internal constructs
 * - Bedrock Knowledge Base via internal construct
 * - Bedrock DataSource via CfnDataSource
 * - Lambda-based cleanup finalizer for proper resource deletion order
 *
 * Key Features:
 * - Self-contained with no org-specific dependencies
 * - Supports both native and foundation model parsing
 * - Proper cleanup handling for S3 Vectors resources
 * - Configurable vector dimensions and model selection
 * - Modular design with utilities and internal constructs
 */
export class S3ToS3VectorsKnowledgeBase extends Construct {
  public readonly knowledgeBaseId: string;
  public readonly knowledgeBaseArn: string;
  public readonly ingestionBucket: s3.IBucket;
  public readonly knowledgeBaseRole: iam.IRole;
  public readonly vectorBucketName: string;
  public readonly vectorIndexName: string;
  public readonly vectorBucketArn: string;
  public readonly vectorIndexArn: string;

  constructor(
    scope: Construct,
    id: string,
    props?: S3ToS3VectorsKnowledgeBaseProps
  ) {
    super(scope, id);

    const stack = cdk.Stack.of(this);

    // 1. Resolve configuration using utilities
    const inclusionPrefixes = props?.inclusionPrefixes ?? ["docs/"];
    const vectorDimension = props?.vectorDimension ?? 1024;
    const useFoundationParsing = props?.useFoundationParsing ?? false;
    const deletionBehavior = props?.deletionBehavior ?? "DELETE";

    const embeddingModelArn = resolveEmbeddingModelArn(
      stack.region,
      props?.embeddingModelArn
    );
    const parsingModelArn = resolveParsingModelArn(
      stack.region,
      props?.parsingModelArn
    );

    // Validate model/dimension compatibility
    validateEmbeddingDims(embeddingModelArn, vectorDimension);

    // Generate deterministic names
    const names = deterministicNames(stack, props);

    // 2. Create or use provided resources
    this.ingestionBucket =
      props?.ingestionBucket ?? this.createIngestionBucket(names.bucketName);

    this.knowledgeBaseRole =
      props?.knowledgeBaseRole ??
      this.createKnowledgeBaseRole(
        names.roleName,
        this.ingestionBucket,
        inclusionPrefixes,
        embeddingModelArn,
        useFoundationParsing ? parsingModelArn : undefined
      );

    // 3. Create internal constructs
    const vectorBucket = new S3VectorBucket(this, "VectorBucket", {
      bucketName: names.vectorBucketName,
    });

    const vectorIndex = new S3VectorIndex(this, "VectorIndex", {
      vectorBucketArn: vectorBucket.bucketArn,
      indexName: names.vectorIndexName,
      dimension: vectorDimension,
      distanceMetric: props?.distanceMetric ?? "cosine",
      dataType: props?.dataType ?? "float32",
    });

    const knowledgeBase = new BedrockKnowledgeBase(this, "KnowledgeBase", {
      name: names.knowledgeBaseName,
      role: this.knowledgeBaseRole,
      vectorBucketArn: vectorBucket.bucketArn,
      indexArn: vectorIndex.indexArn,
      embeddingModelArn,
      vectorDimension,
    });

    // Create DataSource
    const dataSource = this.createDataSource(
      names.dataSourceName,
      knowledgeBase,
      this.ingestionBucket,
      inclusionPrefixes,
      useFoundationParsing,
      parsingModelArn,
      props?.parsingPromptText
    );

    // Create cleanup finalizer
    const finalizer = new CleanupFinalizer(this, "Finalizer", {
      knowledgeBaseId: knowledgeBase.knowledgeBaseId,
      dataSourceNamePrefix: names.dataSourceName,
      deletionBehavior,
    });

    // 4. Set up dependencies
    vectorIndex.node.addDependency(vectorBucket);
    knowledgeBase.node.addDependency(vectorIndex);
    dataSource.node.addDependency(knowledgeBase);
    finalizer.node.addDependency(dataSource);
    finalizer.node.addDependency(knowledgeBase);

    // Finalizer must depend on S3 Vectors resources for proper cleanup order
    finalizer.node.addDependency(vectorIndex);
    finalizer.node.addDependency(vectorBucket);

    // 5. Export public properties
    this.knowledgeBaseId = knowledgeBase.knowledgeBaseId;
    this.knowledgeBaseArn = knowledgeBase.knowledgeBaseArn;
    this.vectorBucketName = names.vectorBucketName;
    this.vectorIndexName = names.vectorIndexName;
    this.vectorBucketArn = vectorBucket.bucketArn;
    this.vectorIndexArn = vectorIndex.indexArn;
  }

  /**
   * Create an S3 bucket for document ingestion with security hardening
   */
  private createIngestionBucket(bucketName: string): s3.IBucket {
    const bucket = new s3.Bucket(this, "IngestionBucket", {
      bucketName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    });

    // Deny insecure connections
    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "DenyInsecureConnections",
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:*"],
        resources: [bucket.bucketArn, bucket.arnForObjects("*")],
        conditions: {
          Bool: {
            "aws:SecureTransport": "false",
          },
        },
      })
    );

    return bucket;
  }

  /**
   * Create IAM role with least-privilege permissions for the Knowledge Base
   */
  private createKnowledgeBaseRole(
    roleName: string,
    ingestionBucket: s3.IBucket,
    inclusionPrefixes: string[],
    embeddingModelArn: string,
    parsingModelArn?: string
  ): iam.IRole {
    const stack = cdk.Stack.of(this);

    const role = new iam.Role(this, "KnowledgeBaseRole", {
      roleName,
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com"),
      description: "Role for Bedrock Knowledge Base with S3 Vectors storage",
    });

    // S3 permissions using utility
    const s3Policies = createS3BucketPolicy(ingestionBucket, inclusionPrefixes);
    s3Policies.forEach((policy) => role.addToPolicy(policy));

    // Bedrock model invocation permissions using utility
    const modelArns = [embeddingModelArn];
    if (parsingModelArn) {
      modelArns.push(parsingModelArn);
    }
    role.addToPolicy(createBedrockInvokePolicy(modelArns));

    // S3 Vectors data-plane operations using utility
    // TODO: Use specific index ARN when GA supports resource-scoped permissions
    role.addToPolicy(createS3VectorsDataPlanePolicy());

    // S3 Vectors control-plane operations for Knowledge Base validation
    role.addToPolicy(createS3VectorsControlPlanePolicy());

    // CloudWatch Logs permissions using utility
    role.addToPolicy(createCloudWatchLogsPolicy(stack.region, stack.account));

    return role;
  }

  /**
   * Create Bedrock DataSource via CfnDataSource
   */
  private createDataSource(
    dataSourceName: string,
    knowledgeBase: BedrockKnowledgeBase,
    ingestionBucket: s3.IBucket,
    inclusionPrefixes: string[],
    useFoundationParsing: boolean,
    parsingModelArn: string,
    parsingPromptText?: string
  ): bedrock.CfnDataSource {
    // Optional foundation model parsing configuration
    const maybeParsing = useFoundationParsing
      ? {
          parsingConfiguration: {
            parsingStrategy: "BEDROCK_FOUNDATION_MODEL",
            bedrockFoundationModelConfiguration: {
              modelArn: parsingModelArn,
              parsingPrompt: parsingPromptText
                ? { parsingPromptText: parsingPromptText }
                : undefined,
            },
          },
        }
      : {};

    const dataSource = new bedrock.CfnDataSource(this, "DataSource", {
      name: dataSourceName,
      description: `S3 data source for Knowledge Base - ${dataSourceName}`,
      knowledgeBaseId: knowledgeBase.knowledgeBaseId,
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: {
          bucketArn: ingestionBucket.bucketArn,
          inclusionPrefixes,
        },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: "FIXED_SIZE",
          fixedSizeChunkingConfiguration: {
            maxTokens: 1000,
            overlapPercentage: 30,
          },
        },
        ...maybeParsing,
      },
    });

    dataSource.node.addDependency(knowledgeBase);
    return dataSource;
  }
}
