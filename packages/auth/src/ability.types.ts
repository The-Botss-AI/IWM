import type { Ability } from '@casl/ability';

export type AppSubject =
  | 'User'
  | 'Workspace'
  | 'WorkspaceMembership'
  | 'Project'
  | 'ProjectMembership'
  | 'Task'
  | 'Lead'
  | 'Client'
  | 'Document'
  | 'FileObject'
  // E-signature requests. Workspace-scoped like Document; the service limits
  // send/cancel to the request's creator or a workspace OWNER/ADMIN.
  | 'SignatureRequest'
  // Form builder. Workspace-scoped; FormsService limits edit, share and
  // responses to the form's creator or a workspace / org admin.
  | 'Form'
  // HR / Attendance. Org-level subjects gated by SystemRole
  // (ADMIN / HR) rather than workspace role.
  | 'Attendance'
  | 'Leave'
  // Financials. Org-level subjects gated by SystemRole (ADMIN / FINANCE)
  // rather than workspace role - a workspace OWNER is NOT automatically
  // trusted with money. See the Layer 5 revocation in `ability.ts`, which is
  // load-bearing: without it Layer 1's `read all` for MEMBER would expose
  // every contract and payment to every employee.
  | 'Contract'
  | 'Payment'
  | 'PaymentSource'
  | 'Expense'
  | 'Invoice'
  | 'Payroll'
  | 'all';

export type AppAction = 'create' | 'read' | 'update' | 'delete' | 'manage';

export type AppAbility = Ability<[AppAction, AppSubject]>;
