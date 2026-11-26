# Tasks: Replace custom resources with native CDK/CloudFormation resources

- [ ] 1. Upgrade dependencies
  - [ ] 1.1 Identify the `aws-cdk-lib` version that includes `aws_s3vectors` and Bedrock `S3VectorsConfiguration`; bump `aws-cdk-lib` and `aws-cdk`
  - [ ] 1.2 Run `npm install`, update `package-lock.json`, confirm `npm run build` still passes
  - _Requirements: 3.1, 3.3_

- [ ] 2. Replace the vector store resources
  - [ ] 2.1 Create the vector bucket with `s3vectors.CfnVectorBucket`
  - [ ] 2.2 Create the index with `s3vectors.CfnIndex` (dimension, distance metric, data type, `nonFilterableMetadataKeys`)
  - [ ] 2.3 Create the Knowledge Base with `bedrock.CfnKnowledgeBase` using `S3_VECTORS` and GetAtt ARNs
  - [ ] 2.4 Keep `CfnDataSource`, wired to the new Knowledge Base
  - _Requirements: 1.1 to 1.6_

- [ ] 3. Rework the construct
  - [ ] 3.1 Update `S3ToS3VectorsKnowledgeBase` to use the L1 resources directly
  - [ ] 3.2 Keep model and dimension validation, ingestion bucket defaults, BYO bucket and role options, FM parsing and `dataDeletionPolicy`
  - [ ] 3.3 Decide whether to keep deterministic names or use generated names; update `util/names.ts` accordingly
  - [ ] 3.4 Trim `util/iam.ts` to what the Knowledge Base role needs; scope S3 Vectors permissions where supported
  - [ ] 3.5 Update stack outputs; add `DataSourceId`
  - _Requirements: 4.1 to 4.6_

- [ ] 4. Remove the old implementation
  - [ ] 4.1 Delete `infra/internal/` and `src/lambda/cleanup-handler.ts`
  - [ ] 4.2 Remove unused dependencies (`esbuild`, `@aws-sdk/client-bedrock-agent`) after confirming no other use
  - [ ] 4.3 Remove `deletionBehavior` and finalizer-related props if no longer meaningful
  - _Requirements: 1.6, 2.1, 3.2_
  - Blocked by 5 if teardown testing shows a finalizer is still required

- [ ] 5. Verify teardown
  - [ ] 5.1 Deploy the stack, ingest a sample document, run a retrieval
  - [ ] 5.2 Run `cdk destroy` and confirm it completes without manual steps
  - [ ] 5.3 If destroy fails, record the failure, apply the documented mitigation, and update the design and README
  - [ ] 5.4 If credentials are unavailable, state in the PR that teardown is untested
  - _Requirements: 2.2 to 2.4_

- [ ] 6. Update tests
  - [ ] 6.1 Replace the existing Jest test with `Template.fromStack` assertions: `AWS::S3Vectors::VectorBucket`, `AWS::S3Vectors::Index`, `AWS::Bedrock::KnowledgeBase`, `AWS::Bedrock::DataSource`
  - [ ] 6.2 Assert index dimension and `nonFilterableMetadataKeys`, KB storage type `S3_VECTORS`, and absence of `Custom::AWS` and the finalizer Lambda
  - [ ] 6.3 Run `npm run build`, `npx cdk synth`, `npm test`
  - _Requirements: 6.1 to 6.3_

- [ ] 7. Update documentation
  - [ ] 7.1 Remove preview framing, finalizer and custom-resource sections; refresh region and model notes
  - [ ] 7.2 Update file layout, architecture diagram, props table and troubleshooting
  - [ ] 7.3 Link the first-party constructs and mention `awslabs/generative-ai-cdk-constructs`
  - _Requirements: 5.1 to 5.4_

- [ ] 8. Wrap up
  - [ ] 8.1 Open the implementation PR, listing what was and was not verified
  - [ ] 8.2 Maintainer follow-ups (outside this spec): update the blog post, consider archiving
