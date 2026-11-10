import * as nodemailer from 'nodemailer';
import type { MailConfig } from './mail-config';
import type { MailTransport } from './mail-transport';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_EXPIRY_MARGIN_MS = 30_000;
const QUOTA_REASONS = new Set(['dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded']);

type GmailErrorCode = 'GMAIL_AUTH_FAILED' | 'GMAIL_RATE_LIMITED' | 'GMAIL_UNAVAILABLE' | 'GMAIL_SEND_FAILED';

export class GmailTransportError extends Error {
  constructor(readonly code: GmailErrorCode) {
    super(code);
    this.name = code;
  }
}

export function createGmailTransport(config: MailConfig, request: typeof fetch = fetch): MailTransport {
  const sender = config.GMAIL_SENDER.trim();
  const sendUrl = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(sender)}/messages/send`;
  const mime = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  let cached: { value: string; expiresAt: number } | undefined;
  let refreshing: Promise<string> | undefined;

  async function post(url: string, headers: Record<string, string>, body: string | URLSearchParams): Promise<Response> {
    try {
      return await request(url, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new GmailTransportError('GMAIL_UNAVAILABLE');
    }
  }

  async function refresh(): Promise<string> {
    const requestedAt = Date.now();
    const response = await post(TOKEN_URL, { 'Content-Type': 'application/x-www-form-urlencoded' }, new URLSearchParams({
      client_id: config.GMAIL_CLIENT_ID.trim(),
      client_secret: config.GMAIL_CLIENT_SECRET.trim(),
      refresh_token: config.GMAIL_REFRESH_TOKEN.trim(),
      grant_type: 'refresh_token',
    }));
    if (!response.ok) throw new GmailTransportError(await failureCode(response, true));

    const token = await readJson<{ access_token?: unknown; expires_in?: unknown }>(response);
    if (typeof token?.access_token !== 'string' || !token.access_token ||
        typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
      throw new GmailTransportError('GMAIL_UNAVAILABLE');
    }
    cached = { value: token.access_token, expiresAt: requestedAt + token.expires_in * 1000 };
    return cached.value;
  }

  function accessToken(): Promise<string> {
    if (cached && cached.expiresAt - TOKEN_EXPIRY_MARGIN_MS > Date.now()) return Promise.resolve(cached.value);
    refreshing ??= refresh().finally(() => { refreshing = undefined; });
    return refreshing;
  }

  return {
    async sendMail(message) {
      const { message: buffer } = await mime.sendMail({ ...message, from: { name: 'Nexus', address: sender } });
      const token = await accessToken();
      const response = await post(sendUrl, {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      }, JSON.stringify({ raw: buffer.toString('base64url') }));

      if (!response.ok) {
        if (response.status === 401 && cached?.value === token) cached = undefined;
        throw new GmailTransportError(await failureCode(response));
      }
      const sent = await readJson<{ id?: unknown }>(response);
      if (typeof sent?.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(sent.id)) {
        throw new GmailTransportError('GMAIL_SEND_FAILED');
      }
      return { messageId: sent.id };
    },
  };
}

async function failureCode(response: Response, refreshing = false): Promise<GmailErrorCode> {
  if (response.status === 429) return 'GMAIL_RATE_LIMITED';
  if (response.status >= 500) return 'GMAIL_UNAVAILABLE';
  if (response.status === 403) {
    const details = await readJson<{ error?: { errors?: Array<{ reason?: string }> } }>(response);
    const errors = details?.error?.errors;
    if (Array.isArray(errors) && errors.some((error) => QUOTA_REASONS.has(error?.reason))) return 'GMAIL_RATE_LIMITED';
    return 'GMAIL_AUTH_FAILED';
  }
  if (refreshing || response.status === 401) return 'GMAIL_AUTH_FAILED';
  return 'GMAIL_SEND_FAILED';
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  try {
    return await response.json() as T;
  } catch {
    return undefined;
  }
}
