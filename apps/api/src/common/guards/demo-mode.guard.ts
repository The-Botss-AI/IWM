import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { demoBlockReason, demoModeForbidden, isDemoMode } from '../demo-mode';

/**
 * Refuses the actions a public demo turns off (DEMO_BLOCKED_ROUTES in
 * common/demo-mode.ts) with a 403 `demo-mode` problem. Runs after body
 * parsing, so rules can look at what a request asks to change. A no-op
 * unless DEMO_MODE=true.
 */
@Injectable()
export class DemoModeGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!isDemoMode() || ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const reason = demoBlockReason(req.method, req.path, req.body);
    if (reason) throw demoModeForbidden(reason);
    return true;
  }
}
