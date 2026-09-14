import { domainToASCII } from 'node:url';

// Pure checks shared by the Identity client, the session and the local stores.
// Each one mirrors a helper in apps/tauri-shell/src-tauri/src/identity.rs.

const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/u;
const DOMAIN_LABEL = /^[a-z0-9-]{1,63}$/u;
const PRINTABLE_ASCII = /^[\x21-\x7e]*$/u;
const PUNYCODE_LABEL = /(?:^|\.)xn--/iu;
const URL_SAFE = /^[A-Za-z0-9_-]+$/u;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const RFC3339_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u;
const CONTROL_CHARACTER = /\p{Cc}/u;
const EDGE_WHITESPACE = /^\p{White_Space}+|\p{White_Space}+$/gu;

export const INVALID_EMAIL_MESSAGE = '请输入有效的邮箱地址。';

const MAILBOX_URLS = new Map([
  ['qq.com', 'https://mail.qq.com/'],
  ['foxmail.com', 'https://mail.qq.com/'],
  ['gmail.com', 'https://mail.google.com/'],
  ['googlemail.com', 'https://mail.google.com/'],
  ['outlook.com', 'https://outlook.live.com/mail/'],
  ['hotmail.com', 'https://outlook.live.com/mail/'],
  ['live.com', 'https://outlook.live.com/mail/'],
  ['msn.com', 'https://outlook.live.com/mail/'],
  ['163.com', 'https://mail.163.com/'],
  ['126.com', 'https://mail.163.com/'],
  ['yeah.net', 'https://mail.163.com/'],
]);

// Rust's str::trim uses the Unicode White_Space property; String.prototype.trim differs slightly.
export function trimWhitespace(value) {
  return value.replace(EDGE_WHITESPACE, '');
}

function toAsciiDomain(domain) {
  // WHATWG domainToASCII also rewrites numeric hosts ("0x7f.1" -> "127.0.0.1"), which Rust's
  // idna crate does not, so plain ASCII names only get the lower-casing that UTS #46 applies.
  if (PRINTABLE_ASCII.test(domain) && !PUNYCODE_LABEL.test(domain)) return domain.toLowerCase();
  const ascii = domainToASCII(domain);
  return ascii ? ascii.toLowerCase() : null;
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const candidate = trimWhitespace(value).normalize('NFC');
  const separator = candidate.lastIndexOf('@');
  if (separator <= 0) return null;
  const local = candidate.slice(0, separator);
  const domain = candidate.slice(separator + 1);
  if (
    local.length > 64
    || local.startsWith('.')
    || local.endsWith('.')
    || local.includes('..')
    || !LOCAL_PART.test(local)
  ) {
    return null;
  }
  const asciiDomain = toAsciiDomain(domain);
  if (asciiDomain === null) return null;
  const labels = asciiDomain.split('.');
  if (
    labels.length < 2
    || labels.some((label) => !DOMAIN_LABEL.test(label) || label.startsWith('-') || label.endsWith('-'))
  ) {
    return null;
  }
  const normalized = `${local.toLowerCase()}@${asciiDomain}`;
  return normalized.length <= 254 ? normalized : null;
}

export function mailboxUrl(email) {
  const separator = typeof email === 'string' ? email.lastIndexOf('@') : -1;
  if (separator < 0) return null;
  return MAILBOX_URLS.get(email.slice(separator + 1)) ?? null;
}

export function emptyFieldErrors() {
  return { email: null, displayName: null, password: null, confirmation: null };
}

const asString = (value) => (typeof value === 'string' ? value : '');

// The launcher always reports confirmationWasPasted; a missing flag counts as pasted.
export function validateRegistration(request) {
  const email = normalizeEmail(request?.email);
  const displayName = trimWhitespace(asString(request?.displayName)).normalize('NFC');
  const password = asString(request?.password);
  const confirmation = asString(request?.confirmation);
  const fieldErrors = emptyFieldErrors();

  if (!email) fieldErrors.email = INVALID_EMAIL_MESSAGE;
  const displayNameLength = [...displayName].length;
  if (displayNameLength < 1 || displayNameLength > 80 || CONTROL_CHARACTER.test(displayName)) {
    fieldErrors.displayName = '昵称必须为 1 至 80 个字符，且不能包含控制字符。';
  }
  const passwordLength = [...password].length;
  if (CONTROL_CHARACTER.test(password)) fieldErrors.password = '密码不能包含控制字符。';
  else if (passwordLength < 8) fieldErrors.password = '密码至少需要 8 个字符。';
  else if (passwordLength > 128) fieldErrors.password = '密码不能超过 128 个字符。';
  if (request?.confirmationWasPasted !== false) {
    fieldErrors.confirmation = '请手动再次输入密码，确认密码不支持粘贴。';
  } else if (password !== confirmation) {
    fieldErrors.confirmation = '两次输入的密码不一致。';
  }

  const valid = Object.values(fieldErrors).every((message) => message === null);
  return valid
    ? { registration: { email, displayName, password }, fieldErrors }
    : { registration: null, fieldErrors };
}

export function isUrlSafeToken(value, length) {
  return typeof value === 'string' && value.length === length && URL_SAFE.test(value);
}

export function isCanonicalUuid(value) {
  return typeof value === 'string' && CANONICAL_UUID.test(value) && value !== NIL_UUID;
}

export function isJwt(value) {
  if (typeof value !== 'string') return false;
  const segments = value.split('.');
  return segments.length === 3 && segments.every((segment) => URL_SAFE.test(segment));
}

// RFC 3339 in UTC ("...Z" only), returned as epoch milliseconds; null when invalid.
export function parseUtcTimestamp(value) {
  const match = typeof value === 'string' ? RFC3339_UTC.exec(value) : null;
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const milliseconds = Number((match[7] ?? '').padEnd(3, '0').slice(0, 3));
  const time = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  const date = new Date(time);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    return null;
  }
  return time;
}
