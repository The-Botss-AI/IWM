/**
 * Status lines for the longer waits. `PageLoader` shows one per ring spin and
 * loops, so each list reads as a story and the last line suits a long wait.
 */
export const BOOT_MESSAGES = [
  'Signing you in',
  'Loading your workspaces',
  'Getting your messages ready',
  'Almost there',
] as const;

export const WORKSPACE_MESSAGES = [
  'Loading your workspaces',
  'Checking your access',
  'Almost there',
] as const;

export const PORTAL_MESSAGES = [
  'Opening your portal',
  'Loading your projects and invoices',
  'Almost there',
] as const;
