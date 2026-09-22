import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorSchema } from '../common/error.schema.js';

const c = initContract();

/**
 * A group's rule for filing what bank notifications record: a piece of text, and the category a
 * transaction goes in when the shop's name contains it ("Uklon" → Taxi). Names are compared
 * without regard to case, spacing or how an i is written. When several rules' texts are in one
 * name, the longest text wins ("Uber Eats" over "Uber"), and between equals the oldest rule.
 * A rule only files transactions of its category's type, and not into an archived category.
 */
export const categoryRuleSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  // As it was typed.
  pattern: z.string(),
  // A top-level category or a subcategory, which files under its parent as well.
  categoryId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const categoryRulePatternSchema = z.string().trim().min(1).max(120);

const createCategoryRuleBodySchema = z.object({
  pattern: categoryRulePatternSchema,
  categoryId: z.string().uuid(),
});

const groupPathParams = z.object({ groupId: z.string().uuid() });
const rulePathParams = z.object({ groupId: z.string().uuid(), ruleId: z.string().uuid() });

export const categoryRulesContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/groups/:groupId/category-rules',
      pathParams: groupPathParams,
      responses: { 200: z.array(categoryRuleSchema), 404: errorSchema },
      summary: "A group's category rules, alphabetically by their text",
    },
    create: {
      method: 'POST',
      path: '/groups/:groupId/category-rules',
      pathParams: groupPathParams,
      body: createCategoryRuleBodySchema,
      responses: { 201: categoryRuleSchema, 400: errorSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Add a category rule; a text another rule of the group has already is refused',
    },
    update: {
      method: 'PATCH',
      path: '/groups/:groupId/category-rules/:ruleId',
      pathParams: rulePathParams,
      body: createCategoryRuleBodySchema.partial(),
      responses: { 200: categoryRuleSchema, 400: errorSchema, 403: errorSchema, 404: errorSchema },
      summary: "Change a category rule's text or category",
    },
    remove: {
      method: 'DELETE',
      path: '/groups/:groupId/category-rules/:ruleId',
      pathParams: rulePathParams,
      responses: { 200: categoryRuleSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Delete a category rule; what it filed stays where it is',
    },
  },
  { pathPrefix: '/api' },
);
