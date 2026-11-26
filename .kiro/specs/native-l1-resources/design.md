# Design: Replace custom resources with native CDK/CloudFormation resources

## Overview

Keep the public construct `S3ToS3VectorsKnowledgeBase` as a thin wrapper, and rebuild its internals from native L1 resources. Delete the three custom-resource wrappers and the finalizer.

## Current vs target

| Concern | Current | Target |
| --- | --- | --- |
| Vector bucket | `AwsCustomResource` (`s3vectors:createVectorBucket`) | `s3vectors.CfnVectorBucket` |
| Vector index | `AwsCustomResource` (`s3vectors:createIndex`) | `s3vectors.CfnIndex` |
| Knowledge Base | `AwsCustomResource` (`bedrock-agent:createKnowledgeBase`) | `bedrock.CfnKnowledgeBase` with `S3_VECTORS` storage |
| Data source | `bedrock.CfnDataSource` | unchanged |
| Teardown ordering | Lambda finalizer + custom resource | CloudFormation dependencies |
| ARNs | built by string interpolation | `Fn::GetAtt` via L1 attributes (`attrVectorBucketArn`, `attrIndexArn`, `attrKnowledgeBaseId`, `attrKnowledgeBaseArn`) |

Attribute names above must be checked against the installed `aws-cdk-lib` typings during implementation.

## Target structure

```
infra/
  constructs/
    s3-to-s3-vectors-knowledge-base.ts   # thin wrapper, uses L1 resources directly
  stacks/
    bedrock-kb-stack.ts                  # example stack
  util/
    models.ts                            # kept
    iam.ts                               # kept, trimmed
    names.ts                             # kept or simplified
bin/app.ts
test/                                    # template assertions
```

Removed: `infra/internal/*`, `src/lambda/cleanup-handler.ts`.

## Resource graph

```
CfnVectorBucket
      |
      v
   CfnIndex  (dimension, distanceMetric, dataType, nonFilterableMetadataKeys=[AMAZON_BEDROCK_TEXT])
      |
      v
CfnKnowledgeBase (S3_VECTORS: vectorBucketArn/indexArn, embedding model + dimensions + data type, role)
      |
      v
CfnDataSource (S3 ingestion bucket, chunking, optional FM parsing, dataDeletionPolicy)
```

The Knowledge Base references the index and bucket through GetAtt, so CloudFormation creates them in order and deletes them in reverse (data source, Knowledge Base, index, bucket).

## Teardown risk

The finalizer existed because deleting a Knowledge Base or data source with `dataDeletionPolicy: DELETE` could fail while vectors remained or an ingestion job was running. CloudFormation ordering fixes the sequence of deletes, but it does not remove that failure mode.

Plan:
1. Implement with native dependencies only and run deploy, ingest, destroy.
2. If destroy fails, prefer a documented setting (`dataDeletionPolicy: RETAIN`, or emptying the index first) over reintroducing a Lambda.
3. If the finalizer proves necessary, keep a reduced version and record why in the README.

This is the main unknown. It can only be resolved by a real deploy and destroy.

## IAM

- The Knowledge Base role keeps: ingestion bucket read on inclusion prefixes, `bedrock:InvokeModel` on the embedding (and optional parsing) model, S3 Vectors data-plane actions, CloudWatch Logs.
- The custom-resource policies (control-plane with `*` resources, `iam:PassRole` for the KB role) are removed along with the custom resources.
- Scope S3 Vectors permissions to the index ARN where the service supports it. Verify against current docs during implementation, and leave a comment if `*` is still required.

## Dependencies

- Bump `aws-cdk-lib` and `aws-cdk` to a release containing `aws_s3vectors` and `S3VectorsConfiguration` in `aws_bedrock`.
- Remove `esbuild` and `@aws-sdk/client-bedrock-agent` if unused after deletion.

## Testing

- Jest test synthesizes the stack and uses `Template.fromStack` to assert resource types and key properties (index dimension and metadata config, KB storage type, no `Custom::AWS`, no Lambda).
- Manual verification: `cdk synth`, then deploy, ingest a sample document, retrieve, and destroy, when credentials are available.

## Alternatives considered

1. **README-only snippet.** Smaller, but unverifiable and likely to drift. Rejected as the primary deliverable. The README will still show a short excerpt of the stack.
2. **Adopt `awslabs/generative-ai-cdk-constructs`.** Higher level, but it is a third-party-maintained dependency (AWS Labs) and would make the repo a wrapper around another library. Mentioned in the README as an alternative.
3. **Deprecate and archive without a rewrite.** Cheapest, but leaves a stale example. May still follow once the rewrite is merged.
