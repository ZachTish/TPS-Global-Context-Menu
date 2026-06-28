export interface CardTaskPreview {
  internalId: string;
  line: number;
  text: string;
  displayText: string;
}

export interface CardContentOptions {
  openTaskLimit?: number;
}

export interface CardContent {
  openTasks: CardTaskPreview[];
  overflowCount: number;
}

export class CardContentService {
  extractOpenTasksFromMarkdown(filePath: string, content: string, options: CardContentOptions = {}): CardContent {
    const limit = this.normalizeLimit(options.openTaskLimit);
    const allTasks: CardTaskPreview[] = [];
    const lines = String(content || '').split(/\r?\n/);

    lines.forEach((line, index) => {
      const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+\[([^\]]*)\]\s+(.+)$/);
      if (!match) return;
      const status = match[1] ?? '';
      if (status.trim()) return;
      const text = this.cleanTaskText(match[2] ?? '');
      if (!text) return;
      const lineNumber = index + 1;
      allTasks.push({
        internalId: `${filePath}:${lineNumber}`,
        line: lineNumber,
        text,
        displayText: this.toDisplayText(text),
      });
    });

    const visibleTasks = allTasks.slice(0, limit);
    return {
      openTasks: visibleTasks,
      overflowCount: Math.max(0, allTasks.length - visibleTasks.length),
    };
  }

  cleanTaskText(text: string): string {
    return String(text || '')
      .replace(/\s+\^[A-Za-z0-9-]+$/u, '')
      .replace(/<!--.*?-->/gu, '')
      .trim();
  }

  private toDisplayText(text: string): string {
    return this.cleanTaskText(text)
      .replace(/!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu, '$1')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/gu, '$2')
      .replace(/\[\[([^\]]+)\]\]/gu, '$1')
      .replace(/!\[([^\]]*)\]\([^)]+\)/gu, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
      .replace(/`([^`]+)`/gu, '$1')
      .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/gu, '$1')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  private normalizeLimit(value: unknown): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return 5;
    return Math.max(0, Math.min(20, Math.floor(numeric)));
  }
}
