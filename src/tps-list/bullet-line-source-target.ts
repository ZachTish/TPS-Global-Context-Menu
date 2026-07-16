import {
  normalizeTaskAssociatedNotePath,
  readInlineFieldValue,
  readTaskAssociatedNotePath,
} from '../utils/task-line-metadata';
import { visibleLineText } from '../views/log-line-utils';

const SOURCE_PATH_KEYS = ['sourcePath', 'foodPath', 'exercisePath', 'workoutPath'] as const;

export type BulletLineSourceRoute = 'association' | 'source-field' | 'visible-link';

export interface BulletLineSourceResolution {
  path: string;
  route: BulletLineSourceRoute;
  sourceKey: string | null;
}

export interface BulletLineSourceDecision {
  resolution: BulletLineSourceResolution | null;
  ambiguousVisibleTargets: boolean;
}

interface BulletLineSourceAdapters {
  resolveToPath: (target: string, sourcePath: string) => string | null;
  extractTargets: (text: string) => string[];
}

export function resolveBulletLineSourceTarget(
  rawLine: string,
  sourcePath: string,
  adapters: BulletLineSourceAdapters,
): BulletLineSourceDecision {
  const candidates: Array<{ target: string; route: BulletLineSourceRoute; sourceKey: string | null }> = [];
  const associatedPath = readTaskAssociatedNotePath(rawLine);
  if (associatedPath) {
    candidates.push({ target: associatedPath, route: 'association', sourceKey: 'associatedNotePath' });
  }
  for (const key of SOURCE_PATH_KEYS) {
    const target = normalizeTaskAssociatedNotePath(readInlineFieldValue(rawLine, key));
    if (target) candidates.push({ target, route: 'source-field', sourceKey: key });
  }

  const seenCandidates = new Set<string>();
  for (const candidate of candidates) {
    const normalizedTarget = candidate.target.toLowerCase();
    if (seenCandidates.has(normalizedTarget)) continue;
    seenCandidates.add(normalizedTarget);
    const resolvedPath = String(adapters.resolveToPath(candidate.target, sourcePath) || '').trim();
    if (resolvedPath) {
      return {
        resolution: {
          path: resolvedPath,
          route: candidate.route,
          sourceKey: candidate.sourceKey,
        },
        ambiguousVisibleTargets: false,
      };
    }
  }

  const resolvedVisiblePaths = new Map<string, string>();
  for (const target of adapters.extractTargets(visibleLineText(rawLine))) {
    const resolvedPath = String(adapters.resolveToPath(target, sourcePath) || '').trim();
    if (!resolvedPath) continue;
    resolvedVisiblePaths.set(resolvedPath.toLowerCase(), resolvedPath);
  }
  if (resolvedVisiblePaths.size === 1) {
    return {
      resolution: {
        path: Array.from(resolvedVisiblePaths.values())[0],
        route: 'visible-link',
        sourceKey: null,
      },
      ambiguousVisibleTargets: false,
    };
  }
  return {
    resolution: null,
    ambiguousVisibleTargets: resolvedVisiblePaths.size > 1,
  };
}
