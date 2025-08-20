import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
  PhysicalResourceIdReference,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";

/**
 * Properties for the S3ToS3VectorsKnowledgeBase construct
 */
export interface S3ToS3VectorsKnowledgeBaseProps {
  /** Optional: provide a role; otherwise construct creates a least-privilege role for KB */
  readonly knowledgeBaseRole?: iam.IRole;

  /** Optional: provide an ingestion bucket; otherwise construct creates one */
  readonly ingestionBucket?: s3.IBucket;

  /** Prefixes within the ingestion bucket to include. Default: ["docs/"] */
  readonly inclusionPrefixes?: string[];

  /** Embedding vector dimension; Titan v2 uses 1024 (must match model) */
  readonly vectorDimension?: number; // default 1024

  /** Optional names; otherwise generate short deterministic names */
  readonly knowledgeBaseName?: string;
  readonly dataSourceName?: string;
  readonly vectorBucketName?: string;
  readonly vectorIndexName?: string;

  /** Model ARNs (computed from region if omitted) */
  readonly embeddingModelArn?: string; // default: Titan embed text v2 in Stack region

  /**
   * Optional: enable foundation model parsing (default: false, uses native pipeline)
   *
   * Foundation model parsing is off by default for cost optimization and uses Bedrock's
   * native parsing pipeline. When enabled, allows custom parsing prompts and model selection
   * but incurs additional costs for model invocations during document processing.
   */
  readonly useFoundationParsing?: boolean; // default false
  readonly parsingModelArn?: string; // default: Claude 3 Sonnet in Stack region
  readonly parsingPromptText?: string; // optional custom parsing prompt
}

