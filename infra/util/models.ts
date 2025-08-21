/**
 * Utility functions for resolving and validating Bedrock model configurations
 */

/**
 * Resolve the embedding model ARN for the given region
 * @param region AWS region
 * @param override Optional model ARN override
 * @returns Embedding model ARN
 */
export function resolveEmbeddingModelArn(
  region: string,
  override?: string
): string {
  if (override) {
    return override;
  }
  // Default to Titan Embed Text v2
  return `arn:aws:bedrock:${region}::foundation-model/amazon.titan-embed-text-v2:0`;
}

/**
 * Resolve the parsing model ARN for the given region
 * @param region AWS region
 * @param override Optional model ARN override
 * @returns Parsing model ARN
 */
export function resolveParsingModelArn(
  region: string,
  override?: string
): string {
  if (override) {
    return override;
  }
  // Default to Claude 3 Sonnet
  return `arn:aws:bedrock:${region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`;
}

/**
 * Validate embedding model and dimension compatibility
 * @param modelArn The embedding model ARN
 * @param dims The vector dimensions
 * @throws Error if model and dimensions are incompatible
 */
export function validateEmbeddingDims(modelArn: string, dims: number): void {
  // Titan Embed Text v2 supports 256, 512, or 1024 dimensions
  if (modelArn.includes("titan-embed-text-v2")) {
    if (![256, 512, 1024].includes(dims)) {
      throw new Error(
        `Titan Embed Text v2 model supports 256, 512, or 1024 dimensions, but got ${dims}. ` +
          `Please set vectorDimension to one of the supported values.`
      );
    }
    return;
  }

  // Titan Embed Text v1 requires 1536 dimensions
  if (modelArn.includes("titan-embed-text-v1")) {
    if (dims !== 1536) {
      throw new Error(
        `Titan Embed Text v1 model requires 1536 dimensions, but got ${dims}. ` +
          `Please set vectorDimension to 1536 or use a different embedding model.`
      );
    }
    return;
  }

  // General validation for other models - support common dimensions
  const supportedDims = [256, 512, 1024, 1536];
  if (!supportedDims.includes(dims)) {
    throw new Error(
      `vectorDimension must be one of ${supportedDims.join(
        ", "
      )}, but got ${dims}. ` +
        `Ensure your embedding model and vector dimensions are compatible.`
    );
  }
}
