import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { kindClassification, kindDiscriminator, type KindMappings } from './kind-classification';
import type { KindClassificationMigration, KindDiscriminatorMigration } from './kind-classification-migration';

type Change = KindClassificationMigration | KindDiscriminatorMigration;
type Condition = { source?: string; field?: string; operator?: string; value?: string };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const same = (left: unknown, right: unknown): boolean => String(left || '').toLowerCase() === String(right || '').toLowerCase();
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function listPath(change: Change): { key: string; from: string; to: string } | null {
  if (change.kind !== 'classification' || !('kindList' in change.from) || !('kindList' in change.to)) return null;
  return { key: change.from.kindList.key, from: change.from.kindList.value, to: change.to.kindList.value };
}

function isSharedPath(mappings: KindMappings, recordKind: string, path: { key: string; value: string } | null): boolean {
  return Boolean(path && Object.keys(mappings).some(kind => kind !== recordKind &&
    (() => { const other = kindClassification(mappings, kind); return other && 'kindList' in other
      && same(other.kindList.key, path.key) && same(other.kindList.value, path.value); })()));
}

/** Only references that identify the selected record may follow its configured path. */
export function planKindReferenceSettings(gcm: any, navigator: any, change: Change, mappings: KindMappings):
  { gcm: any; navigator: any; blocked: string[]; changed: string[] } {
  const next = copy(gcm), nextNavigator = navigator ? copy(navigator) : null;
  const blocked: string[] = [], changed: string[] = [];
  const path = listPath(change);
  if (change.kind === 'classification' && 'kindList' in change.from && 'kindList' in change.to
    && !same(change.from.kindList.key, change.to.kindList.key)) {
    blocked.push('Kind mapping: change the kind property key with the property-key migration before changing a path.');
    return { gcm: next, navigator: nextNavigator, blocked, changed };
  }
  if (!path && change.kind !== 'discriminator') return { gcm: next, navigator: nextNavigator, blocked, changed };
  const primary = change.kind === 'discriminator' ? change.primary : change.from;
  const primaryPath = 'kindList' in primary ? primary.kindList : null;
  const oldDiscriminator = change.kind === 'discriminator'
    ? change.from : kindDiscriminator(mappings, change.recordKind);
  const shared = isSharedPath(mappings, change.recordKind, primaryPath);
  const identityShared = Boolean(oldDiscriminator && Object.keys(mappings).some(kind => kind !== change.recordKind &&
    (() => { const other = kindDiscriminator(mappings, kind); return other && same(other.key, oldDiscriminator.key)
      && same(other.value, oldDiscriminator.value); })()));
  const groups = (rule: any): Condition[][] => [rule.conditions, ...(rule.conditionGroups || []).map((group: any) => group.conditions)]
    .filter(Array.isArray);
  const ruleSets = ['rules', 'hideRules', 'smartSort'];
  const navRules = next.notebookNavigatorRules || {};
  for (const set of ruleSets) {
    const rules = set === 'smartSort' ? navRules.smartSort?.buckets : navRules[set];
    for (const [index, rule] of (rules || []).entries()) {
      for (const conditions of groups(rule)) {
        const source = (condition: Condition) => ['frontmatter', 'parent-frontmatter'].includes(condition.source || '');
        const pathMatches = path ? conditions.filter((condition: Condition) => source(condition) &&
          same(condition.field, path.key) && same(condition.value, path.from) && ['is', '!is'].includes(condition.operator || '')) : [];
        const identityMatches = oldDiscriminator ? conditions.filter((condition: Condition) => source(condition) &&
          same(condition.field, oldDiscriminator.key) && same(condition.value, oldDiscriminator.value) && condition.operator === 'is') : [];
        const label = `GCM Navigator ${set}[${rule.id || index}]`;
        if (pathMatches.length) {
          if (shared && (pathMatches.some((condition: Condition) => condition.operator !== 'is') ||
            rule.match !== 'all' || identityMatches.length !== 1)) {
            const belongsToOther = !identityMatches.length && rule.match === 'all' &&
              pathMatches.every((condition: Condition) => condition.operator === 'is') &&
              Object.keys(mappings).some(kind => kind !== change.recordKind && (() => {
                const otherPath = kindClassification(mappings, kind);
                const otherIdentity = kindDiscriminator(mappings, kind);
                return otherPath && 'kindList' in otherPath && primaryPath &&
                  same(otherPath.kindList.key, primaryPath.key) && same(otherPath.kindList.value, primaryPath.value) &&
                  otherIdentity && conditions.some((condition: Condition) => source(condition) &&
                    same(condition.field, otherIdentity.key) && same(condition.value, otherIdentity.value) && condition.operator === 'is');
              })());
            if (belongsToOther) continue;
            blocked.push(`${label}: shared kind path has no exact AND identity for ${change.recordKind}.`);
          } else {
            for (const condition of pathMatches) condition.value = path!.to;
            changed.push(label);
          }
        }
        if (change.kind === 'discriminator' && identityMatches.length) {
          const paired = primaryPath && conditions.some((condition: Condition) => source(condition) &&
            same(condition.field, primaryPath.key) && same(condition.value, primaryPath.value) && condition.operator === 'is');
          if (!paired || rule.match !== 'all' || identityMatches.length !== 1) blocked.push(`${label}: identity condition is not paired with its kind path.`);
          else if (change.to) {
            identityMatches[0].field = change.to.key;
            identityMatches[0].value = change.to.value;
            changed.push(label);
          } else {
            const at = conditions.indexOf(identityMatches[0]);
            conditions.splice(at, 1);
            changed.push(label);
          }
        }
      }
      if (path && !shared && JSON.stringify(rule).includes(path.from))
        blocked.push(`GCM Navigator ${set}[${rule.id || index}]: unrecognized kind reference.`);
    }
  }
  if (path) {
    for (const [index, property] of (next.properties || []).entries()) {
      for (const field of ['scopeKinds', 'excludeKinds'] as const) {
        if (!Array.isArray(property[field]) || !property[field].some((value: unknown) => same(value, path.from))) continue;
        const label = `GCM custom property ${property.id || index}.${field}`;
        if (shared) blocked.push(`${label}: shared kind path cannot identify only ${change.recordKind}.`);
        else { property[field] = property[field].map((value: string) => same(value, path.from) ? path.to : value); changed.push(label); }
      }
      for (const field of ['scopeProperties', 'hideWhenProperties'] as const) {
        for (const [position, condition] of (property[field] || []).entries()) {
          if (!same(condition.key, path.key) || !same(condition.value, path.from)) continue;
          const label = `GCM custom property ${property.id || index}.${field}[${position}]`;
          if (shared || !['equals', 'not-equals', undefined].includes(condition.operator))
            blocked.push(`${label}: shared or non-exact kind scope requires review.`);
          else { condition.value = path.to; changed.push(label); }
        }
      }
      if (same(property.key, path.key) && Array.isArray(property.options) && property.options.some((value: unknown) => same(value, path.from))) {
        const label = `GCM custom property ${property.id || index}.options`;
        property.options = shared
          ? [...property.options, ...(property.options.some((value: unknown) => same(value, path.to)) ? [] : [path.to])]
          : property.options.map((value: string) => same(value, path.from) ? path.to : value);
        changed.push(label);
      }
    }
    if (nextNavigator) {
      const from = `${path.key}=${path.from}`, to = `${path.key}=${path.to}`;
      for (const [index, profile] of (nextNavigator.vaultProfiles || []).entries()) {
        for (const field of ['hiddenFileProperties'] as const) {
          for (const [position, value] of (profile[field] || []).entries()) {
            if (value === from) {
              const label = `TPS Notebook Navigator vaultProfiles[${index}].${field}[${position}]`;
              if (shared) blocked.push(`${label}: shared kind path cannot identify only ${change.recordKind}.`);
              else { profile[field][position] = to; changed.push(label); }
            } else if (typeof value === 'string' && value.includes(path.from)) blocked.push(`TPS Notebook Navigator vaultProfiles[${index}].${field}[${position}]: unrecognized kind reference.`);
          }
        }
        for (const [position, shortcut] of (profile.shortcuts || []).entries()) {
          if (shortcut.type !== 'search' || typeof shortcut.query !== 'string' || !shortcut.query.includes(path.from)) continue;
          const label = `TPS Notebook Navigator vaultProfiles[${index}].shortcuts[${position}]`;
          if (shortcut.query !== `.${from}` || shared) blocked.push(`${label}: search is compound or its kind path is shared.`);
          else { shortcut.query = `.${to}`; changed.push(label); }
        }
      }
      const appearances = nextNavigator.propertyAppearances || {};
      const appearanceFrom = `key:${from}`, appearanceTo = `key:${to}`;
      for (const key of Object.keys(appearances)) {
        if (key === appearanceFrom) {
          if (shared || Object.prototype.hasOwnProperty.call(appearances, appearanceTo)) blocked.push(`TPS Notebook Navigator propertyAppearances.${key}: shared path or occupied destination.`);
          else { appearances[appearanceTo] = appearances[key]; delete appearances[key]; changed.push(`TPS Notebook Navigator propertyAppearances.${key}`); }
        } else if (key.includes(path.from)) blocked.push(`TPS Notebook Navigator propertyAppearances.${key}: unrecognized kind reference.`);
      }
      if (!shared && JSON.stringify(nextNavigator).includes(path.from))
        blocked.push('TPS Notebook Navigator: an unrecognized kind path reference remains in settings.');
    }
  }
  if (change.kind === 'discriminator' && oldDiscriminator) {
    for (const [index, property] of (next.properties || []).entries()) {
      for (const field of ['scopeProperties', 'hideWhenProperties'] as const) {
        for (const [position, condition] of (property[field] || []).entries()) {
          if (!same(condition.key, oldDiscriminator.key) || !same(condition.value, oldDiscriminator.value)) continue;
          const label = `GCM custom property ${property.id || index}.${field}[${position}]`;
          if (!change.to || identityShared || !['equals', 'not-equals', undefined].includes(condition.operator) ||
            (shared && !property.scopeKinds?.some((value: string) => same(value, primaryPath?.value))))
            blocked.push(`${label}: identity scope requires manual review.`);
          else { condition.key = change.to.key; condition.value = change.to.value; changed.push(label); }
        }
      }
    }
    if (nextNavigator) {
      const from = `${oldDiscriminator.key}=${oldDiscriminator.value}`;
      const to = change.to && `${change.to.key}=${change.to.value}`;
      for (const [index, profile] of (nextNavigator.vaultProfiles || []).entries()) {
        for (const [position, value] of (profile.hiddenFileProperties || []).entries()) if (value === from) {
          const label = `TPS Notebook Navigator vaultProfiles[${index}].hiddenFileProperties[${position}]`;
          if (!to || identityShared) blocked.push(`${label}: identity reference requires manual review.`);
          else { profile.hiddenFileProperties[position] = to; changed.push(label); }
        }
        for (const [position, shortcut] of (profile.shortcuts || []).entries()) if (shortcut.type === 'search' &&
          typeof shortcut.query === 'string' && shortcut.query.includes(oldDiscriminator.value) &&
          shortcut.query.includes(oldDiscriminator.key)) {
          const label = `TPS Notebook Navigator vaultProfiles[${index}].shortcuts[${position}]`;
          if (!to || identityShared || shortcut.query !== `.${from}`) blocked.push(`${label}: identity search requires manual review.`);
          else { shortcut.query = `.${to}`; changed.push(label); }
        }
      }
      const appearances = nextNavigator.propertyAppearances || {};
      for (const key of Object.keys(appearances)) if (key === `key:${from}`) {
        const destination = `key:${to}`;
        if (!to || identityShared || Object.prototype.hasOwnProperty.call(appearances, destination))
          blocked.push(`TPS Notebook Navigator propertyAppearances.${key}: identity destination requires review.`);
        else { appearances[destination] = appearances[key]; delete appearances[key]; changed.push(`TPS Notebook Navigator propertyAppearances.${key}`); }
      }
    }
  }
  return { gcm: next, navigator: nextNavigator, blocked, changed };
}

