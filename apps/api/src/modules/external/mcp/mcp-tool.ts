import { HttpException, type Logger } from '@nestjs/common';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { externalAmountSchema, isValidTimezone, type ApiKeyScope } from '@ft/shared-contracts';
import type { RequestApiKey } from '../../_core/authn/request-user';
import type { CurrencyCodes } from '../external-lookup.service';
import { named } from '../references';

// What the MCP endpoint's tools share: who is asking, how a call's answer is put, and how a call
// names what it's about.

/** A request an assistant made that can't be read, said so it can ask again. */
export class ToolInputError extends Error {}

/** Who is asking, and in what terms their answers are given. */
export interface McpContext {
  apiKey: RequestApiKey;
  groupName: string;
  // The key's, or UTC for a key that has none.
  timeZone: string;
  // The key owner's: what reports are converted into. Null before they've set up their profile.
  mainCurrencyId: number | null;
  manualRates: Record<string, string> | null;
  currencies: CurrencyCodes;
}

export function can(context: McpContext, scope: ApiKeyScope): boolean {
  return context.apiKey.scopes.includes(scope);
}

// MCP's tool annotations, which an assistant reads to decide what to check with the person first.
// Nothing here reaches outside the group, so none of them is open-world.
// Reads change nothing and answer the same when asked twice.
export const READS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
// Adds something new, and adds it again when asked twice.
export const ADDS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
// Changes what's there; asked twice, the second call finds it changed already.
export const CHANGES = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;
// Deletes, which the app can't undo.
export const DELETES = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

export const timeZoneArg = z
  .string()
  .optional()
  .describe("An IANA time zone, like Europe/Kyiv, to count calendar days in. Left out, the key's own.");
export const monthArg = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .optional()
  .describe('A calendar month, YYYY-MM. Left out, the current one.');
export const dayArg = (edge: string) =>
  z.string().optional().describe(`${edge}, as YYYY-MM-DD (the whole day counts) or a date and time with an offset`);
// As other apps send amounts: a number, or text the way a bank prints it.
export const amountArg = z.union([z.string(), z.number()]);

/**
 * A tool's handler: its answer as JSON text, or the reason it couldn't give one as a tool error,
 * which the assistant reads and can act on. Anything unexpected is logged here and not described.
 */
export function toolHandler(logger: Logger) {
  return <A>(run: (args: A) => Promise<unknown>) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await run(args)) }] };
      } catch (error) {
        if (error instanceof ToolInputError || (error instanceof HttpException && error.getStatus() < 500)) {
          return { isError: true, content: [{ type: 'text', text: error.message }] };
        }
        logger.error(error instanceof Error ? error.stack : error);
        return { isError: true, content: [{ type: 'text', text: 'Something went wrong on the server; try again later.' }] };
      }
    };
}

/** A tool call's time zone: the one it names, or the key's. */
export function timeZoneOf(context: McpContext, requested: string | undefined): string {
  if (requested === undefined) {
    return context.timeZone;
  }
  if (!isValidTimezone(requested)) {
    throw new ToolInputError(`"${requested}" isn't a time zone: expected an IANA name, like Europe/Kyiv`);
  }
  return requested;
}

/** An amount as the ledger takes it ("1250.50"), from however the call put it. */
export function amountOf(value: string | number, field = 'amount'): string {
  const parsed = externalAmountSchema.safeParse(value);
  if (!parsed.success) {
    throw new ToolInputError(`${field}: ${parsed.error.issues[0]?.message ?? 'not an amount'}`);
  }
  return parsed.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reference as the external API's bodies take it: the id when it is one, the name otherwise. */
export function idOrName(value: string): { id?: string; name?: string } {
  return UUID.test(value) ? { id: value } : { name: value };
}

/**
 * The account or category a call names: by id, or by name as the app compares names (case and
 * surrounding spaces aside, active ones before archived ones). A name a top-level category shares
 * with a subcategory means the category.
 */
export function findByNameOrId<T extends { id: string; name: string; archived: boolean; parentId?: string | null }>(
  items: T[],
  value: string,
  what: 'account' | 'category',
): T {
  const byId = items.find((item) => item.id === value);
  if (byId) {
    return byId;
  }
  const matches = named(items, value);
  const topLevel = matches.filter((item) => item.parentId === null);
  const picked = topLevel.length === 1 ? topLevel : matches;
  if (picked.length === 1) {
    return picked[0];
  }
  if (picked.length === 0) {
    throw new ToolInputError(`No ${what} is named "${value}"`);
  }
  throw new ToolInputError(`More than one ${what} is named "${value}"; pass one of their ids: ${picked.map((item) => item.id).join(', ')}`);
}
