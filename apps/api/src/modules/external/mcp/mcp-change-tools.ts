import { Injectable, Logger } from '@nestjs/common';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodTypeAny } from 'zod';
import { diffOf, undoDiffOf, type TouchedRow } from '../changes/change-rows';
import { ChangeSetsService, UNDO_DAYS, UndoBlockedError } from '../changes/change-sets.service';
import { localDateTime } from './mcp-dates';
import {
  CHANGES,
  READS,
  ToolInputError,
  textOf,
  toolAnswer,
  toolError,
  toolHandler,
  type CollectedTool,
  type McpContext,
  type ToolRegistry,
} from './mcp-tool';

const MAX_STEPS = 50;
// An answer lists this many rows of what a change did, and counts the rest.
const MAX_DIFF_ROWS = 100;

/**
 * How the MCP endpoint's writes are kept, so they can be taken back: each write tool runs as a
 * change of its own, answered with its changeId, and apply_changes runs several at once, all or
 * nothing, or tries them out with dryRun. list_changes and undo_changes find a change and put
 * back what it did. Undoing takes the scopes the change's tools needed, which the key still has
 * to have; the tools only come with a key that may write something.
 */
@Injectable()
export class McpChangeTools {
  private readonly logger = new Logger('McpTools');
  private readonly tool = toolHandler(this.logger);

  constructor(private readonly changes: ChangeSetsService) {}

  register(server: ToolRegistry, context: McpContext, writeTools: CollectedTool[]): void {
    for (const tool of writeTools) {
      server.registerTool(tool.name, tool.config, (args: Record<string, unknown>) => this.single(context, tool, args));
    }
    if (writeTools.length === 0) {
      return;
    }
    this.applyChanges(server, context, writeTools);
    this.listChanges(server, context);
    this.undoChanges(server, context, new Set(writeTools.map((tool) => tool.name)));
  }

  // One write tool call, kept as a change of its own: its answer, with the change's id.
  private async single(context: McpContext, tool: CollectedTool, args: Record<string, unknown>): Promise<CallToolResult> {
    try {
      const { result, changeId } = await this.changes.record(context.apiKey, { steps: [{ tool: tool.name, args }] }, () => runStep(tool, args));
      return toolAnswer(changeId ? { ...result, changeId } : result);
    } catch (error) {
      return error instanceof StepFailed ? error.result : toolError(this.logger, error);
    }
  }

  private applyChanges(server: ToolRegistry, context: McpContext, writeTools: CollectedTool[]): void {
    const steps = writeTools.map((tool) => z.object({ tool: z.literal(tool.name), ...tool.config.inputSchema }));
    const step: ZodTypeAny =
      steps.length === 1 ? steps[0] : z.discriminatedUnion('tool', steps as [(typeof steps)[number], (typeof steps)[number], ...(typeof steps)[number][]]);
    const byName = new Map(writeTools.map((tool) => [tool.name, tool]));
    server.registerTool(
      'apply_changes',
      {
        title: 'Make several changes at once',
        description:
          'Make several changes together, all or nothing. Each step is one of the other tools that change things, named in ' +
          "tool, with that tool's own arguments beside it. Steps run in order, and each sees what the ones before it made: " +
          'name an account or category an earlier step added by its name. If any step fails, nothing at all is changed, and ' +
          'the answer says which step failed and why. With dryRun, the steps are made and then rolled back: the answer shows ' +
          'exactly what they would do, and nothing is kept (ids in it never come to exist). Check a larger change with dryRun ' +
          'first. A kept batch answers with a changeId that undo_changes takes back. diff lists every row the change touched, ' +
          "what it took along included: a series' next payment, amounts the app worked out again, what a deleted category left " +
          'uncategorized.',
        inputSchema: {
          steps: z.array(step).min(1).max(MAX_STEPS).describe(`Up to ${MAX_STEPS}, run in this order`),
          dryRun: z.boolean().optional().describe('Make the changes, show what they did, and roll them all back'),
          description: z.string().max(200).optional().describe('What the change is for, in a few words: list_changes shows it'),
        },
        annotations: CHANGES,
      },
      this.tool(async (args: { steps: Record<string, unknown>[]; dryRun?: boolean; description?: string }) => {
        const dryRun = args.dryRun ?? false;
        const asked = args.steps.map(({ tool, ...rest }) => ({ tool: String(tool), args: rest }));
        try {
          const recorded = await this.changes.record(context.apiKey, { steps: asked, description: args.description, dryRun }, async () => {
            const results: Record<string, unknown>[] = [];
            for (const [index, { tool, args: stepArgs }] of asked.entries()) {
              const found = byName.get(tool) as CollectedTool;
              try {
                results.push({ step: index + 1, tool, ...(await runStep(found, stepArgs)) });
              } catch (error) {
                throw error instanceof StepFailed ? new BatchFailed(index + 1, tool, textOf(error.result)) : error;
              }
            }
            return results;
          });
          return {
            ...(dryRun ? { dryRun: true, kept: false } : { changeId: recorded.changeId }),
            results: recorded.result,
            ...diffAnswer(recorded.touched, diffOf),
          };
        } catch (error) {
          if (error instanceof BatchFailed) {
            throw new ToolInputError(`Step ${error.step} (${error.tool}) failed, so nothing was changed: ${error.message}`);
          }
          throw error;
        }
      }),
    );
  }

