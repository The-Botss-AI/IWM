import { randomBytes } from 'node:crypto';

import type { FormField, FormInternalAccess, FormStatus } from '@botss/shared-types';

import type { UserScope } from '../common/decorators/user-scope.decorator';

/**
 * Pure access and policy rules for the form builder. Kept free of Prisma so
 * `scripts/check-forms.ts` can exercise every branch directly.
 */

export interface FormAccessFacts {
  workspaceId: string;
  createdById: string;
  status: FormStatus;
  publishedVersion: number;
  internalAccess: FormInternalAccess;
}

/** A member of the active workspace (outside project collaborators are not). */
export function isWorkspaceMember(scope: UserScope, workspaceId: string): boolean {
  return scope.currentWorkspaceId === workspaceId && scope.workspaceIds.includes(workspaceId);
}

/**
 * Owner, or an admin: a full workspace admin (OWNER / ADMIN preset) or an org
 * admin (`workspaces.admin_all`). `seesEveryProject` is the one definition of
 * "admin" in this codebase. Only these may edit, share or read responses.
 */
export function canManageForm(scope: UserScope, form: FormAccessFacts): boolean {
  if (scope.currentWorkspaceId !== form.workspaceId) return false;
  if (scope.seesEveryProject) return true;
  return form.createdById === scope.userId && isWorkspaceMember(scope, form.workspaceId);
}

/** May open the in-app fill page (whether it currently accepts answers is `formOpenState`). */
export function canFillForm(
  scope: UserScope,
  form: FormAccessFacts,
  hasAccessRow: boolean,
): boolean {
  if (form.status === 'DRAFT' || form.publishedVersion < 1) return false;
  if (canManageForm(scope, form)) return true;
  if (!isWorkspaceMember(scope, form.workspaceId)) return false;
  if (form.internalAccess === 'WORKSPACE') return true;
  return form.internalAccess === 'SELECTED' && hasAccessRow;
}

export type FormClosedReason = 'not_published' | 'closed' | 'past_close_date' | 'limit_reached';

/** Whether the form accepts a new answer right now. */
export function formOpenState(
  form: {
    status: FormStatus;
    publishedVersion: number;
    closesAt: Date | null;
    responseLimit: number | null;
  },
  liveSubmissionCount: number,
  now: Date,
): { open: true } | { open: false; reason: FormClosedReason } {
  if (form.status === 'DRAFT' || form.publishedVersion < 1)
    return { open: false, reason: 'not_published' };
  if (form.status === 'CLOSED') return { open: false, reason: 'closed' };
  if (form.closesAt && form.closesAt.getTime() <= now.getTime())
    return { open: false, reason: 'past_close_date' };
  if (form.responseLimit !== null && liveSubmissionCount >= form.responseLimit) {
    return { open: false, reason: 'limit_reached' };
  }
  return { open: true };
}

export const CLOSED_MESSAGES: Record<FormClosedReason, string> = {
  not_published: 'This form is not published yet.',
  closed: 'This form is closed and no longer accepts answers.',
  past_close_date: 'This form is closed and no longer accepts answers.',
  limit_reached: 'This form has reached its response limit.',
};

/**
 * The rate-limit identity of a client address: the IPv4 address itself, or
 * the /64 network of an IPv6 address (one subscriber usually holds a whole
 * /64, so per-address limits would be trivial to rotate around).
 */
export function ipRateKey(ip: string): string {
  const v = ip
    .trim()
    .toLowerCase()
    .replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  if (!v.includes(':')) return v;
  const [head = '', tail = ''] = v.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = v.includes('::')
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/** 24 url-safe characters (144 bits). Matches `formPublicTokenSchema`. */
export function newPublicToken(): string {
  return randomBytes(18).toString('base64url');
}

/** Every form answer object lives under its form's prefix in the workspace. */
export function formUploadPrefix(workspaceId: string, formId: string): string {
  return `workspaces/${workspaceId}/forms/${formId}/`;
}

export function formUploadKey(workspaceId: string, formId: string, safeName: string): string {
  return `${formUploadPrefix(workspaceId, formId)}${randomBytes(12).toString('base64url')}-${safeName}`;
}

const MB = 1024 * 1024;

export interface UploadPolicy {
  maxBytes: number;
  accepts: (mimeType: string, fileName: string) => boolean;
}

function matchesAccept(list: readonly string[], mimeType: string, fileName: string): boolean {
  if (list.length === 0) return true;
  const mime = mimeType.toLowerCase();
  const name = fileName.toLowerCase();
  return list.some((raw) => {
    const a = raw.trim().toLowerCase();
    if (!a) return false;
    if (a.startsWith('.')) return name.endsWith(a);
    if (a.endsWith('/*')) return mime.startsWith(a.slice(0, -1));
    return mime === a;
  });
}

/**
 * What an upload for this field may be. Null when the field takes no files.
 * `hardCap` is the deployment-wide MAX_UPLOAD_BYTES.
 */
export function uploadPolicy(field: FormField, hardCap: number): UploadPolicy | null {
  const cap = (n: number): number => Math.min(n, hardCap);
  switch (field.type) {
    case 'file_upload':
      return {
        maxBytes: cap(field.maxSizeMb * MB),
        accepts: (m, n) => matchesAccept(field.accept, m, n),
      };
    case 'image_upload':
      return {
        maxBytes: cap(field.maxSizeMb * MB),
        accepts: (m) => /^image\/[a-z0-9.+-]+$/i.test(m),
      };
    case 'signature':
      return { maxBytes: cap(2 * MB), accepts: (m) => m === 'image/png' };
    case 'audio_recording':
      return { maxBytes: cap(50 * MB), accepts: (m) => /^audio\/[a-z0-9.+-]+(;.*)?$/i.test(m) };
    case 'video_recording':
      return { maxBytes: cap(200 * MB), accepts: (m) => /^video\/[a-z0-9.+-]+(;.*)?$/i.test(m) };
    default:
      return null;
  }
}