/** Change only exact literal Base filter predicates. Any other use of the old value is reported. */
export function planKindBaseReferences(source: string, change: Change, mappings: KindMappings): { after: string; blocked: string[] } {
  const path = listPath(change);
  const primary = change.kind === 'discriminator' ? change.primary : change.from;
  const primaryPath = 'kindList' in primary ? primary.kindList : null;
  const discriminator = change.kind === 'discriminator' ? change.from : kindDiscriminator(mappings, change.recordKind);
  const identityExpression = discriminator && new RegExp(`\\b${escape(discriminator.key)}\\s*==\\s*(["'])${escape(discriminator.value)}\\1`, 'g');
  const mayContain = Boolean((path && source.includes(path.from)) ||
    (change.kind === 'discriminator' && identityExpression && new RegExp(identityExpression.source).test(source)));
  if (!mayContain) return { after: source, blocked: [] };
  const doc = parseDocument(source, { uniqueKeys: false, keepSourceTokens: true });
  if (doc.errors.length || !isMap(doc.contents)) return { after: source, blocked: ['Malformed Base YAML may contain the old record classification.'] };
  const blocked: string[] = [], edits: { start: number; end: number; text: string }[] = [];
  const predicate = path ? new RegExp(`\\blist\\s*\\(\\s*${escape(path.key)}\\s*\\)\\s*\\.contains\\s*\\(\\s*(["'])${escape(path.from)}\\1\\s*\\)`, 'g') : null;
  const shared = isSharedPath(mappings, change.recordKind, primaryPath);
  const pairedIdentity = discriminator && primaryPath ? new RegExp(
    `\\b${escape(discriminator.key)}\\s*==\\s*(["'])${escape(discriminator.value)}\\1`) : null;
  const visitNode = (node: any, location: string[], inFilter: boolean): void => {
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string') { blocked.push(`${location.join('.') || 'Base'}: complex YAML key.`); continue; }
        const key = pair.key.value;
        visitNode(pair.value, [...location, key], inFilter || key === 'filters');
      }
    } else if (isSeq(node)) node.items.forEach((item: any, index: number) => visitNode(item, [...location, String(index)], inFilter));
    else if (isScalar(node) && typeof node.value === 'string' &&
      ((path && node.value.includes(path.from)) || (change.kind === 'discriminator' && identityExpression &&
        new RegExp(identityExpression.source).test(node.value)))) {
      const label = location.join('.');
      if (!inFilter || !node.range || node.anchor || node.tag) { blocked.push(`${label}: record reference occurs outside a plain filter predicate.`); return; }
      const raw = source.slice(node.range[0], node.range[1]);
      let match: RegExpExecArray | null;
      const spans: Array<{ start: number; end: number }> = [];
      if (predicate && path) while ((match = predicate.exec(raw))) {
        const within = match[0].indexOf(`${match[1]}${path.from}${match[1]}`);
        const start = node.range[0] + match.index + within + 1;
        spans.push({ start, end: start + path.from.length });
      }
      if (path) {
        const occurrences = raw.split(path.from).length - 1;
        if (spans.length !== occurrences) { blocked.push(`${label}: kind path occurs in an unrecognized filter expression.`); return; }
        if (shared && (!pairedIdentity || !pairedIdentity.test(raw) || !raw.includes('&&') || raw.includes('||'))) {
          blocked.push(`${label}: shared kind path has no paired ${change.recordKind} identity.`); return;
        }
        for (const span of spans) edits.push({ ...span, text: path.to });
      }
      if (change.kind === 'discriminator' && discriminator && pairedIdentity) {
        const identity = pairedIdentity.exec(raw);
        if (!identity) { blocked.push(`${label}: identity occurs in an unrecognized filter expression.`); return; }
        const pathLiteral = primaryPath && new RegExp(`\\blist\\s*\\(\\s*${escape(primaryPath.key)}\\s*\\)\\s*\\.contains\\s*\\(\\s*(["'])${escape(primaryPath.value)}\\1\\s*\\)`);
        if (!pathLiteral?.test(raw) || (shared && (!raw.includes('&&') || raw.includes('||')))) {
          blocked.push(`${label}: identity filter is not paired with its kind path.`); return;
        }
        if (!change.to) { blocked.push(`${label}: removing an identity requires manual Base filter review.`); return; }
        const oldExpression = identity[0];
        const replacement = oldExpression.replace(discriminator.key, change.to.key).replace(discriminator.value, change.to.value);
        edits.push({ start: node.range[0] + identity.index, end: node.range[0] + identity.index + oldExpression.length, text: replacement });
      }
    }
  };
  visitNode(doc.contents, [], false);
  if (path && source.split(path.from).length - 1 !== edits.filter(edit => edit.text === path.to).length)
    blocked.push('An unrecognized kind path reference remains in Base source.');
  if (change.kind === 'discriminator' && identityExpression &&
    [...source.matchAll(identityExpression)].length !== edits.filter(edit => edit.text.includes(change.to?.value || '') && edit.text.includes(change.to?.key || '')).length)
    blocked.push('An unrecognized identity reference remains in Base source.');
  if (blocked.length) return { after: source, blocked };
  let after = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) after = after.slice(0, edit.start) + edit.text + after.slice(edit.end);
  return { after, blocked };
}