/**
 * A single CDK construct that creates a complete Bedrock Knowledge Base with S3 Vectors storage.
 *
 * This construct combines all functionality needed for a Bedrock Knowledge Base:
 * - S3 bucket for document ingestion (optional, can be provided)
 * - IAM role with least-privilege permissions
 * - S3 Vectors bucket and index via AwsCustomResource
 * - Bedrock Knowledge Base via AwsCustomResource
 * - Bedrock DataSource via CfnDataSource
 * - Lambda-based cleanup finalizer for proper resource deletion order
 *
 * Key Features:
 * - Self-contained with no org-specific dependencies
 * - Supports both native and foundation model parsing
 * - Proper cleanup handling for S3 Vectors resources
 * - Configurable vector dimensions and model selection
 * - Blog-friendly with comprehensive documentation
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

    // Set defaults
    const inclusionPrefixes = props?.inclusionPrefixes ?? ["docs/"];
    const vectorDimension = props?.vectorDimension ?? 1024;
    const useFoundationParsing = props?.useFoundationParsing ?? false;

    const region = cdk.Stack.of(this).region;
    const stackId = cdk.Stack.of(this).stackId;

    // Model/dimension sanity check: validate embedding model and dimension compatibility
    const embeddingModelArn =
      props?.embeddingModelArn ?? this.getEmbeddingModelArn(region);
    this.validateModelDimensionCompatibility(
      embeddingModelArn,
      vectorDimension
    );

    // Generate deterministic names
    const names = this.generateDeterministicNames(stackId, props);

    // Create or use provided ingestion bucket
    this.ingestionBucket =
      props?.ingestionBucket ?? this.createIngestionBucket(names.bucketName);

    // Create or use provided knowledge base role
    this.knowledgeBaseRole =
      props?.knowledgeBaseRole ??
      this.createKnowledgeBaseRole(
        names.roleName,
        this.ingestionBucket,
        inclusionPrefixes,
        embeddingModelArn,
        useFoundationParsing
          ? props?.parsingModelArn ?? this.getParsingModelArn(region)
          : undefined
      );

    // Create S3 Vectors bucket
    const vectorsBucket = this.createS3VectorsBucket(names.vectorBucketName);

    // Create S3 Vectors index
    const vectorsIndex = this.createS3VectorsIndex(
      names.vectorIndexName,
      names.vectorBucketName,
      vectorDimension
    );

    // Build deterministic ARNs for Knowledge Base configuration
    const account = cdk.Stack.of(this).account;
    const vectorBucketArn = `arn:aws:s3vectors:${region}:${account}:bucket/${names.vectorBucketName}`;
    const indexArn = `${vectorBucketArn}/index/${names.vectorIndexName}`;

    // Create Knowledge Base
    const knowledgeBase = this.createKnowledgeBase(
      names.knowledgeBaseName,
      this.knowledgeBaseRole,
      vectorBucketArn,
      indexArn,
      embeddingModelArn,
      vectorDimension
    );

    // Create DataSource
    const dataSource = this.createDataSource(
      names.dataSourceName,
      knowledgeBase,
      this.ingestionBucket,
      inclusionPrefixes,
      useFoundationParsing,
      props?.parsingModelArn ?? this.getParsingModelArn(region),
      props?.parsingPromptText
    );

    // Create cleanup finalizer
    const finalizer = this.createCleanupFinalizer(
      knowledgeBase,
      dataSource,
      names.dataSourceName
    );

    // Ensure proper creation/deletion order
    vectorsIndex.node.addDependency(vectorsBucket);
    knowledgeBase.node.addDependency(vectorsIndex);
    dataSource.node.addDependency(knowledgeBase);
    finalizer.node.addDependency(dataSource);
    finalizer.node.addDependency(knowledgeBase);

    // Finalizer must depend on S3 Vectors resources for proper cleanup order
    // CFN deletes in reverse dependency order, so finalizer is deleted first (triggering cleanup)
    // Then CFN deletes the S3 Vectors resources after cleanup completes
    finalizer.node.addDependency(vectorsIndex);
    finalizer.node.addDependency(vectorsBucket);

    // Export public properties
    this.knowledgeBaseId = knowledgeBase.getResponseField(
      "knowledgeBase.knowledgeBaseId"
    );
    this.knowledgeBaseArn = knowledgeBase.getResponseField(
      "knowledgeBase.knowledgeBaseArn"
    );
    this.vectorBucketName = names.vectorBucketName;
    this.vectorIndexName = names.vectorIndexName;
    this.vectorBucketArn = vectorBucketArn;
    this.vectorIndexArn = indexArn;
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

    // Avoid StringEquals: aws:PrincipalArn - STS assumed roles break this condition
    // Use ArnPrincipal directly for role-based access
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
    const role = new iam.Role(this, "KnowledgeBaseRole", {
      roleName,
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com"),
      description: "Role for Bedrock Knowledge Base with S3 Vectors storage",
    });

    // S3 read permissions for ingestion bucket + prefixes (split by resource type for clarity)
    const s3ObjectResources = inclusionPrefixes.flatMap((prefix) => [
      ingestionBucket.arnForObjects(`${prefix}*`),
    ]);

    // ListBucket permission on bucket ARN only
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "S3ListBucket",
        effect: iam.Effect.ALLOW,
        actions: ["s3:ListBucket", "s3:ListBucketVersions"],
        resources: [ingestionBucket.bucketArn],
      })
    );

    // GetObject permission on object ARNs only
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "S3GetObject",
        effect: iam.Effect.ALLOW,
        actions: ["s3:GetObject", "s3:GetObjectVersion"],
        resources: s3ObjectResources,
      })
    );

    // Bedrock model invocation permissions
    const embeddingModels = [embeddingModelArn];
    const parsingModels = parsingModelArn ? [parsingModelArn] : [];
    const modelResources = [...embeddingModels, ...parsingModels];

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "BedrockModelAccess",
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: modelResources,
      })
    );

    // S3 Vectors data-plane operations (use wildcard during preview)
    // TODO: Tighten to specific resource ARNs when GA supports them
    const s3VectorsDataPlaneActions = [
      "s3vectors:PutVectors",
      "s3vectors:GetVectors",
      "s3vectors:ListVectors",
      "s3vectors:QueryVectors",
      "s3vectors:DeleteVectors",
    ];

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "S3VectorsDataPlane",
        effect: iam.Effect.ALLOW,
        actions: s3VectorsDataPlaneActions,
        resources: ["*"], // S3 Vectors data-plane currently requires resources: ['*']
      })
    );

    // CloudWatch Logs write (optional but helpful for debugging)
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "CloudWatchLogs",
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
        ],
        resources: [
          `arn:aws:logs:${cdk.Stack.of(this).region}:${
            cdk.Stack.of(this).account
          }:log-group:/aws/bedrock/*`,
          `arn:aws:logs:${cdk.Stack.of(this).region}:${
            cdk.Stack.of(this).account
          }:log-group:/aws/bedrock/*:*`,
        ],
      })
    );

    return role;
  }

  /**
   * Create S3 Vectors bucket via AwsCustomResource
   */
  private createS3VectorsBucket(vectorBucketName: string): AwsCustomResource {
    return new AwsCustomResource(this, "S3VectorsBucket", {
      installLatestAwsSdk: true,
      onCreate: {
        service: "S3Vectors",
        action: "createVectorBucket",
        parameters: {
          vectorBucketName, // Correct API parameter name
        },
        physicalResourceId: PhysicalResourceId.of(
          `s3vectors-bucket-${vectorBucketName}`
        ),
        ignoreErrorCodesMatching:
          "ConflictException|ResourceAlreadyExistsException|ThrottlingException|TooManyRequestsException",
      },
      onDelete: {
        service: "S3Vectors",
        action: "deleteVectorBucket",
        parameters: {
          vectorBucketName, // Correct API parameter name
        },
        ignoreErrorCodesMatching:
          "ResourceNotFoundException|NoSuchBucket|ThrottlingException|TooManyRequestsException",
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          sid: "S3VectorsControlPlane",
          effect: iam.Effect.ALLOW,
          actions: [
            "s3vectors:CreateVectorBucket",
            "s3vectors:GetVectorBucket",
            "s3vectors:DeleteVectorBucket",
          ],
          resources: ["*"],
        }),
      ]),
      timeout: cdk.Duration.minutes(5),
    });
  }

  /**
   * Create S3 Vectors index via AwsCustomResource
   */
  private createS3VectorsIndex(
    indexName: string,
    vectorBucketName: string,
    vectorDimension: number
  ): AwsCustomResource {
    const account = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;
    const vectorBucketArn = `arn:aws:s3vectors:${region}:${account}:bucket/${vectorBucketName}`;

    const index = new AwsCustomResource(this, "S3VectorsIndex", {
      installLatestAwsSdk: true,
      onCreate: {
        service: "S3Vectors",
        action: "createIndex",
        parameters: {
          vectorBucketArn, // Use deterministic ARN instead of response field
          indexName,
          dataType: "float32", // Flat parameters as per API spec
          dimension: vectorDimension,
          distanceMetric: "cosine",
        },
        physicalResourceId: PhysicalResourceId.of(
          `s3vectors-index-${indexName}`
        ),
        ignoreErrorCodesMatching:
          "ConflictException|ResourceAlreadyExistsException|ThrottlingException|TooManyRequestsException",
      },
      onDelete: {
        service: "S3Vectors",
        action: "deleteIndex",
        parameters: {
          vectorBucketArn, // Use deterministic ARN instead of response field
          indexName,
        },
        ignoreErrorCodesMatching:
          "ResourceNotFoundException|NoSuchIndex|ThrottlingException|TooManyRequestsException",
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          sid: "S3VectorsIndexControlPlane",
          effect: iam.Effect.ALLOW,
          actions: [
            "s3vectors:CreateIndex",
            "s3vectors:GetIndex",
            "s3vectors:DeleteIndex",
            "s3vectors:ListIndexes",
          ],
          resources: ["*"],
        }),
      ]),
      timeout: cdk.Duration.minutes(10),
    });

    return index;
  }

  /**
   * Create Bedrock Knowledge Base via AwsCustomResource
   */
  private createKnowledgeBase(
    knowledgeBaseName: string,
    role: iam.IRole,
    vectorBucketArn: string,
    indexArn: string,
    embeddingModelArn: string,
    vectorDimension: number
  ): AwsCustomResource {
    return new AwsCustomResource(this, "KnowledgeBase", {
      installLatestAwsSdk: true,
      onCreate: {
        service: "BedrockAgent",
        action: "createKnowledgeBase",
        parameters: {
          name: knowledgeBaseName,
          roleArn: role.roleArn,
          knowledgeBaseConfiguration: {
            type: "VECTOR",
            vectorKnowledgeBaseConfiguration: {
              embeddingModelArn,
              embeddingModelConfiguration: {
                bedrockEmbeddingModelConfiguration: {
                  dimensions: vectorDimension,
                },
              },
            },
          },
          storageConfiguration: {
            type: "S3_VECTORS",
            s3VectorsConfiguration: {
              vectorBucketArn,
              indexArn,
            },
          },
          clientToken: `kb-${knowledgeBaseName}-${cdk.Stack.of(this).account}-${
            cdk.Stack.of(this).region
          }`,
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
        service: "BedrockAgent",
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
        service: "BedrockAgent",
        action: "deleteKnowledgeBase",
        parameters: {
          knowledgeBaseId: new PhysicalResourceIdReference(),
        },
        ignoreErrorCodesMatching:
          "ResourceNotFoundException|NotFound|ConflictException",
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: [
            "bedrock:CreateKnowledgeBase",
            "bedrock:GetKnowledgeBase",
            "bedrock:DeleteKnowledgeBase",
            "bedrock:UpdateKnowledgeBase",
          ],
          resources: ["*"],
        }),
        new iam.PolicyStatement({
          actions: ["iam:PassRole"],
          resources: [role.roleArn],
        }),
      ]),
      timeout: cdk.Duration.minutes(10),
    });
  }

  /**
   * Create Bedrock DataSource via CfnDataSource
   */
  private createDataSource(
    dataSourceName: string,
    knowledgeBase: AwsCustomResource,
    ingestionBucket: s3.IBucket,
    inclusionPrefixes: string[],
    useFoundationParsing: boolean,
    parsingModelArn: string,
    parsingPromptText?: string
  ): bedrock.CfnDataSource {
    // Optional foundation model parsing configuration
    // Foundation model parsing is optional (default: false)
    // When disabled, uses native Bedrock parsing pipeline (lower cost)
    // When enabled, allows custom parsing prompts and model selection

    const maybeParsing = useFoundationParsing // I was tempted to call this "They May Be Parsing", but I resisted
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
      knowledgeBaseId: knowledgeBase.getResponseField(
        "knowledgeBase.knowledgeBaseId"
      ),
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
        // Apply conditional parsing in vectorIngestionConfiguration
        // Only present when useFoundationParsing is true
        ...maybeParsing,
      },
    });

    dataSource.node.addDependency(knowledgeBase);
    return dataSource;
  }

  /**
   * Create Lambda-based cleanup finalizer for proper resource deletion order
   */
  private createCleanupFinalizer(
    knowledgeBase: AwsCustomResource,
    dataSource: bedrock.CfnDataSource,
    dataSourceNamePrefix: string
  ): AwsCustomResource {
    // Create Lambda function for cleanup using NodejsFunction for TypeScript compilation
    const lg = new logs.LogGroup(this, "CleanupFnLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const cleanupFn = new NodejsFunction(this, "CleanupFunction", {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: "src/lambda/cleanuphandler.ts",
      handler: "handler",
      logGroup: lg,
      timeout: cdk.Duration.minutes(15), // Match maxMinutes default
      memorySize: 256,
      description:
        "Cleanup finalizer for Bedrock Knowledge Base and DataSource",
      bundling: {
        // Bundle AWS SDK v3 client (do NOT set externalModules for @aws-sdk/*)
      },
    });

    // Grant cleanup function permissions
    cleanupFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "BedrockCleanupPermissions",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:ListDataSources",
          "bedrock:GetDataSource",
          "bedrock:DeleteDataSource",
          "bedrock:ListIngestionJobs",
          "bedrock:GetIngestionJob",
          "bedrock:GetKnowledgeBase",
          "bedrock:DeleteKnowledgeBase",
        ],
        resources: ["*"],
      })
    );

    // Create custom resource that invokes cleanup Lambda on DELETE
    const finalizer = new AwsCustomResource(this, "CleanupFinalizer", {
      installLatestAwsSdk: true,
      onCreate: {
        service: "Lambda",
        action: "invoke",
        parameters: {
          FunctionName: cleanupFn.functionName,
          InvocationType: "Event",
          Payload: JSON.stringify({ noop: true }),
        },
        physicalResourceId: PhysicalResourceId.of(
          `finalizer-${cdk.Names.uniqueId(this).slice(-12)}`
        ),
      },
      onDelete: {
        service: "Lambda",
        action: "invoke",
        parameters: {
          FunctionName: cleanupFn.functionName,
          InvocationType: "RequestResponse", // Synchronous
          Payload: cdk.Stack.of(this).toJsonString({
            region: cdk.Stack.of(this).region,
            knowledgeBaseId: knowledgeBase.getResponseField(
              "knowledgeBase.knowledgeBaseId"
            ),
            dataSourceNamePrefix,
            pollSeconds: 5,
            maxMinutes: 15,
          }),
        },
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          sid: "InvokeCleanupLambda",
          effect: iam.Effect.ALLOW,
          actions: ["lambda:InvokeFunction"],
          resources: [cleanupFn.functionArn],
        }),
      ]),
      timeout: cdk.Duration.minutes(16), // Slightly longer than Lambda timeout
    });

    return finalizer;
  }

  /**
   * Get embedding model ARN for the given region
   */
  private getEmbeddingModelArn(region: string): string {
    return `arn:aws:bedrock:${region}::foundation-model/amazon.titan-embed-text-v2:0`;
  }

  /**
   * Get parsing model ARN for the given region
   */
  private getParsingModelArn(region: string): string {
    return `arn:aws:bedrock:${region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`;
  }

  /**
   * Validate embedding model and dimension compatibility
   */
  private validateModelDimensionCompatibility(
    embeddingModelArn: string,
    vectorDimension: number
  ): void {
    // Check if embeddingModelArn contains titan-embed-text-v2, enforce 1024
    if (embeddingModelArn.includes("titan-embed-text-v2")) {
      if (vectorDimension !== 1024) {
        throw new Error(
          `Titan Embed Text v2 model requires 1024 dimensions, but got ${vectorDimension}. ` +
            `Please set vectorDimension to 1024 or use a different embedding model.`
        );
      }
    }
    // Check if embeddingModelArn contains titan-embed-text-v1, enforce 1536
    else if (embeddingModelArn.includes("titan-embed-text-v1")) {
      if (vectorDimension !== 1536) {
        throw new Error(
          `Titan Embed Text v1 model requires 1536 dimensions, but got ${vectorDimension}. ` +
            `Please set vectorDimension to 1536 or use a different embedding model.`
        );
      }
    }
    // General validation for supported dimensions
    else if (vectorDimension !== 1024 && vectorDimension !== 1536) {
      throw new Error(
        `vectorDimension must be 1024 (Titan v2) or 1536 (Titan v1), but got ${vectorDimension}. ` +
          `Ensure your embedding model and vector dimensions are compatible.`
      );
    }
  }

  /**
   * Generate deterministic names based on stack ID to avoid collisions
   */
  private generateDeterministicNames(
    stackId: string,
    props?: S3ToS3VectorsKnowledgeBaseProps
  ): {
    knowledgeBaseName: string;
    dataSourceName: string;
    vectorBucketName: string;
    vectorIndexName: string;
    bucketName: string;
    roleName: string;
  } {
    // Extract short suffix from stack ID for collision-proof naming
    // Clean the suffix to ensure S3 bucket name compliance (lowercase, alphanumeric, hyphens only)
    const rawSuffix = stackId.split("/").pop()?.slice(-8) ?? "default";
    const suffix =
      rawSuffix
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 8) || "default";

    // Include account and region for S3 bucket uniqueness
    const account = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    return {
      knowledgeBaseName: props?.knowledgeBaseName ?? `kb-s3vectors-${suffix}`,
      dataSourceName: props?.dataSourceName ?? `ds-s3-${suffix}`,
      vectorBucketName: props?.vectorBucketName ?? `s3vectors-${suffix}`,
      vectorIndexName: props?.vectorIndexName ?? `index-${suffix}`,
      bucketName: `bedrock-kb-ingestion-${region}-${account}-${suffix}`,
      roleName: `BedrockKB-Role-${suffix}`,
    };
  }
}
