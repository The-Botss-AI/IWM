import { type ClientOptions, HttpClient } from './client.js';
import { AdminResource } from './resources/admin.js';
import { AuditLogResource } from './resources/audit-log.js';
import { CalendarResource } from './resources/calendar.js';
import { ChatResource } from './resources/chat.js';
import { ClientsResource } from './resources/clients.js';
import { CommentsResource } from './resources/comments.js';
import { CustomFieldsResource } from './resources/custom-fields.js';
import { DocumentsResource } from './resources/documents.js';
import { FilesResource } from './resources/files.js';
import { GoalsResource } from './resources/goals.js';
import { InvitationsResource } from './resources/invitations.js';
import { FinanceResource } from './resources/finance.js';
import { PayrollResource } from './resources/payroll.js';
import { InvoicesResource } from './resources/invoices.js';
import { LeadsResource } from './resources/leads.js';
import { LivekitResource } from './resources/livekit.js';
import { MailResource } from './resources/mail.js';
import { NotificationsResource } from './resources/notifications.js';
import { OrganizationsResource } from './resources/organizations.js';
import { PortalResource } from './resources/portal.js';
import { ProjectMembersResource } from './resources/project-members.js';
import { ProjectsResource } from './resources/projects.js';
import { ProjectSummaryResource } from './resources/project-summary.js';
import { SalesAccessResource } from './resources/sales-access.js';
import { RolesResource } from './resources/roles.js';
import { SavedViewsResource } from './resources/saved-views.js';
import { SearchResource } from './resources/search.js';
import { SignaturesResource } from './resources/signatures.js';
import { SprintsResource } from './resources/sprints.js';
import { SupportResource } from './resources/support.js';
import { AddonsResource, OrgDomainsResource } from './resources/addons.js';
import { TaskFormsResource } from './resources/task-forms.js';
import { FormsResource, PublicFormsResource } from './resources/forms.js';
import { TasksResource } from './resources/tasks.js';
import { AttendanceResource } from './resources/attendance.js';
import { HolidaysResource } from './resources/holidays.js';
import { LeavesResource } from './resources/leaves.js';
import { TimesheetsResource } from './resources/timesheets.js';
import { TodosResource } from './resources/todos.js';
import { UsersResource } from './resources/users.js';
import { WorkspacesResource } from './resources/workspaces.js';

export * from './errors.js';
export type { ClientOptions } from './client.js';
export type { SearchParams } from './resources/search.js';

export interface BotssApiClient {
  workspaces: WorkspacesResource;
  users: UsersResource;
  projects: ProjectsResource;
  projectMembers: ProjectMembersResource;
  tasks: TasksResource;
  comments: CommentsResource;
  customFields: CustomFieldsResource;
  leads: LeadsResource;
  clients: ClientsResource;
  salesAccess: SalesAccessResource;
  roles: RolesResource;
  documents: DocumentsResource;
  signatures: SignaturesResource;
  files: FilesResource;
  notifications: NotificationsResource;
  mail: MailResource;
  invitations: InvitationsResource;
  finance: FinanceResource;
  payroll: PayrollResource;
  invoices: InvoicesResource;
  // Project management
  sprints: SprintsResource;
  taskForms: TaskFormsResource;
  /** Workspace form builder. */
  forms: FormsResource;
  publicForms: PublicFormsResource;
  goals: GoalsResource;
  savedViews: SavedViewsResource;
  search: SearchResource;
  projectSummary: ProjectSummaryResource;
  admin: AdminResource;
  chat: ChatResource;
  livekit: LivekitResource;
  todos: TodosResource;
  timesheets: TimesheetsResource;
  calendar: CalendarResource;
  organizations: OrganizationsResource;
  auditLog: AuditLogResource;
  /** Support access grants and platform operator support sessions. */
  support: SupportResource;
  /** Optional per-organization features and their settings. */
  addons: AddonsResource;
  /** Email domains the organization claims (DNS TXT verification). */
  orgDomains: OrgDomainsResource;
  /** Client portal - CLIENT (portal) accounts only. */
  portal: PortalResource;
  // HR - gated by SystemRole on the server.
  leaves: LeavesResource;
  attendance: AttendanceResource;
  holidays: HolidaysResource;
}

export function createClient(opts: ClientOptions): BotssApiClient {
  const http = new HttpClient(opts);
  return {
    workspaces: new WorkspacesResource(http),
    users: new UsersResource(http),
    projects: new ProjectsResource(http),
    projectMembers: new ProjectMembersResource(http),
    tasks: new TasksResource(http),
    comments: new CommentsResource(http),
    customFields: new CustomFieldsResource(http),
    leads: new LeadsResource(http),
    clients: new ClientsResource(http),
    salesAccess: new SalesAccessResource(http),
    roles: new RolesResource(http),
    documents: new DocumentsResource(http),
    signatures: new SignaturesResource(http),
    files: new FilesResource(http),
    notifications: new NotificationsResource(http),
    mail: new MailResource(http),
    invitations: new InvitationsResource(http),
    finance: new FinanceResource(http),
    payroll: new PayrollResource(http),
    invoices: new InvoicesResource(http),
    sprints: new SprintsResource(http),
    taskForms: new TaskFormsResource(http),
    forms: new FormsResource(http),
    publicForms: new PublicFormsResource(http),
    goals: new GoalsResource(http),
    savedViews: new SavedViewsResource(http),
    search: new SearchResource(http),
    projectSummary: new ProjectSummaryResource(http),
    admin: new AdminResource(http),
    chat: new ChatResource(http),
    livekit: new LivekitResource(http),
    todos: new TodosResource(http),
    timesheets: new TimesheetsResource(http),
    calendar: new CalendarResource(http),
    organizations: new OrganizationsResource(http),
    auditLog: new AuditLogResource(http),
    support: new SupportResource(http),
    addons: new AddonsResource(http),
    orgDomains: new OrgDomainsResource(http),
    portal: new PortalResource(http),
    leaves: new LeavesResource(http),
    attendance: new AttendanceResource(http),
    holidays: new HolidaysResource(http),
  };
}
