import { Injectable, Logger } from '@nestjs/common';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare Turnstile verification for public form submits. Off unless
 * `TURNSTILE_SECRET_KEY` is set (the web needs `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
 * to render the widget). Fails closed when enabled and Cloudflare cannot be
 * reached, so a bot cannot get through by timing out the check.
 */
@Injectable()
export class TurnstileClient {
  private readonly logger = new Logger(TurnstileClient.name);
  private readonly secret = process.env.TURNSTILE_SECRET_KEY?.trim() || null;

  get enabled(): boolean {
    return this.secret !== null;
  }

  async verify(token: string | undefined, remoteIp: string): Promise<boolean> {
    if (!this.secret) return true;
    if (!token) return false;
    try {
      const body = new URLSearchParams({
        secret: this.secret,
        response: token,
        remoteip: remoteIp,
      });
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return false;
      const json = (await res.json()) as { success?: unknown };
      return json.success === true;
    } catch (err) {
      this.logger.warn(`Turnstile verify failed: ${(err as Error)?.name ?? 'unknown'}`);
      return false;
    }
  }
}
