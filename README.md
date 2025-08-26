# Building a Bedrock Knowledge Base with **S3 Vectors** (AWS CDK, TypeScript)

This repository accompanies the blog post **"Bedrock Knowledge Bases with S3 Vectors: A [Preview] CDK Quickstart"** — read the "why" and deeper design notes there:  
PLACEHOLDERIAMPLACEHOLDER

**What this repo gives you:** a reproducible CDK construct that deploys a Bedrock Knowledge Base backed by **Amazon S3 Vectors (preview)** with optional foundation-model parsing and a **teardown finalizer** that deletes resources in the correct order.

---

## Quickstart

> TL;DR for people who just want to see it run.

```bash
# 0) Node & CDK (v2) are installed; AWS credentials configured for target account

git clone https://github.com/MikeORed/building-bedrock-knowledge-base-s3-vectors-aws-cdk.git
cd building-bedrock-knowledge-base-s3-vectors-aws-cdk

npm install
# If this account/region isn't bootstrapped for CDK:
npx cdk bootstrap

# 1) (Optional) Inspect the synthesized template
npx cdk synth

# 2) Deploy (default stack and defaults inside)
npx cdk deploy
```

On success, note the Outputs:

- `KnowledgeBaseId`
- `KnowledgeBaseArn`
- `IngestionBucketName` (upload under `docs/` by default)
- `VectorBucketName` / `VectorIndexName`

⚠️ **Note:** The construct currently does not emit `DataSourceId` as a stack output.  
You can retrieve it after deploy using:

```bash
aws bedrock-agent list-data-sources --knowledge-base-id "$KB_ID" \
  --query "dataSourceSummaries[0].dataSourceId" --output text
```

### Ingest and Query (CLI)

Upload a few docs (PDF/MD/TXT) into `s3://$INGESTION_BUCKET/docs/`.

```bash
# 3) Start ingestion
export KB_ID=[paste from outputs]
export DS_ID=[see "How to get DataSourceId" below]

aws bedrock-agent start-ingestion-job \
  --knowledge-base-id "$KB_ID" \
  --data-source-id "$DS_ID"

# 4) Poll status (until COMPLETED)
export JOB_ID=[returned from start-ingestion-job]
aws bedrock-agent get-ingestion-job \
  --knowledge-base-id "$KB_ID" \
  --data-source-id "$DS_ID" \
  --ingestion-job-id "$JOB_ID"
```

**Vector retrieval only:**

```bash
aws bedrock-agent-runtime retrieve \
  --knowledge-base-id "$KB_ID" \
  --retrieval-query '{"text":"What is pipian sauce?"}' \
  --retrieval-configuration '{"vectorSearchConfiguration":{"numberOfResults":3}}'
```

**RAG (retrieve-and-generate):**

```bash
aws bedrock-agent-runtime retrieve-and-generate \
  --input '{"text":"Summarize pipian sauce in two sentences"}' \
  --retrieve-and-generate-configuration "{
    \"type\":\"KNOWLEDGE_BASE\",
    \"knowledgeBaseConfiguration\":{
      \"knowledgeBaseId\":\"$KB_ID\",
      \"modelArn\":\"arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0\",
      \"retrievalConfiguration\":{\"vectorSearchConfiguration\":{\"numberOfResults\":3}}
    }
  }"
```

**Teardown (safe):**

```bash
# The construct wires a cleanup finalizer to delete resources in order.
npx cdk destroy
```

---

## What gets deployed (Architecture)

```mermaid
flowchart TB
  A[Ingestion S3 Bucket<br/>prefix: docs/]:::aws
  B[[S3 Vectors Bucket]]:::aws
  C[(S3 Vectors Index)]:::aws
  D{{Bedrock Knowledge Base<br/>(VECTOR)}}:::aws
  E[(Data Source: S3<br/>+ chunking + optional parsing)]:::aws
  F{{Cleanup Finalizer<br/>Lambda + CR}}:::aws

  A --> E --> D
  B --> C --> D
  F -.on destroy.-> E -.then.-> D -.then.-> C -.then.-> B

  classDef aws fill:#eef6ff,stroke:#1f6feb,color:#0b3d91,stroke-width:1px;
```

**Construct:** `S3ToS3VectorsKnowledgeBase`  
**Internals:** `S3VectorBucket`, `S3VectorIndex`, `BedrockKnowledgeBase`, `CleanupFinalizer`  
**Utilities:** `infra/util/{models,names,iam}.ts`

