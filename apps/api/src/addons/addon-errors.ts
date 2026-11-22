import { ForbiddenException } from '@nestjs/common';

/** 403 for a feature whose add-on the organization switched off. */
export function addonDisabled(name: string): ForbiddenException {
  return new ForbiddenException({
    title: `${name} is turned off`,
    status: 403,
    detail: `${name} is turned off for your organization. An admin can turn it on in Settings, Add ons.`,
    code: 'addon-disabled',
  });
}

export function addonsForbidden(): ForbiddenException {
  return new ForbiddenException({
    title: 'Not allowed',
    status: 403,
    detail: 'Only people who can manage company settings can change features.',
    code: 'addons-forbidden',
  });
}
