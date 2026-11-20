import { createParamDecorator, type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { hasFinanceAccess, hasPermission } from '@botss/auth';

import type { UserScope } from '../common/decorators/user-scope.decorator';
import type { RequestExtensions } from '../common/guards/auth.guard';
import { abilityForRequest } from '../common/permissions/request-ability';
import { requestPermissions } from '../common/permissions/effective-permissions';
import type { LinkAccess, MeetingActor } from './meeting-rules';

/** The signed-in person acting on meetings (their own organization, never a role-based widening). */
export const CurrentMeetingActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): MeetingActor => {
    const req = ctx.switchToHttp().getRequest<RequestExtensions>();
    if (!req.user) {
      throw new ForbiddenException({
        title: 'Forbidden',
        status: 403,
        detail: 'No authenticated user on request.',
      });
    }
    return {
      userId: req.user.id,
      organizationId: req.user.organizationId,
      name: req.user.name || req.user.email,
      email: req.user.email,
      workspaceId: req.workspaceId ?? null,
    };
  },
);

/**
 * What the caller may link a meeting to: leads, clients and projects of the
 * ACTIVE workspace under the same rules as their own pages (CASL read plus
 * the per-record visibility). Null without an active workspace. Used with
 * `@RequestUserScope()` for the project rule.
 */
export function linkAccessFor(req: RequestExtensions, scope: UserScope): LinkAccess | null {
  if (!req.user || !req.workspaceId || req.workspaceId !== scope.currentWorkspaceId) return null;
  const eff = requestPermissions(req);
  const ability = abilityForRequest(req);
  return {
    userId: req.user.id,
    workspaceId: req.workspaceId,
    scope,
    canReadLeads: ability.can('read', 'Lead'),
    fullLeads: hasPermission(eff, 'sales.leads.all'),
    canReadClients: ability.can('read', 'Client'),
    fullClients: hasPermission(eff, 'sales.clients.all'),
    financeAccess: hasFinanceAccess({ permissions: eff }),
    canReadProjects: ability.can('read', 'Project'),
  };
}
