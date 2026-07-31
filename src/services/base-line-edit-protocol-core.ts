export const BASE_LINE_EDIT_PROTOCOL_ACTION = 'tps-gcm-edit-base-line';
export const BASE_LINE_EDIT_PROTOCOL_VERSION = '1';

const REQUIRED_KEYS = [
  'base',
  'fingerprint',
  'line',
  'nonce',
  'source',
  'v',
  'vault',
  'view',
] as const;

const MAX_PATH_LENGTH = 1024;
const MAX_VIEW_LENGTH = 256;
const MAX_VAULT_LENGTH = 160;
const MAX_LINE_NUMBER = 2_097_152;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f\u2028\u2029]/u;

export interface BaseLineEditProtocolParams {
  v: '1';
  vault: string;
  base: string;
  view: string;
  source: string;
  line: number;
  fingerprint: string;
  nonce: string;
}

export type BaseLineEditParamValidation =
  | { ok: true; value: BaseLineEditProtocolParams }
  | { ok: false; reason: string };

export type BaseLineFingerprintResolution =
  | { status: 'unique'; zeroBasedLine: number; relocated: boolean }
  | { status: 'missing' }
  | { status: 'ambiguous' };

export function validateBaseLineEditProtocolParams(
  input: Record<string, unknown> | null | undefined,
): BaseLineEditParamValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'invalid-container' };
  }
  const keys = Object.keys(input).sort();
  if (keys.length !== REQUIRED_KEYS.length || keys.some((key, index) => key !== REQUIRED_KEYS[index])) {
    return { ok: false, reason: 'invalid-keys' };
  }
  if (REQUIRED_KEYS.some((key) => typeof input[key] !== 'string')) {
    return { ok: false, reason: 'invalid-value-type' };
  }

  const v = input.v as string;
  const vault = input.vault as string;
  const base = input.base as string;
  const view = input.view as string;
  const source = input.source as string;
  const line = input.line as string;
  const fingerprint = input.fingerprint as string;
  const nonce = input.nonce as string;

  if (v !== BASE_LINE_EDIT_PROTOCOL_VERSION) return { ok: false, reason: 'unsupported-version' };
  if (!isBoundedPlainValue(vault, MAX_VAULT_LENGTH)) return { ok: false, reason: 'invalid-vault' };
  if (!isCanonicalVaultPath(base, '.base')) return { ok: false, reason: 'invalid-base-path' };
  if (!isBoundedPlainValue(view, MAX_VIEW_LENGTH) || view.includes('#')) {
    return { ok: false, reason: 'invalid-view' };
  }
  if (!isCanonicalVaultPath(source, '.md')) return { ok: false, reason: 'invalid-source-path' };
  if (!/^[1-9][0-9]{0,6}$/u.test(line)) return { ok: false, reason: 'invalid-line' };
  const lineNumber = Number(line);
  if (!Number.isSafeInteger(lineNumber) || lineNumber > MAX_LINE_NUMBER) {
    return { ok: false, reason: 'invalid-line' };
  }
  if (!SHA256_PATTERN.test(fingerprint)) return { ok: false, reason: 'invalid-fingerprint' };
  if (!UUID_PATTERN.test(nonce)) return { ok: false, reason: 'invalid-nonce' };

  return {
    ok: true,
    value: {
      v: '1',
      vault,
      base,
      view,
      source,
      line: lineNumber,
      fingerprint,
      nonce,
    },
  };
}

export const MAX_BASE_LINE_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_BASE_DEFINITION_BYTES = 512 * 1024;

export function normalizeBaseLineFingerprintInput(value: string, stripLeadingBom = false): string {
  const normalized = String(value || '').replace(/\r\n?/gu, '\n').normalize('NFC');
  return stripLeadingBom && normalized.startsWith('\uFEFF') ? normalized.slice(1) : normalized;
}

export async function sha256BaseLine(value: string, stripLeadingBom = false): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const bytes = new TextEncoder().encode(normalizeBaseLineFingerprintInput(value, stripLeadingBom));
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function resolveUniqueBaseLineFingerprint(
  content: string,
  fingerprint: string,
  oneBasedLineHint: number,
): Promise<BaseLineFingerprintResolution> {
  const lines = String(content || '').replace(/\r\n?/gu, '\n').split('\n');
  const hintIndex = Number.isInteger(oneBasedLineHint) ? oneBasedLineHint - 1 : -1;
  const orderedIndexes: number[] = [];
  if (hintIndex >= 0 && hintIndex < lines.length) orderedIndexes.push(hintIndex);
  for (let index = 0; index < lines.length; index += 1) {
    if (index !== hintIndex) orderedIndexes.push(index);
  }

  const matches: number[] = [];
  const batchSize = 64;
  for (let offset = 0; offset < orderedIndexes.length; offset += batchSize) {
    const batch = orderedIndexes.slice(offset, offset + batchSize);
    const digests = await Promise.all(batch.map((index) => sha256BaseLine(lines[index] || '', index === 0)));
    for (let index = 0; index < batch.length; index += 1) {
      if (digests[index] !== fingerprint) continue;
      matches.push(batch[index]);
      if (matches.length > 1) return { status: 'ambiguous' };
    }
  }

  if (matches.length !== 1) return { status: 'missing' };
  return {
    status: 'unique',
    zeroBasedLine: matches[0],
    relocated: matches[0] !== hintIndex,
  };
}

export function isWithinUtf8ByteLimit(value: string, maxBytes: number): boolean {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return false;
  const source = String(value || '');
  if (source.length > maxBytes) return false;
  return new TextEncoder().encode(source).byteLength <= maxBytes;
}

function isBoundedPlainValue(value: string, maxLength: number): boolean {
  return value.length > 0
    && value.length <= maxLength
    && value === value.trim()
    && !CONTROL_PATTERN.test(value);
}

function isCanonicalVaultPath(value: string, extension: '.base' | '.md'): boolean {
  if (!isBoundedPlainValue(value, MAX_PATH_LENGTH)) return false;
  if (value.startsWith('/') || value.endsWith('/') || value.includes('\\') || value.includes('#')) return false;
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false;
  return value.toLowerCase().endsWith(extension);
}
