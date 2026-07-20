export class TFile {
  constructor(path) {
    this.path = path;
    this.name = path.split('/').pop() || path;
    this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
    this.basename = this.name.replace(/\.[^.]+$/, '');
  }
}
export class MarkdownView {}

export class Notice {
  constructor(message) {
    this.message = message;
  }
}

function parseScalar(raw) {
  const value = String(raw ?? '').trim();
  if (!value || value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?(?:\d+|\d*\.\d+)$/.test(value)) return Number(value);
  if (value.startsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if ((value.startsWith('[') && value.endsWith(']'))
    || (value.startsWith('{') && value.endsWith('}'))) {
    return JSON.parse(value);
  }
  return value;
}

function parseKey(raw) {
  const key = String(raw || '').trim();
  if (key.startsWith('"')) return JSON.parse(key);
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
}

export function parseYaml(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const output = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^([^\s][^:]*):(?:[ \t]*(.*))?$/);
    if (!match) throw new Error(`Unsupported test YAML at line ${index + 1}`);
    const key = parseKey(match[1]);
    if (Object.prototype.hasOwnProperty.call(output, key)) {
      throw new Error('Map keys must be unique');
    }

    const inline = match[2] ?? '';
    if (inline.trim()) {
      output[key] = parseScalar(inline);
      continue;
    }

    const entries = [];
    let next = index + 1;
    while (next < lines.length) {
      const item = lines[next].match(/^[ \t]+-[ \t]*(.*)$/);
      if (!item) break;
      entries.push(parseScalar(item[1]));
      next += 1;
    }
    output[key] = entries.length > 0 ? entries : null;
    index = next - 1;
  }

  return output;
}

function stringifyScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function stringifyYaml(value) {
  const output = [];
  for (const [key, entry] of Object.entries(value || {})) {
    const encodedKey = /^[A-Za-z0-9_.-]+$/.test(key) ? key : JSON.stringify(key);
    if (Array.isArray(entry)) {
      if (entry.length === 0) {
        output.push(`${encodedKey}: []`);
      } else {
        output.push(`${encodedKey}:`);
        entry.forEach((item) => output.push(`  - ${stringifyScalar(item)}`));
      }
      continue;
    }
    output.push(`${encodedKey}: ${stringifyScalar(entry)}`);
  }
  return output.join('\n');
}
