import {
  BedrockAgentClient,
  ListDataSourcesCommand,
  GetDataSourceCommand,
  DeleteDataSourceCommand,
  ListIngestionJobsCommand,
  GetKnowledgeBaseCommand,
  DeleteKnowledgeBaseCommand,
} from "@aws-sdk/client-bedrock-agent";

interface CleanupEvent {
  /** Required: Knowledge Base ID to clean up */
  knowledgeBaseId: string;

  /** Optional: DataSource name prefix for matching */
  dataSourceNamePrefix?: string;

  /** Optional: AWS region (defaults to AWS_REGION env var) */
  region?: string;

  /** Optional: Polling interval in seconds (default: 5) */
  pollSeconds?: number;

  /** Optional: Maximum cleanup time in minutes (default: 15) */
  maxMinutes?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffDelay(attempt: number, baseMs = 1000, maxMs = 10000): number {
  // Exponential backoff with jitter
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  return Math.floor(exp * (0.5 + Math.random() * 0.5));
}

async function waitUntil<T>(
  fn: () => Promise<T>,
  predicate: (result: T) => boolean,
  deadlineMs: number,
  description: string
): Promise<T> {
  let attempt = 0;
  const nowMs = () => Date.now();

  while (nowMs() < deadlineMs) {
    try {
      const result = await fn();
      if (predicate(result)) {
        return result;
      }
    } catch (error) {
      console.log(`Attempt ${attempt + 1} failed for ${description}: ${error}`);
    }

    attempt++;
    const delayMs = backoffDelay(attempt);
    console.log(
      `Waiting ${delayMs}ms before retry ${attempt + 1} for ${description}`
    );
    await sleep(delayMs);
  }

  throw new Error(`Timeout waiting for ${description}`);
}

// Tolerate "not found" errors during deletion (idempotent)
const isNotFoundError = (error: any): boolean => {
  const message = (error?.message || error?.name || "").toLowerCase();
  return (
    message.includes("not found") ||
    message.includes("notfound") ||
    message.includes("resourcenotfound")
  );
};

async function resolveDataSourceId(
  client: BedrockAgentClient,
  knowledgeBaseId: string,
  namePrefix?: string
): Promise<string | undefined> {
  try {
    const response = await client.send(
      new ListDataSourcesCommand({ knowledgeBaseId })
    );

    const dataSources = response.dataSourceSummaries || [];

    if (namePrefix) {
      // Find data source matching the prefix
      const matching = dataSources.filter((ds: any) =>
        ds.name?.startsWith(namePrefix)
      );

      if (matching.length === 1) {
        return matching[0].dataSourceId;
      } else if (matching.length > 1) {
        console.log(
          `Multiple data sources match prefix "${namePrefix}", skipping data source deletion`
        );
        return undefined;
      } else {
        console.log(`No data source found matching prefix "${namePrefix}"`);
        return undefined;
      }
    } else {
      // No prefix provided - return single data source if exactly one exists
      if (dataSources.length === 1) {
        return dataSources[0].dataSourceId;
      } else if (dataSources.length > 1) {
        console.log(
          `Multiple data sources found without prefix, skipping data source deletion`
        );
        return undefined;
      } else {
        console.log(`No data sources found`);
        return undefined;
      }
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      console.log(
        `Knowledge Base not found during data source resolution: ${error}`
      );
      return undefined;
    }
    throw error;
  }
}

export const handler = async (
  event: CleanupEvent
): Promise<{ ok: boolean }> => {
  console.log(`Starting cleanup for Knowledge Base: ${event.knowledgeBaseId}`);
  console.log(`Event:`, JSON.stringify(event, null, 2));

  // Validate required parameters
  if (!event.knowledgeBaseId) {
    throw new Error("knowledgeBaseId is required");
  }

  // Initialize BedrockAgentClient
  const region =
    event.region ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-east-1";

  const client = new BedrockAgentClient({ region });

  // Set up timeout deadline
  const nowMs = () => Date.now();
  const maxMinutes = event.maxMinutes ?? 15;
  const deadlineMs = nowMs() + maxMinutes * 60_000;

  try {
    // Step 1: Resolve DataSource ID (best-effort matching)
    const dataSourceId = await resolveDataSourceId(
      client,
      event.knowledgeBaseId,
      event.dataSourceNamePrefix
    );

    console.log(`DataSource ID resolved: ${dataSourceId || "none"}`);

    // Step 2: Wait for ingestion jobs to complete (if DataSource exists)
    if (dataSourceId) {
      console.log(`Waiting for ingestion jobs to complete...`);
      await waitUntil(
        async () => {
          const jobs = await client.send(
            new ListIngestionJobsCommand({
              knowledgeBaseId: event.knowledgeBaseId,
              dataSourceId,
            })
          );
          const hasActiveJobs = (jobs.ingestionJobSummaries ?? []).some(
            (job: any) => job.status === "IN_PROGRESS"
          );
          return { active: hasActiveJobs };
        },
        (result) => !result.active,
        deadlineMs,
        "ingestion jobs to complete"
      );
      console.log(`All ingestion jobs completed`);

      // Step 3: Delete DataSource and poll until NotFound
      console.log(`Deleting DataSource: ${dataSourceId}`);
      try {
        await client.send(
          new DeleteDataSourceCommand({
            knowledgeBaseId: event.knowledgeBaseId,
            dataSourceId,
          })
        );
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error; // Re-throw non-tolerable errors
        }
        console.log(
          `DataSource deletion tolerated error: ${(error as any)?.message}`
        );
      }

      // Wait for DataSource deletion confirmation
      await waitUntil(
        async () => {
          try {
            await client.send(
              new GetDataSourceCommand({
                knowledgeBaseId: event.knowledgeBaseId,
                dataSourceId,
              })
            );
            return { gone: false }; // Still exists
          } catch (error) {
            if (isNotFoundError(error)) {
              return { gone: true }; // Successfully deleted
            }
            return { gone: false }; // Transient error, not gone yet
          }
        },
        (result) => result.gone,
        deadlineMs,
        "data source deletion"
      );
      console.log(`DataSource deleted successfully`);
    }

    // Step 4: Delete KnowledgeBase and poll until NotFound
    console.log(`Deleting Knowledge Base: ${event.knowledgeBaseId}`);
    try {
      await client.send(
        new DeleteKnowledgeBaseCommand({
          knowledgeBaseId: event.knowledgeBaseId,
        })
      );
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error; // Re-throw non-tolerable errors
      }
      console.log(
        `Knowledge Base deletion tolerated error: ${(error as any)?.message}`
      );
    }

    // Wait for Knowledge Base deletion confirmation
    await waitUntil(
      async () => {
        try {
          await client.send(
            new GetKnowledgeBaseCommand({
              knowledgeBaseId: event.knowledgeBaseId,
            })
          );
          return { gone: false }; // Still exists
        } catch (error) {
          if (isNotFoundError(error)) {
            return { gone: true }; // Successfully deleted
          }
          return { gone: false }; // Transient error, not gone yet
        }
      },
      (result) => result.gone,
      deadlineMs,
      "knowledge base deletion"
    );
    console.log(`Knowledge Base deleted successfully`);

    // Step 5: Return success indicator
    console.log(`Cleanup completed successfully`);
    return { ok: true };
  } catch (error) {
    console.error(`Cleanup failed: ${error}`);
    // Always return success indicator for CloudFormation to avoid rollback issues
    // The actual error will be logged for debugging
    return { ok: true };
  }
};