---

## Supported Regions & Models (Preview reality)

**S3 Vectors (**Preview Only**, subject to change)** available as of January 2025 in:

- `us-east-1`, `us-east-2`, `us-west-2`, `eu-central-1`, `ap-southeast-2`

**Embedding model & dimension compatibility** (enforced by `validateEmbeddingDims`):

| Model                            | Allowed Dimensions              |
| -------------------------------- | ------------------------------- |
| Titan Embed Text v2              | 256, 512, 1024 (default)        |
| Titan Embed Text v1              | 1536 only                       |
| Other models (if wired manually) | 256/512/1024/1536 (best-effort) |

If you mismatch dims, deployment fails early with a clear error.

---

## How to use the Construct in your own stack

```typescript
// infra/stacks/bedrock-kb-stack.ts
import * as cdk from "aws-cdk-lib";
import { S3ToS3VectorsKnowledgeBase } from "../constructs/s3-to-s3-vectors-knowledge-base";

export class BedrockKnowledgeBaseStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new S3ToS3VectorsKnowledgeBase(this, "BedrockKB", {
      // inclusionPrefixes default: ["docs/"]
      vectorDimension: 1024, // Titan v2 default
      useFoundationParsing: false, // turn on to parse with FM before vectorizing
      deletionBehavior: "DELETE", // or "RETAIN"
      dataDeletionPolicy: "DELETE", // or "RETAIN"
      // Optional: parsingModelArn, parsingPromptText, embeddingModelArn,
      //          knowledgeBaseRole, ingestionBucket, distanceMetric ("cosine"|"euclidean")
      //          embeddingDataType: "FLOAT32" | "BINARY" (KB API uppercased)
    });
  }
}
```

---

## Public Props & Defaults

| Prop                   | Type / Default                       | Notes                                               |
| ---------------------- | ------------------------------------ | --------------------------------------------------- |
| `inclusionPrefixes`    | `string[] = ["docs/"]`               | Where to read objects from the ingestion bucket     |
| `embeddingModelArn`    | `string` (resolved by region)        | Defaults to Titan Embed Text v2 ARN                 |
| `vectorDimension`      | `number = 1024`                      | Must match model (see table)                        |
| `useFoundationParsing` | `boolean = false`                    | If true, uses FM to parse/normalize before chunking |
| `parsingModelArn`      | `string` (resolved by region)        | Defaults to Claude 3 Sonnet ARN                     |
| `parsingPromptText`    | `string \| undefined`                | Custom parsing prompt                               |
| `distanceMetric`       | `"cosine" \| "euclidean" = "cosine"` | S3 Vectors supports cosine/euclidean                |
| `dataType`             | `"float32" = "float32"`              | S3 Vectors vector data type                         |
| `embeddingDataType`    | `"FLOAT32" \| "BINARY" = "FLOAT32"`  | Uppercase for Bedrock API                           |
| `deletionBehavior`     | `"DELETE" \| "RETAIN" = "DELETE"`    | Controls whether finalizer CR executes on destroy   |
| `dataDeletionPolicy`   | `"DELETE" \| "RETAIN" = "DELETE"`    | Passed to DataSource (purge vectors vs keep)        |
| `knowledgeBaseRole`    | `iam.IRole` (optional)               | Provide your own or let construct create one        |
| `ingestionBucket`      | `s3.IBucket` (optional)              | BYO bucket recommended for long-lived docs          |

---

## Deterministic Naming

Names are derived from stack/account/region with an 8-char suffix to avoid collisions:

- `kb-s3vectors-<suffix>`, `ds-s3-<suffix>`, `s3vectors-<suffix>`, `index-<suffix>`
- ingestion bucket: `bedrock-kb-ingestion-<region>-<account>-<suffix>`
- role: `BedrockKB-Role-<suffix>`

Override via `NameOverrides` if needed.

---

## File Layout (what you'll find here)