/** Carry a global frontmatter-key rename through Navigator's exact key references. */
export function planPropertyKeyNavigatorReferences(navigator: any, from: string, to: string):
  { navigator: any; blocked: string[]; changed: string[] } {
  const next = navigator ? copy(navigator) : null;
  const blocked: string[] = [], changed: string[] = [];
  if (!next) return { navigator: next, blocked, changed };
  const matches = (value: unknown, expected = from) => typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();
  const renameList = (value: unknown, label: string) => {
    if (typeof value !== 'string') return value;
    const parts = value.split(',').map(part => part.trim());
    if (!parts.some(part => matches(part))) return value;
    if (parts.some(part => matches(part, to))) blocked.push(`${label}: destination key is already configured.`);
    else changed.push(label);
    return parts.map(part => matches(part) ? to : part).join(', ');
  };
  for (const field of ['propertySortKey', 'propertyGroupKey']) if (typeof next[field] === 'string')
    next[field] = renameList(next[field], `TPS Notebook Navigator ${field}`);
  for (const field of ['defaultFolderSortPropertyKey', 'manualSortPropertyKey', 'manualSortGroupHeaderProperty'])
    if (matches(next[field])) { next[field] = to; changed.push(`TPS Notebook Navigator ${field}`); }
  if (typeof next.noteGrouping === 'string') {
    const match = /^(property(?:-desc|-follow)?):(.+)$/u.exec(next.noteGrouping);
    if (match && matches(match[2])) { next.noteGrouping = `${match[1]}:${to}`; changed.push('TPS Notebook Navigator noteGrouping'); }
  }
  for (const [index, profile] of (next.vaultProfiles || []).entries()) {
    const propertyKeys = profile.propertyKeys || [];
    if (propertyKeys.some((item: any) => matches(item.key)) && propertyKeys.some((item: any) => matches(item.key, to)))
      blocked.push(`TPS Notebook Navigator vaultProfiles[${index}].propertyKeys: destination key is already configured.`);
    for (const [position, item] of propertyKeys.entries()) if (matches(item.key)) {
      item.key = to; changed.push(`TPS Notebook Navigator vaultProfiles[${index}].propertyKeys[${position}]`);
    }
    for (const [position, value] of (profile.hiddenFileProperties || []).entries()) {
      const label = `TPS Notebook Navigator vaultProfiles[${index}].hiddenFileProperties[${position}]`;
      if (matches(value)) { profile.hiddenFileProperties[position] = to; changed.push(label); }
      else if (typeof value === 'string' && value.slice(0, value.indexOf('=')).toLowerCase() === from.toLowerCase()) {
        profile.hiddenFileProperties[position] = `${to}${value.slice(value.indexOf('='))}`; changed.push(label);
      }
    }
    for (const [position, shortcut] of (profile.shortcuts || []).entries()) {
      if (shortcut.type !== 'search' || typeof shortcut.query !== 'string') continue;
      const label = `TPS Notebook Navigator vaultProfiles[${index}].shortcuts[${position}]`;
      const exact = new RegExp(`^\\.${escape(from)}=(.*)$`, 'iu').exec(shortcut.query);
      if (exact) { shortcut.query = `.${to}=${exact[1]}`; changed.push(label); }
      else if (new RegExp(`\\.${escape(from)}(?:=|\\b)`, 'iu').test(shortcut.query))
        blocked.push(`${label}: compound property search requires review.`);
    }
  }
  const appearances = next.propertyAppearances || {};
  for (const key of Object.keys(appearances)) {
    const matched = new RegExp(`^key:${escape(from)}(?==|$)`, 'iu').exec(key);
    if (!matched) continue;
    const destination = `key:${to}${key.slice(matched[0].length)}`;
    const label = `TPS Notebook Navigator propertyAppearances.${key}`;
    if (Object.prototype.hasOwnProperty.call(appearances, destination)) blocked.push(`${label}: destination is already configured.`);
    else { appearances[destination] = appearances[key]; delete appearances[key]; changed.push(label); }
  }
  return { navigator: next, blocked, changed };
}

