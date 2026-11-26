# Requirements: Replace custom resources with native CDK/CloudFormation resources

## Introduction

This repo shows how to deploy a Bedrock Knowledge Base backed by Amazon S3 Vectors with AWS CDK. It was written during the S3 Vectors preview, when CloudFormation had no support for S3 Vectors. The vector bucket, vector index and Knowledge Base are therefore created with `AwsCustomResource`, and a Lambda-based finalizer works around teardown ordering.

S3 Vectors is now generally available, and `aws-cdk-lib` ships L1 constructs for it (`aws_s3vectors.CfnVectorBucket`, `CfnIndex`). `aws_bedrock.CfnKnowledgeBase` supports `S3VectorsConfiguration`. This spec covers moving the repo to those native resources so it remains a current, minimal example of the solution in CDK.

Status: spec only. No implementation is included in this change.

## Requirements

### 1. Native resources for the vector store

**User story:** As a CDK user, I want the example to use first-party resources, so that I can copy a pattern that matches current AWS guidance.

Acceptance criteria:
1. The S3 Vectors bucket is created with `aws_s3vectors.CfnVectorBucket`.
2. The S3 Vectors index is created with `aws_s3vectors.CfnIndex`, with the same dimension, distance metric and data type options as today.
3. The index sets `metadataConfiguration.nonFilterableMetadataKeys` to include `AMAZON_BEDROCK_TEXT`.
4. The Knowledge Base is created with `aws_bedrock.CfnKnowledgeBase` using `S3_VECTORS` storage and the vector bucket and index ARNs from the native resources (via `Fn::GetAtt`, not hand-built ARN strings).
5. The data source continues to use `aws_bedrock.CfnDataSource`.
6. No `AwsCustomResource` is used for these resources.

### 2. Teardown without the finalizer

**User story:** As a user, I want `cdk destroy` to work without extra machinery, so that the example is easy to run and clean up.

Acceptance criteria:
1. The cleanup Lambda, its custom resource, and `src/lambda/cleanup-handler.ts` are removed, unless testing (criterion 3) shows they are still required.
2. Resource dependencies are expressed with normal CDK/CloudFormation dependencies (`addDependency` or implicit references).
3. A full deploy followed by destroy completes without manual steps, in at least one supported region. If destroy fails, the failure and the chosen mitigation (for example `dataDeletionPolicy: RETAIN`) are documented in the README.
4. If AWS credentials are unavailable for deploy and destroy testing, the PR states that teardown is untested.

### 3. Dependencies

Acceptance criteria:
1. `aws-cdk-lib` is upgraded to a version that includes the `aws_s3vectors` module, and the `aws-cdk` CLI devDependency is upgraded to a compatible version.
2. Packages used only by the removed code (`esbuild`, `@aws-sdk/client-bedrock-agent`) are removed if nothing else uses them.
3. `package-lock.json` is updated.

### 4. Preserve the useful parts of the current example

Acceptance criteria:
1. The embedding model and dimension validation (`validateEmbeddingDims`) is kept.
2. The least-privilege Knowledge Base role (ingestion bucket read, model invoke, S3 Vectors access, logs) is kept. Any S3 Vectors permissions that were only required by the removed custom resources are dropped.
3. The ingestion bucket defaults (SSL enforced, encrypted, owner-enforced ownership) are kept, and a bring-your-own bucket option remains.
4. Deterministic naming is kept, or replaced by CloudFormation-generated names if that is simpler and the README explains the change.
5. Optional foundation-model parsing and `dataDeletionPolicy` remain available.
6. Stack outputs for Knowledge Base ID and ARN, ingestion bucket, and vector bucket and index names remain. Adding a `DataSourceId` output is allowed, since the README currently documents it as a gap.

### 5. Documentation

Acceptance criteria:
1. The README no longer describes S3 Vectors as preview, and the region list is updated or replaced with a link to the AWS documentation.
2. Sections about the finalizer, preview SDK pinning and custom-resource IAM breadth are removed or rewritten.
3. The README links to the first-party constructs used, and mentions `awslabs/generative-ai-cdk-constructs` as a higher-level alternative.
4. The file layout and architecture diagram match the new code.

### 6. Verification

Acceptance criteria:
1. `npm run build` and `npx cdk synth` succeed.
2. The existing Jest test is updated to assert on the synthesized template: it contains `AWS::S3Vectors::VectorBucket`, `AWS::S3Vectors::Index`, `AWS::Bedrock::KnowledgeBase` and `AWS::Bedrock::DataSource`, and contains no `Custom::AWS` resources and no Lambda finalizer.
3. `npm test` passes.

## Out of scope

- Adding an L2 abstraction beyond a thin wrapper construct.
- Supporting vector stores other than S3 Vectors.
- Application-side ingestion, retrieval, or RAG code.
- Archiving the repository or editing the external blog post (tracked separately by the maintainer).

## Open questions

1. Keep the reusable `S3ToS3VectorsKnowledgeBase` construct as a thin wrapper, or flatten to a single example stack? Default in the design: keep the thin wrapper, because the repo is framed around it.
2. Which `aws-cdk-lib` version to pin? To be confirmed during implementation.