  private listChanges(server: ToolRegistry, context: McpContext): void {
    server.registerTool(
      'list_changes',
      {
        title: 'List changes made here',
        description:
          `The changes this group's member who connected you made through apps with API keys over the last ${UNDO_DAYS} days, ` +
          'newest first: yours, and other apps\' they connected (source names the app). Each tool call that changed ' +
          'something is one change, and so is each apply_changes batch. undo_changes takes one back by its changeId.',
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional().describe('How many; 20 when left out'),
        },
        annotations: READS,
      },
      this.tool(async ({ limit }: { limit?: number }) => {
        const changes = await this.changes.list(context.apiKey, limit ?? 20);
        return {
          timeZone: context.timeZone,
          changes: changes.map(({ changeSet, rows }) => ({
            changeId: changeSet.id,
            madeAt: localDateTime(changeSet.createdAt, context.timeZone),
            source: changeSet.source,
            ...(changeSet.description && { description: changeSet.description }),
            tools: changeSet.steps.map((step) => step.tool),
            rowsTouched: rows,
            undone: changeSet.undoneAt ? localDateTime(changeSet.undoneAt, context.timeZone) : null,
          })),
        };
      }),
    );
  }

  private undoChanges(server: ToolRegistry, context: McpContext, writeTools: Set<string>): void {
    server.registerTool(
      'undo_changes',
      {
        title: 'Undo a change',
        description:
          'Take back one change, a tool call or an apply_changes batch, by its changeId: every row it touched goes back to how ' +
          'it was, all of them or none. Refused when something it touched was changed since (by the person, by the app, or by ' +
          'a later change: undo that one first), or when a transaction it planned has happened since. With dryRun, shows what ' +
          `undoing would do and keeps nothing. A change can be undone once, within ${UNDO_DAYS} days, and only with the ` +
          'permissions its tools needed.',
        inputSchema: {
          changeId: z.string().uuid().describe('From a tool\'s answer, or list_changes'),
          dryRun: z.boolean().optional().describe('Show what undoing would do, and keep nothing'),
        },
        annotations: CHANGES,
      },
      this.tool(async ({ changeId, dryRun }: { changeId: string; dryRun?: boolean }) => {
        try {
          const { changeSet, touched } = await this.changes.undo(context.apiKey, changeId, {
            dryRun: dryRun ?? false,
            mayUndo: (tool) => writeTools.has(tool),
          });
          return {
            ...(dryRun ? { dryRun: true, kept: false } : { undone: true }),
            change: {
              changeId: changeSet.id,
              madeAt: localDateTime(changeSet.createdAt, context.timeZone),
              source: changeSet.source,
              ...(changeSet.description && { description: changeSet.description }),
              tools: changeSet.steps.map((step) => step.tool),
            },
            ...diffAnswer(touched, undoDiffOf),
          };
        } catch (error) {
          if (error instanceof UndoBlockedError) {
            const lines = error.blockers
              .slice(0, 20)
              .map((blocker) => `- ${blocker.what} ${blocker.label ? `"${blocker.label}" ` : ''}(${blocker.id}): ${blocker.reason}`);
            const more = error.blockers.length > 20 ? [`- and ${error.blockers.length - 20} more`] : [];
            throw new ToolInputError(['Nothing was undone: the change can’t be taken back as things are now.', ...lines, ...more].join('\n'));
          }
          throw error;
        }
      }),
    );
  }
}

// A step's own answer, or StepFailed with its error: a batch stops at it, and a change is rolled back.
async function runStep(tool: CollectedTool, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await tool.handler(args);
  if (result.isError) {
    throw new StepFailed(result);
  }
  return JSON.parse(textOf(result)) as Record<string, unknown>;
}

function diffAnswer(touched: TouchedRow[], describe: (row: TouchedRow) => ReturnType<typeof diffOf>) {
  return {
    diff: touched.slice(0, MAX_DIFF_ROWS).map(describe),
    ...(touched.length > MAX_DIFF_ROWS && { moreRows: touched.length - MAX_DIFF_ROWS }),
  };
}

class StepFailed extends Error {
  constructor(readonly result: CallToolResult) {
    super(textOf(result));
  }
}

class BatchFailed extends Error {
  constructor(
    readonly step: number,
    readonly tool: string,
    message: string,
  ) {
    super(message);
  }
}