/** Rewrite exact Base expressions and view property references, preserving source bytes elsewhere. */
export function planPropertyKeyBaseReferences(source: string, from: string, to: string): { after: string; blocked: string[] } {
  const token = new RegExp(`(^|[^A-Za-z0-9_-])(${escape(from)})(?![A-Za-z0-9_-])`, 'giu');
  if (!token.test(source)) return { after: source, blocked: [] };
  const doc = parseDocument(source, { uniqueKeys: false, keepSourceTokens: true });
  if (doc.errors.length || !isMap(doc.contents)) return { after: source, blocked: ['Malformed Base YAML may contain the old property key.'] };
  const blocked: string[] = [], edits: { start: number; end: number; text: string }[] = [];
  const expressionFields = new Set(['filters', 'formulas']);
  const directFields = new Set(['order', 'columns', 'property', 'startDate', 'endDate', 'titleProperty', 'statusField', 'groupBy']);
  const visitNode = (node: any, location: string[], inExpression: boolean, direct: boolean): void => {
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string') { blocked.push(`${location.join('.') || 'Base'}: complex YAML key.`); continue; }
        const key = pair.key.value;
        if (location.length === 1 && location[0] === 'properties' &&
          (same(key, from) || same(key, `note.${from}`))) {
          const destination = same(key, from) ? to : `note.${to}`;
          const label = `properties.${key}`;
          if (node.items.some((other: any) => other !== pair && isScalar(other.key) && same(other.key.value, destination)))
            blocked.push(`${label}: destination property is already configured.`);
          else if (!pair.key.range || pair.key.anchor || pair.key.tag) blocked.push(`${label}: property key requires review.`);
          else {
            const raw = source.slice(pair.key.range[0], pair.key.range[1]);
            const start = raw.toLowerCase().lastIndexOf(from.toLowerCase());
            if (start < 0) blocked.push(`${label}: property key requires review.`);
            else edits.push({ start: pair.key.range[0] + start, end: pair.key.range[0] + start + from.length, text: to });
          }
        }
        visitNode(pair.value, [...location, key], inExpression || expressionFields.has(key), directFields.has(key));
      }
    } else if (isSeq(node)) node.items.forEach((item: any, index: number) => visitNode(item, [...location, String(index)], inExpression, direct));
    else if (isScalar(node) && typeof node.value === 'string' && new RegExp(token.source, 'iu').test(node.value)) {
      if (!inExpression && !direct) return;
      const label = location.join('.');
      if (!node.range || node.anchor || node.tag) { blocked.push(`${label}: property reference is not a plain scalar.`); return; }
      const raw = source.slice(node.range[0], node.range[1]);
      const quoted = raw[0] === '"' || raw[0] === "'";
      const expression = quoted ? raw.slice(1, -1) : raw;
      if (quoted && (raw.at(-1) !== raw[0] || expression !== node.value)) {
        blocked.push(`${label}: escaped Base expression requires review.`); return;
      }
      const offset = node.range[0] + (quoted ? 1 : 0);
      const matches = [...expression.matchAll(new RegExp(token.source, 'giu'))];
      const selected: number[] = [];
      let quote = '';
      for (let position = 0; position < expression.length; position++) {
        const character = expression[position];
        if (quote) { if (character === quote && expression[position - 1] !== '\\') quote = ''; continue; }
        if (character === '"' || character === "'") { quote = character; continue; }
        if (!matches.some(match => match.index + match[1].length === position)) continue;
        const before = expression.slice(0, position);
        const after = expression.slice(position + from.length);
        const safe = direct
          ? expression.trim().toLowerCase() === from.toLowerCase() || new RegExp(`^(?:note|this)\\.${escape(from)}$`, 'iu').test(expression.trim())
          : /(?:\b(?:note|this)\.|\blist\s*\(\s*)$/iu.test(before) ||
            /(?:^|[!&|\s])$/u.test(before) && /^(?:\s*(?:==|!=|<=|>=|<|>|\.|&&|\|\|)|\s*$)/u.test(after);
        if (!safe) blocked.push(`${label}: property key occurs in an unrecognized expression.`);
        else selected.push(position);
      }
      for (const position of selected) edits.push({ start: offset + position, end: offset + position + from.length, text: to });
    }
  };
  visitNode(doc.contents, [], false, false);
  if (blocked.length) return { after: source, blocked };
  let after = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) after = after.slice(0, edit.start) + edit.text + after.slice(edit.end);
  return { after, blocked };
}