```
infra/
  constructs/
    s3-to-s3-vectors-knowledge-base.ts   # primary construct
  internal/
    s3-vector-bucket.ts                  # CR: create/delete S3 Vectors bucket
    s3-vector-index.ts                   # CR: create/delete S3 Vectors index
    bedrock-knowledge-base.ts            # CR: create/delete KB (vector-backed)
    cleanup-finalizer.ts                 # Lambda + CR invoked on destroy
  stacks/
    bedrock-kb-stack.ts                  # example stack using the construct
  util/
    models.ts                            # resolve model ARNs, validate dims
    names.ts                             # deterministic names
    iam.ts                               # policy helpers (S3, Bedrock, S3 Vectors, Logs)
src/
  lambda/
    cleanup-handler.ts                   # deletes DS (if 0/1 match) then KB, waits/polls
bin/
  app.ts                                 # CDK app entry point

Generated / Support files:
lib/                                     # compiled JavaScript (generated by `npm run build`)
test/                                    # Jest unit tests
```

---

## Sharp Edges (Preview + Ops Reality)

1. **S3 Vectors is preview:** APIs/permissions can change. This repo pins `AwsCustomResource.installLatestAwsSdk = true` to pick up latest clients at deploy time.

2. **IAM breadth:** S3 Vectors data-plane currently requires `resources: ["*"]` in practice. Tighten when GA supports ARN scoping.

3. **Teardown order:** CloudFormation can't infer the correct order. The finalizer:

   - waits for ingestion jobs to finish
   - deletes DataSource (best-effort name prefix match)
   - deletes Knowledge Base
   - CRs then delete Index → Vector Bucket.

4. **Deletion choices:**

   - `deletionBehavior="DELETE"` → run the Lambda finalizer on destroy.
   - `deletionBehavior="RETAIN"` → skip finalizer; surfaces a CfnOutput warning.
   - `dataDeletionPolicy="RETAIN"` → DataSource keeps vectors; safer for destroy in some cases.

5. **Model/dimension mismatches:** stopped early with clear error text from `validateEmbeddingDims`.

---

## Recipes

### Get the DataSourceId if you didn't capture it

```bash
aws bedrock-agent list-data-sources --knowledge-base-id "$KB_ID" \
  --query "dataSourceSummaries[0].dataSourceId" --output text
```

### Upload docs quickly

```bash
aws s3 cp ./samples/ "s3://$INGESTION_BUCKET/docs/" --recursive
```

### Change to parsing-on (FM pre-processing)

Set `useFoundationParsing: true` in construct props, optionally set `parsingPromptText`. Make sure the parsing model (default: Sonnet) is enabled in the account/region.

### Deploy with RETAIN for safer teardown

```bash
# Deploy with RETAIN for dataDeletionPolicy to avoid destroy failures
npx cdk deploy -c dataDeletionPolicy=RETAIN
```

---

## Troubleshooting

### Ingestion says "filterable metadata too large"

S3 Vectors has limits on filterable metadata size. This construct sets
`metadataConfiguration.nonFilterableMetadataKeys = ["AMAZON_BEDROCK_TEXT"]`
on the index to avoid the large-text field being treated as filterable. This is already handled in the construct, but if you create your own index outside CDK, add this setting.

### Destroy fails with "Unable to delete data from vector store / DataSource"

Use `dataDeletionPolicy="RETAIN"` temporarily, destroy, then manually clean the vector bucket/index if you intend to keep them. Or re-deploy with `deletionBehavior="DELETE"` and let the finalizer orchestrate deletion (ensure no ingestion jobs are running).

### 403 or NotAuthorized on Bedrock calls

Confirm the construct's role has:

- `bedrock:InvokeModel` for embedding (and parsing model if enabled)
- S3 read on the ingestion bucket prefixes
- S3 Vectors data/control-plane (currently `*` resource)

### Model dimension mismatch at deploy

Change `vectorDimension` to the allowed set for your model (see table above).

---

## Security & Costs

- Buckets enforce SSL, AES256 encryption, bucket-owner-enforced ownership, auto-delete objects on stack destroy (when not retained).
- **BYO ingestion bucket recommended** for production workloads with long-lived documents to avoid accidental data loss during stack operations.
- S3 Vectors is low cost but slower; good for dev, test, and many internal workloads. If you're latency-sensitive, plan to migrate to OpenSearch/Aurora later (the Bedrock KB API abstracts the store—your client code won't change).

---

## Local Dev & Contrib

```bash
# lint / build / test (add scripts as you see fit)
npm run build
npm run test
```

Issues & PRs welcome. Preview APIs move—if you see a break, file an issue with your region, error message, and steps to reproduce. Please include your AWS region and Bedrock model/dimension details when filing an issue.

---

## License

MIT
