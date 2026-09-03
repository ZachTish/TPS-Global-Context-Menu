import { TFile } from 'obsidian';
import {
    matchesAutomaticMutationPathExclusion,
    parseAutomaticMutationExclusionPatterns,
} from '../utils/template-protection';

/**
 * Determines whether a file should be excluded from automatic frontmatter writes.
 * Parses the raw newline/comma-separated exclusion patterns from settings and
 * matches them against file paths and basenames.
 */
export class AutoFrontmatterExclusionService {
    constructor(private getExclusionPatterns: () => string) {}

    shouldIgnore(file: TFile): boolean {
        if (!(file instanceof TFile)) return false;
        const patterns = this.parsePatterns();
        if (!patterns.length) return false;
        const normalizedPath = this.normalizePath(file.path);
        const normalizedBasename = this.normalizePath(file.basename);
        return patterns.some((pattern) =>
            this.matchesPattern(normalizedPath, normalizedBasename, pattern),
        );
    }

    matchesPattern(
        normalizedPath: string,
        normalizedBasename: string,
        rawPattern: string,
    ): boolean {
        return matchesAutomaticMutationPathExclusion(
            normalizedPath,
            normalizedBasename,
            rawPattern,
        );
    }

    private parsePatterns(): string[] {
        return parseAutomaticMutationExclusionPatterns(this.getExclusionPatterns());
    }

    private normalizePath(value: string): string {
        return String(value || '')
            .trim()
            .replace(/^\/+/, '')
            .replace(/\/+$/, '')
            .toLowerCase();
    }

}
