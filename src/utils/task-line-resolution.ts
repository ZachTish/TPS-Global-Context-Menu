import { getTaskDisplayTitle, parseTaskLine } from './task-line-metadata';
import { hashSelectionIdentity } from './selection-identity';

export interface TaskLineCandidateMetadata {
  lineCount: number;
  orderedLineIndex?: unknown;
  pluginLine?: unknown;
  renderedLine?: unknown;
}

export interface TaskLineResolutionInput {
  lines: string[];
  candidateIndexes: number[];
  targetTexts: string[];
  exactTaskText?: string;
  exactLineIdentity?: string;
  requireExactLineIdentity?: boolean;
}

export function buildTaskLineCandidateIndexes(metadata: TaskLineCandidateMetadata): number[] {
  const candidates: number[] = [];
  const add = (value: unknown, oneBased: boolean) => {
    if (value == null || value === '') return;
    const raw = Number(value);
    if (!Number.isFinite(raw)) return;
    const lineIndex = Math.floor(raw) - (oneBased ? 1 : 0);
    if (lineIndex < 0 || lineIndex >= metadata.lineCount || candidates.includes(lineIndex)) return;
    candidates.push(lineIndex);
  };

  add(metadata.orderedLineIndex, false);
  add(metadata.pluginLine, true);
  add(metadata.renderedLine, false);
  return candidates;
}

export function resolveTaskLineIndex(input: TaskLineResolutionInput): number {
  const hasExactTaskText = input.exactTaskText !== undefined;
  const exactTaskText = normalizeTaskResolutionText(input.exactTaskText || '');
  const exactLineIdentity = String(input.exactLineIdentity || '').trim();
  const targetTexts = input.targetTexts
    .map((value) => normalizeTaskResolutionText(value))
    .filter(Boolean);
  const matches = (line: string): boolean => {
    const parsed = parseTaskLine(line || '');
    if (!parsed) return false;
    const displayTitle = getTaskDisplayTitle(line || '');
    const lineText = normalizeTaskResolutionText(hasExactTaskText ? displayTitle : displayTitle || parsed.body);
    if (hasExactTaskText) return lineText === exactTaskText;
    if (!targetTexts.length) return true;
    if (!lineText) return false;
    return targetTexts.some((targetText) =>
      lineText === targetText
      || lineText.includes(targetText)
      || targetText.includes(lineText)
    );
  };

  if (exactLineIdentity) {
    const identityMatches = input.lines.reduce<number[]>((indexes, line, index) => {
      if (parseTaskLine(line || '') && getTaskLineIdentity(line || '') === exactLineIdentity) indexes.push(index);
      return indexes;
    }, []);
    if (identityMatches.length > 0) {
      return identityMatches.length === 1 ? identityMatches[0] : -1;
    }
  }
  if (input.requireExactLineIdentity) return -1;

  if (hasExactTaskText) {
    const titleMatches = input.lines.reduce<number[]>((indexes, line, index) => {
      if (matches(line || '')) indexes.push(index);
      return indexes;
    }, []);
    return titleMatches.length === 1 ? titleMatches[0] : -1;
  }

  for (const candidateIndex of input.candidateIndexes) {
    if (matches(input.lines[candidateIndex] || '')) return candidateIndex;
  }

  const matchesByIdentity = input.lines.reduce<number[]>((indexes, line, index) => {
    if (matches(line || '')) indexes.push(index);
    return indexes;
  }, []);
  return matchesByIdentity.length === 1 ? matchesByIdentity[0] : -1;
}

export function getTaskLineIdentity(line: string): string {
  return hashSelectionIdentity(String(line || '').replace(/\r$/u, ''));
}

function normalizeTaskResolutionText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
