export interface EditableNotePreviewDocumentParts {
  prefix: string;
  body: string;
  eol: '\n' | '\r\n';
  hasFrontmatter: boolean;
  lineEndingsSupported: boolean;
}

function inspectEditableNotePreviewLineEndings(raw: string): {
  eol: '\n' | '\r\n';
  supported: boolean;
} {
  let hasLf = false;
  let hasCrLf = false;
  let hasBareCr = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === '\r') {
      if (raw[index + 1] === '\n') {
        hasCrLf = true;
        index += 1;
      } else {
        hasBareCr = true;
      }
    } else if (character === '\n') {
      hasLf = true;
    }
  }

  return {
    eol: hasCrLf && !hasLf && !hasBareCr ? '\r\n' : '\n',
    supported: !hasBareCr && !(hasLf && hasCrLf),
  };
}

export function splitEditableNotePreviewDocument(rawContent: string): EditableNotePreviewDocumentParts {
  const raw = String(rawContent || '');
  const lineEndings = inspectEditableNotePreviewLineEndings(raw);
  const eol = lineEndings.eol;
  const bomLength = raw.startsWith('\uFEFF') ? 1 : 0;
  const firstBreak = raw.indexOf('\n', bomLength);
  const firstLine = (firstBreak >= 0 ? raw.slice(bomLength, firstBreak) : raw.slice(bomLength)).replace(/\r$/, '');
  if (firstLine !== '---') {
    return {
      prefix: raw.slice(0, bomLength),
      body: raw.slice(bomLength),
      eol,
      hasFrontmatter: false,
      lineEndingsSupported: lineEndings.supported,
    };
  }

  let cursor = firstBreak >= 0 ? firstBreak + 1 : raw.length;
  while (cursor <= raw.length) {
    const nextBreak = raw.indexOf('\n', cursor);
    const lineEnd = nextBreak >= 0 ? nextBreak : raw.length;
    const line = raw.slice(cursor, lineEnd).replace(/\r$/, '');
    if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) {
      const bodyStart = nextBreak >= 0 ? nextBreak + 1 : raw.length;
      return {
        prefix: raw.slice(0, bodyStart),
        body: raw.slice(bodyStart),
        eol,
        hasFrontmatter: true,
        lineEndingsSupported: lineEndings.supported,
      };
    }
    if (nextBreak < 0) break;
    cursor = nextBreak + 1;
  }
  return {
    prefix: raw.slice(0, bomLength),
    body: raw.slice(bomLength),
    eol,
    hasFrontmatter: false,
    lineEndingsSupported: lineEndings.supported,
  };
}

export function normalizeEditableNotePreviewBody(body: string): string {
  return String(body || '').replace(/\r\n?/g, '\n');
}

export function composeEditableNotePreviewDocument(
  parts: Pick<EditableNotePreviewDocumentParts, 'prefix' | 'eol' | 'hasFrontmatter' | 'lineEndingsSupported'>,
  body: string,
): string {
  if (!parts.lineEndingsSupported) {
    throw new Error('Editable note preview cannot preserve mixed or CR-only line endings.');
  }
  const storedBody = body.replace(/\n/g, parts.eol);
  const separator = storedBody && parts.hasFrontmatter && !parts.prefix.endsWith('\n')
    ? parts.eol
    : '';
  return `${parts.prefix}${separator}${storedBody}`;
}
