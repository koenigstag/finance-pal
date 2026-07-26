import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { MEMBER_ROLES } from '../authz/ability.js';
import { errorSchema } from '../common/error.schema.js';

const c = initContract();

export const groupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  ownerId: z.string().uuid(),
  archivedAt: z.string().datetime().nullable(),
  role: z.enum(MEMBER_ROLES),
});

// Excludes 'owner' on purpose: promoting a member to owner also has to move Group.ownerId in
// lockstep (see the comment on that column), which is a distinct, not-yet-built
// transferOwnership flow — not a role you can hand out through plain member management.
export const assignableMemberRoleSchema = z.enum(['admin', 'member', 'viewer']);
export type AssignableMemberRole = z.infer<typeof assignableMemberRoleSchema>;

export const memberSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(MEMBER_ROLES),
  joinedAt: z.string().datetime(),
});

export const groupsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/groups',
      responses: { 200: z.array(groupSchema) },
      summary: 'List groups the caller belongs to',
    },
    create: {
      method: 'POST',
      path: '/groups',
      body: z.object({ name: z.string().min(1).max(120) }),
      responses: { 201: groupSchema },
      summary: 'Create a group, with the caller as its owner',
    },
    rename: {
      method: 'PATCH',
      path: '/groups/:groupId',
      pathParams: z.object({ groupId: z.string().uuid() }),
      body: z.object({ name: z.string().min(1).max(120) }),
      responses: {
        200: groupSchema,
        403: errorSchema,
        404: errorSchema,
      },
      summary: 'Rename a group (owner only)',
    },
    archive: {
      method: 'POST',
      path: '/groups/:groupId/archive',
      pathParams: z.object({ groupId: z.string().uuid() }),
      body: z.object({}),
      responses: {
        200: groupSchema,
        403: errorSchema,
        404: errorSchema,
      },
      summary: 'Archive a group, making it read-only (owner only)',
    },
    restore: {
      method: 'POST',
      path: '/groups/:groupId/restore',
      pathParams: z.object({ groupId: z.string().uuid() }),
      body: z.object({}),
      responses: {
        200: groupSchema,
        403: errorSchema,
        404: errorSchema,
      },
      summary: 'Restore an archived group (owner only)',
    },
    seed: {
      method: 'POST',
      path: '/groups/:groupId/seed',
      pathParams: z.object({ groupId: z.string().uuid() }),
      body: z.object({ language: z.string().optional() }),
      responses: {
        201: z.object({ accountsCreated: z.number(), categoriesCreated: z.number() }),
        403: errorSchema,
        404: errorSchema,
        409: errorSchema,
      },
      summary: 'Populate a group with starter accounts/categories from templates (once per group, not viewer)',
    },
    listMembers: {
      method: 'GET',
      path: '/groups/:groupId/members',
      pathParams: z.object({ groupId: z.string().uuid() }),
      responses: { 200: z.array(memberSchema), 404: errorSchema },
      summary: 'List members of a group',
    },
    inviteMember: {
      method: 'POST',
      path: '/groups/:groupId/members',
      pathParams: z.object({ groupId: z.string().uuid() }),
      body: z.object({ email: z.string().email(), role: assignableMemberRoleSchema }),
      responses: {
        201: memberSchema,
        403: errorSchema,
        404: errorSchema,
        409: errorSchema,
      },
      summary: 'Invite an existing user to a group by email (owner/admin only)',
    },
    updateMemberRole: {
      method: 'PATCH',
      path: '/groups/:groupId/members/:userId',
      pathParams: z.object({ groupId: z.string().uuid(), userId: z.string().uuid() }),
      body: z.object({ role: assignableMemberRoleSchema }),
      responses: {
        200: memberSchema,
        403: errorSchema,
        404: errorSchema,
        409: errorSchema,
      },
      summary: "Change a member's role (owner/admin only)",
    },
    removeMember: {
      method: 'DELETE',
      path: '/groups/:groupId/members/:userId',
      pathParams: z.object({ groupId: z.string().uuid(), userId: z.string().uuid() }),
      responses: {
        200: memberSchema,
        403: errorSchema,
        404: errorSchema,
        409: errorSchema,
      },
      summary: 'Remove a member (owner/admin), or leave the group yourself',
    },
  },
  { pathPrefix: '/api' },
);
