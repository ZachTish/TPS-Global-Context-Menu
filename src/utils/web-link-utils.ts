export interface ExtractedWebLink {
  url: string;
  label: string;
}

function normalizeWebUrl(url: string): string {
  const trimmed = String(url || '').trim().replace(/[.,;:!?]+$/g, '');
  if (!trimmed) return '';
  const withProtocol = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  if (!/^https?:\/\//i.test(withProtocol)) return '';
  try {
    return new URL(withProtocol).toString();
  } catch {
    return '';
  }
}

export function extractWebLink(value: unknown): ExtractedWebLink | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  const markdown = text.match(/\[([^\]]+)\]\(((?:https?:\/\/|www\.)[^)\s]+)\)/i);
  if (markdown) {
    const url = normalizeWebUrl(markdown[2]);
    if (url) return { url, label: markdown[1].trim() || url };
  }

  const angle = text.match(/<((?:https?:\/\/|www\.)[^>\s]+)>/i);
  if (angle) {
    const url = normalizeWebUrl(angle[1]);
    if (url) return { url, label: url };
  }

  const raw = text.match(/\b((?:https?:\/\/|www\.)[^\s<>"')\]]+)/i);
  if (!raw) return null;
  const url = normalizeWebUrl(raw[1]);
  return url ? { url, label: text === raw[1] ? url : text } : null;
}
