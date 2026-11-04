/**
 * Pure rules for workspace invitations and member role changes, kept apart
 * from WorkspacesService so they can be checked without a database
 * (`check-security-hardening.ts`).
 */

/**
 * May the inviter see the set-first-password link (URL and code) of a
 * pending account?
 *
 * Accepting the link sets the account's FIRST password, so whoever holds it
 * can take the account over. An organization admin (`users.manage`) can
 * already reset any password in the organization, so they always see it. A
 * member manager sees it only for an account no more privileged than one
 * they could create by inviting a new address: no company permissions at all
 * and no membership anywhere but this workspace. For anyone else (a person
 * still pending elsewhere, a pending org admin) the link goes to that
 * person's inbox only.
 */
export function inviteLinkVisible(input: {
  actorManagesUsers: boolean;
  workspaceId: string;
  inviteeWorkspaceIds: readonly string[];
  inviteeCompanyPermissions: readonly string[];
}): boolean {
  if (input.actorManagesUsers) return true;
  const onlyHere = input.inviteeWorkspaceIds.every((id) => id === input.workspaceId);
  return onlyHere && input.inviteeCompanyPermissions.length === 0;
}

/**
 * Must a membership update pass the preset-grant check for its base role?
 *
 * The base role is written even when a custom role comes with it, and
 * several checks read the raw role (signature visibility, search, portal
 * decisions), so it is checked whenever it changes. Sending a `customRoleId`
 * used to skip the check entirely and let any member manager write
 * `role: ADMIN`. Keeping the current base role (what the UI sends along with
 * a custom role) grants nothing new.
 */
export function presetGrantCheckNeeded(input: {
  customRoleId: string | null | undefined;
  nextRole: string | undefined;
  currentRole: string;
}): boolean {
  const customRoleChange = input.customRoleId !== undefined && input.customRoleId !== null;
  return !customRoleChange || input.nextRole !== input.currentRole;
}
