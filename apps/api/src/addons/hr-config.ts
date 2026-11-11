import type { HrAddonSettings } from '@botss/shared-types';

/**
 * What the HR add-on does for one organization, resolved from its own
 * settings with a fallback to server env for the platform (root)
 * organization only.
 *
 * Before add-ons, timesheet warnings and the payslip signatory existed only
 * for the platform organization, configured through server env. They
 * now come from the organization's HR add-on settings. The platform
 * organization keeps today's behaviour with no admin action by reading
 * HR_SENDER_EMAIL / HR_EMAIL_DOMAIN / PAYSLIP_SIGNATORY_NAME /
 * PAYSLIP_SIGNATORY_TITLE while it has no own settings. Every other
 * organization starts with warnings off and no signatory, so it can never
 * inherit the platform's values.
 */
export interface TimesheetWarningConfig {
  /** Staff account the warnings are sent from (must be in the organization). */
  senderEmail: string;
  /** Only staff on this email domain are checked; null checks everyone. */
  emailDomain: string | null;
}

export interface PayslipSignatory {
  name: string;
  title: string;
}

export interface HrConfig {
  timesheetWarnings: TimesheetWarningConfig | null;
  signatory: PayslipSignatory | null;
  /** Where each part came from, for the Add-ons page. */
  source: { timesheetWarnings: 'own' | 'server' | 'none'; signatory: 'own' | 'server' | 'none' };
}

type Env = Record<string, string | undefined>;

function envValue(env: Env, name: string): string | null {
  const v = env[name]?.trim();
  return v ? v : null;
}

function hasOwnTimesheetSettings(s: HrAddonSettings): boolean {
  return (
    s.timesheetWarningsEnabled !== undefined ||
    s.timesheetSenderEmail !== undefined ||
    s.timesheetEmailDomain !== undefined
  );
}

export function resolveHrConfig(input: {
  isRoot: boolean;
  settings: HrAddonSettings;
  env: Env;
}): HrConfig {
  const { isRoot, settings, env } = input;

  let timesheetWarnings: TimesheetWarningConfig | null = null;
  let timesheetSource: HrConfig['source']['timesheetWarnings'] = 'none';
  if (hasOwnTimesheetSettings(settings)) {
    timesheetSource = 'own';
    if (settings.timesheetWarningsEnabled === true && settings.timesheetSenderEmail) {
      timesheetWarnings = {
        senderEmail: settings.timesheetSenderEmail.toLowerCase(),
        emailDomain: settings.timesheetEmailDomain?.toLowerCase() ?? null,
      };
    }
  } else if (isRoot) {
    const sender = envValue(env, 'HR_SENDER_EMAIL');
    const domain = envValue(env, 'HR_EMAIL_DOMAIN');
    // Both were required before (the organization was found by its domain),
    // so both stay required for the server fallback.
    if (sender && domain) {
      timesheetSource = 'server';
      timesheetWarnings = { senderEmail: sender.toLowerCase(), emailDomain: domain.toLowerCase() };
    }
  }

  let signatory: PayslipSignatory | null = null;
  let signatorySource: HrConfig['source']['signatory'] = 'none';
  if (settings.payslipSignatoryName) {
    signatorySource = 'own';
    signatory = {
      name: settings.payslipSignatoryName,
      title: settings.payslipSignatoryTitle ?? '',
    };
  } else if (isRoot) {
    const name = envValue(env, 'PAYSLIP_SIGNATORY_NAME');
    if (name) {
      signatorySource = 'server';
      signatory = { name, title: envValue(env, 'PAYSLIP_SIGNATORY_TITLE') ?? '' };
    }
  }

  return {
    timesheetWarnings,
    signatory,
    source: { timesheetWarnings: timesheetSource, signatory: signatorySource },
  };
}
