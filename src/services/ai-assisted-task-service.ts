import { Notice, TFile, moment, normalizePath } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { AiAssistedTaskModal } from '../modals/ai-assisted-task-modal';
import { buildCreatedTaskLine } from '../utils/create-task-parser';
import { findAfterFrontmatterIndex, updateTaskLineTimestamps } from '../utils/task-line-metadata';
import {
  isLinkedSubitemSemanticCheckboxPlanCurrent,
  normalizeLinkedSubitemCheckboxState,
  normalizeLinkedSubitemMappings,
  resolveLinkedSubitemSemanticCheckboxPlanForStatus,
  type LinkedSubitemSemanticCheckboxPlan,
} from '../utils/linked-subitem-mapping';
import * as logger from '../logger';

export interface AiTaskCreationContext {
  originalInput?: string;
  contextProfile?: 'compact-task-routing-v1';
  taskTitleHint?: string | null;
  routeHint?: string | null;
  activeFilePath?: string | null;
  todayDailyNotePath?: string | null;
  allowedTargetFilePaths?: string[];
  requestTerms?: string[];
  requestIntent?: string[];
  noteCandidates: Array<{
    path: string;
    basename: string;
    excerpt?: string;
    signals?: string[];
    score?: number;
    headings?: string[];
    matchingLines?: string[];
  }>;
  baseCandidates: Array<{
    path: string;
    basename: string;
    excerpt?: string;
  }>;
  canvasCandidates: Array<{
    path: string;
    basename: string;
    excerpt?: string;
  }>;
  followUpMessages?: string[];
  previousProposal?: AiTaskCreationProposal | null;
}

interface ScoredFile {
  file: TFile;
  score: number;
}

interface CompactNoteContext {
  excerpt: string;
  headings: string[];
  matchingLines: string[];
}

export interface AiTaskCreationProposal {
  title: string;
  targetFilePath: string;
  checkboxMarker: string;
  semanticStatus: 'todo' | 'complete';
  semanticMappingStatuses: string[];
  priority: string;
  scheduledValue: string;
  allDay: boolean;
  timeEstimate: number;
  insertionStrategy: 'after_frontmatter' | 'under_heading';
  heading: string;
  rationale: string;
  confidence: number;
  warnings: string[];
}

export class AiAssistedTaskService {
  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  openAiAssistedTaskModal(): void {
    new AiAssistedTaskModal(this.plugin.app, this).open();
  }

  async propose(input: string, followUpMessages: string[], previousProposal: AiTaskCreationProposal | null): Promise<AiTaskCreationProposal> {
    const cleanInput = String(input || '').trim();
    if (!cleanInput) throw new Error('Task request is required.');

    const api = this.getAiAssistantApi();
    if (typeof api?.proposeTaskCreation !== 'function') {
      throw new Error('TPS AI Assistant is not loaded or does not expose task creation.');
    }

    const baseContext = await this.buildContext(cleanInput, followUpMessages, previousProposal);
    const semanticStatus: 'todo' | 'complete' = this.inputImpliesCompletion(baseContext) ? 'complete' : 'todo';
    const semanticPlan = this.resolveSemanticCheckboxPlan(semanticStatus);
    if (!semanticPlan) {
      throw new Error('The requested task state does not have a valid checkbox mapping.');
    }
    const semanticCheckboxMarker = semanticPlan.checkboxState.slice(1, -1);

    let lastError: Error | null = null;
    let rejectedProposal: AiTaskCreationProposal | null = previousProposal;

    for (let attempt = 0; attempt < 2; attempt++) {
      const context = attempt === 0
        ? baseContext
        : {
          ...baseContext,
          previousProposal: rejectedProposal,
          followUpMessages: [
            ...(baseContext.followUpMessages || []),
            `The previous proposal was rejected by validation: ${lastError?.message || 'unknown error'}. Return a corrected proposal for the original request only.`,
          ],
        };
      const proposed = await api.proposeTaskCreation(cleanInput, context) as AiTaskCreationProposal;
      const proposal = proposed && typeof proposed === 'object'
        ? {
          ...proposed,
          checkboxMarker: semanticCheckboxMarker,
          semanticStatus,
          semanticMappingStatuses: [...semanticPlan.statuses],
        }
        : proposed;
      try {
        this.validateProposal(proposal, context);
        return proposal;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        rejectedProposal = proposal;
      }
    }

    throw lastError || new Error('Task model did not return a valid proposal.');
  }

  buildTaskLine(proposal: AiTaskCreationProposal): string {
    const creationPlan = this.resolveAcceptedSemanticCheckboxPlan(
      proposal.checkboxMarker,
      proposal.semanticStatus,
    );
    if (!creationPlan || !this.proposalMappingMatchesPlan(proposal, creationPlan)) {
      throw new Error('AI task checkbox marker is not a configured Todo or Complete mapping.');
    }
    const checkboxMarker = creationPlan.checkboxState.slice(1, -1);
    return buildCreatedTaskLine({
      title: proposal.title,
      checkboxMarker,
      priority: proposal.priority,
      scheduledValue: proposal.scheduledValue,
      allDay: proposal.allDay,
      timeEstimate: proposal.timeEstimate,
    });
  }

  async accept(proposal: AiTaskCreationProposal): Promise<TFile | null> {
    const creationPlan = this.resolveAcceptedSemanticCheckboxPlan(
      proposal.checkboxMarker,
      proposal.semanticStatus,
    );
    if (!creationPlan || !this.proposalMappingMatchesPlan(proposal, creationPlan)) {
      logger.warn('[TPS GCM] AI task creation blocked because its semantic checkbox mapping is unavailable', {
        checkboxMarker: String(proposal.checkboxMarker ?? ''),
        semanticStatus: String(proposal.semanticStatus ?? ''),
      });
      new Notice('The AI task checkbox is no longer configured.');
      return null;
    }
    const checkboxMarker = creationPlan.checkboxState.slice(1, -1);
    const targetFile = this.resolveMarkdownFile(proposal.targetFilePath);
    if (!targetFile) {
      new Notice('AI task target no longer exists.');
      return null;
    }

    const createdTaskLine = buildCreatedTaskLine({
      title: proposal.title,
      checkboxMarker,
      priority: proposal.priority,
      scheduledValue: proposal.scheduledValue,
      allDay: proposal.allDay,
      timeEstimate: proposal.timeEstimate,
    });
    const taskLine = updateTaskLineTimestamps(createdTaskLine, {
      enabled: this.plugin.settings.autoSyncFileTimestamps === true,
      createdKey: this.plugin.settings.dateCreatedFrontmatterKey,
      modifiedKey: this.plugin.settings.dateModifiedFrontmatterKey,
      format: this.plugin.settings.fileTimestampFormat,
      markCreated: true,
      markModified: true,
    });
    try {
      let mappingChanged = false;
      await this.plugin.app.vault.process(targetFile, (content) => {
        if (!isLinkedSubitemSemanticCheckboxPlanCurrent(
          this.getConfiguredMappings(),
          creationPlan,
          {
            normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value),
            normalizedMappings: true,
          },
        )) {
          mappingChanged = true;
          return content;
        }
        return this.insertTaskLine(content, taskLine, proposal);
      });
      if (mappingChanged) {
        logger.warn('[TPS GCM] AI task creation blocked because its semantic checkbox mapping changed before write', {
          checkboxMarker,
          semanticStatus: creationPlan.status,
          targetPath: targetFile.path,
        });
        new Notice('The AI task checkbox mapping changed. Regenerate the proposal and try again.');
        return null;
      }
      new Notice(`Created AI-assisted task in ${targetFile.basename}`);
      await this.plugin.openFileInLeaf(targetFile, false, () => this.plugin.app.workspace.getLeaf(false), { revealLeaf: true });
      return targetFile;
    } catch (error) {
      logger.error('[TPS GCM] Failed to apply AI-assisted task proposal', error);
      new Notice('Unable to create AI-assisted task. Check console logs.');
      return null;
    }
  }

  private getAiAssistantApi(): any {
    return (this.plugin.app as any).plugins?.plugins?.['tps-ai-assistant']?.api ?? null;
  }

  private async buildContext(
    input: string,
    followUpMessages: string[],
    previousProposal: AiTaskCreationProposal | null,
  ): Promise<AiTaskCreationContext> {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    const todayDailyNotePath = this.getTodayDailyNotePath();
    const allFiles = this.plugin.app.vault.getAllLoadedFiles().filter((file): file is TFile => file instanceof TFile);
    const mdFiles = allFiles.filter((file) => file.extension.toLowerCase() === 'md');
    const baseFiles = allFiles.filter((file) => file.extension.toLowerCase() === 'base');
    const canvasFiles = allFiles.filter((file) => file.extension.toLowerCase() === 'canvas');
    const requestTerms = this.queryTerms(input);
    const terms = this.queryTerms([input, ...followUpMessages].join(' '));
    const intent = this.requestIntent(input);
    const routeParts = this.extractAddToListParts(input);

    const noteCandidates = this.rankFileCandidates(mdFiles, terms, intent, activeFile?.path ?? null, todayDailyNotePath).slice(0, 6);
    const baseCandidates = this.rankFileCandidates(baseFiles, terms, intent, activeFile?.path ?? null, todayDailyNotePath).slice(0, 4);
    const canvasCandidates = this.rankFileCandidates(canvasFiles, terms, intent, activeFile?.path ?? null, todayDailyNotePath).slice(0, 4);

    const compactContextByPath = new Map<string, CompactNoteContext>();
    await Promise.all(noteCandidates.map(async ({ file }) => {
      compactContextByPath.set(file.path, await this.readCompactNoteContext(file, terms));
    }));
    const contextSignalByPath = new Map<string, string>();
    await Promise.all([...baseCandidates, ...canvasCandidates].map(async ({ file }) => {
      contextSignalByPath.set(file.path, await this.readContextSignal(file, terms));
    }));

    return {
      originalInput: input,
      contextProfile: 'compact-task-routing-v1',
      taskTitleHint: routeParts?.item ?? null,
      routeHint: routeParts?.route ?? null,
      activeFilePath: activeFile?.path ?? null,
      todayDailyNotePath,
      requestTerms,
      requestIntent: intent,
      allowedTargetFilePaths: noteCandidates.map(({ file }) => file.path),
      noteCandidates: noteCandidates.map(({ file, score }) => ({
        path: file.path,
        basename: file.basename,
        score,
        excerpt: compactContextByPath.get(file.path)?.excerpt || '',
        headings: compactContextByPath.get(file.path)?.headings || [],
        matchingLines: compactContextByPath.get(file.path)?.matchingLines || [],
        signals: this.fileSignals(file, todayDailyNotePath),
      })),
      baseCandidates: baseCandidates.map(({ file }) => ({
        path: file.path,
        basename: file.basename,
        excerpt: contextSignalByPath.get(file.path) || '',
      })),
      canvasCandidates: canvasCandidates.map(({ file }) => ({
        path: file.path,
        basename: file.basename,
        excerpt: contextSignalByPath.get(file.path) || '',
      })),
      followUpMessages,
      previousProposal,
    };
  }

  private rankFileCandidates(files: TFile[], terms: string[], intent: string[], activePath: string | null, todayDailyNotePath: string | null): ScoredFile[] {
    const scored = [...files]
      .map((file) => ({ file, score: this.fileScore(file, terms, intent, activePath, todayDailyNotePath) }))
      .filter((item) => item.score > 0);
    if (!scored.length) {
      return [...files]
        .map((file) => ({ file, score: this.fileScore(file, terms, intent, activePath, todayDailyNotePath, true) }))
        .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
    }
    return scored.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
  }

  private rankFiles(files: TFile[], terms: string[], intentOrActivePath: string[] | string | null, activePath?: string | null, todayDailyNotePath?: string | null): TFile[] {
    const intent = Array.isArray(intentOrActivePath) ? intentOrActivePath : [];
    const resolvedActivePath = Array.isArray(intentOrActivePath) ? activePath ?? null : intentOrActivePath;
    const resolvedDailyPath = Array.isArray(intentOrActivePath) ? todayDailyNotePath ?? null : activePath ?? null;
    return this.rankFileCandidates(files, terms, intent, resolvedActivePath, resolvedDailyPath).map((item) => item.file);
  }

  private fileScore(file: TFile, terms: string[], intent: string[], activePath: string | null, todayDailyNotePath: string | null, allowWeak = false): number {
    const haystack = `${file.basename} ${file.path}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (haystack.includes(term)) score += term.length >= 5 ? 10 : 4;
    }
    if (intent.includes('shopping') && /grocery|shopping|shop|shopping-item|toget|to get/i.test(haystack)) score += 30;
    if (intent.includes('shopping') && /list|todo|task/i.test(file.basename)) score += 8;
    if (file.path === activePath) score += allowWeak ? 3 : 0;
    if (file.path === todayDailyNotePath) score += allowWeak ? 2 : 0;
    if (!intent.length && /list|todo|task/i.test(file.basename)) score += 1;
    return score;
  }

  private fileSignals(file: TFile, todayDailyNotePath: string | null): string[] {
    const signals: string[] = [];
    if (file.path === this.plugin.app.workspace.getActiveFile()?.path) signals.push('active file');
    if (file.path === todayDailyNotePath) signals.push('today daily note');
    if (this.isDailyNoteFile(file)) signals.push('daily note');
    if (/grocery|shopping|shop|toget|to get/i.test(file.basename)) signals.push('shopping-like title');
    if (/list|todo|task/i.test(file.basename)) signals.push('list-like title');
    return signals;
  }

  private queryTerms(input: string): string[] {
    const stop = new Set(['add', 'task', 'todo', 'the', 'to', 'in', 'on', 'for', 'a', 'an', 'my', 'into', 'please', 'list']);
    return Array.from(new Set(String(input || '')
      .toLowerCase()
      .replace(/#[a-z0-9_/-]+/g, ' ')
      .split(/[^a-z0-9]+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && !stop.has(term))));
  }

  private requestIntent(input: string): string[] {
    const normalized = String(input || '').toLowerCase();
    const intents: string[] = [];
    if (/\b(grocer(?:y|ies)|shopping|shop|costco|walmart|target|store|buy|pickles?|milk|bread|eggs?)\b/.test(normalized)) {
      intents.push('shopping');
    }
    return intents;
  }

  private validateProposal(proposal: AiTaskCreationProposal, context: AiTaskCreationContext): void {
    if (!proposal || typeof proposal !== 'object') throw new Error('Task model did not return a proposal.');
    if (!String(proposal.title || '').trim()) throw new Error('Task model returned an empty task title.');
    const titleTerms = this.queryTerms(String(proposal.title || ''));
    const meaningfulRequestTerms = (context.requestTerms || []).filter((term) => term.length >= 3);
    if (meaningfulRequestTerms.length && !meaningfulRequestTerms.some((term) => titleTerms.includes(term))) {
      throw new Error(`Task model returned an unrelated task title: ${proposal.title}`);
    }
    const routedListItem = this.addToListItem(context);
    if (routedListItem) {
      const normalizedTitle = this.normalizeTaskText(proposal.title);
      const normalizedItem = this.normalizeTaskText(routedListItem);
      if (!normalizedTitle.includes(normalizedItem)) {
        throw new Error(`Task model did not preserve the requested list item: ${routedListItem}`);
      }
      if (/\b(add|list|grocery|shopping)\b/i.test(normalizedTitle.replace(normalizedItem, ''))) {
        throw new Error(`Task model kept routing words in the task title: ${proposal.title}`);
      }
    }
    const expectedSemanticStatus = this.inputImpliesCompletion(context) ? 'complete' : 'todo';
    const expectedCheckboxMarker = this.resolveSemanticCheckboxMarker(expectedSemanticStatus);
    if (
      proposal.semanticStatus !== expectedSemanticStatus
      || !expectedCheckboxMarker
      || proposal.checkboxMarker !== expectedCheckboxMarker
      || !this.proposalMappingMatchesPlan(
        proposal,
        this.resolveSemanticCheckboxPlan(expectedSemanticStatus),
      )
    ) {
      throw new Error('Task proposal does not match the configured semantic checkbox mapping.');
    }
    if (!this.inputImpliesPriority(context) && String(proposal.priority || '').trim()) {
      throw new Error(`Task model invented priority ${JSON.stringify(proposal.priority)}.`);
    }
    if (!this.inputImpliesSchedule(context) && String(proposal.scheduledValue || '').trim()) {
      throw new Error(`Task model invented scheduled value ${JSON.stringify(proposal.scheduledValue)}.`);
    }
    if (!this.inputImpliesDuration(context) && Number(proposal.timeEstimate || 0) > 0) {
      throw new Error(`Task model invented time estimate ${proposal.timeEstimate}.`);
    }
    const allowedTargets = new Set(context.noteCandidates.map((candidate) => normalizePath(candidate.path)));
    const targetPath = normalizePath(String(proposal.targetFilePath || ''));
    if (!allowedTargets.has(targetPath)) {
      throw new Error(`Task model selected an invalid markdown target: ${proposal.targetFilePath || '(empty)'}`);
    }
    if (!this.resolveMarkdownFile(targetPath)) {
      throw new Error(`Task model selected a missing markdown target: ${targetPath}`);
    }
  }

  private resolveSemanticCheckboxMarker(status: 'todo' | 'complete'): string | null {
    const plan = this.resolveSemanticCheckboxPlan(status);
    return plan ? plan.checkboxState.slice(1, -1) : null;
  }

  private resolveSemanticCheckboxPlan(status: 'todo' | 'complete'): LinkedSubitemSemanticCheckboxPlan | null {
    return resolveLinkedSubitemSemanticCheckboxPlanForStatus(
      this.getConfiguredMappings(),
      status,
      {
        normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value),
        normalizedMappings: true,
      },
    );
  }

  private resolveAcceptedSemanticCheckboxPlan(
    marker: unknown,
    status: unknown,
  ): LinkedSubitemSemanticCheckboxPlan | null {
    if (status !== 'todo' && status !== 'complete') return null;
    const plan = this.resolveSemanticCheckboxPlan(status);
    return plan && normalizeLinkedSubitemCheckboxState(marker) === plan.checkboxState
      ? plan
      : null;
  }

  private proposalMappingMatchesPlan(
    proposal: Pick<AiTaskCreationProposal, 'semanticMappingStatuses'>,
    plan: LinkedSubitemSemanticCheckboxPlan | null,
  ): boolean {
    if (!plan || !Array.isArray(proposal.semanticMappingStatuses)) return false;
    const statuses = proposal.semanticMappingStatuses
      .map((status) => this.plugin.sharedServices.status.normalize(status));
    return statuses.length === plan.statuses.length
      && statuses.every((status, index) => status === plan.statuses[index]);
  }

  private getConfiguredMappings() {
    return normalizeLinkedSubitemMappings(
      this.plugin.settings.linkedSubitemCheckboxMappings,
      {
        enforceStrictDefaults: false,
        normalizeStatus: (value) => this.plugin.sharedServices.status.normalize(value),
      },
    );
  }

  private inputImpliesCompletion(context: AiTaskCreationContext): boolean {
    return this.contextText(context).match(/\b(done|complete|completed|already\s+done|finished)\b/i) !== null;
  }

  private inputImpliesPriority(context: AiTaskCreationContext): boolean {
    return this.contextText(context).match(/\b(low|medium|normal|high|urgent|priority)\b/i) !== null;
  }

  private inputImpliesSchedule(context: AiTaskCreationContext): boolean {
    return this.contextText(context).match(/\b(today|tomorrow|tonight|morning|afternoon|evening|noon|midnight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}:\d{2}|\d{1,2}\s*(am|pm)|\d{4}-\d{2}-\d{2})\b/i) !== null;
  }

  private inputImpliesDuration(context: AiTaskCreationContext): boolean {
    return this.contextText(context).match(/\b(\d+\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)|time\s*estimate|duration)\b/i) !== null;
  }

  private contextText(context: AiTaskCreationContext): string {
    return [context.originalInput || '', context.requestTerms?.join(' ') || '', ...(context.followUpMessages || [])].join(' ');
  }

  private addToListItem(context: AiTaskCreationContext): string | null {
    return context.taskTitleHint || this.extractAddToListParts(this.contextText(context))?.item || null;
  }

  private extractAddToListParts(input: string): { item: string; route: string } | null {
    const match = String(input || '').match(/\badd\s+(.+?)\s+to\s+(?:the\s+)?(.+?)(?:\s+list)?(?:[.!?])?$/i);
    const item = match?.[1]?.trim();
    const route = match?.[2]?.trim();
    return item && route ? { item, route } : null;
  }

  private async readCompactNoteContext(file: TFile, terms: string[]): Promise<CompactNoteContext> {
    const content = await this.plugin.app.vault.cachedRead(file);
    const lines = content.split(/\r?\n/);
    const headings = lines
      .map((line) => line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1]?.trim() || '')
      .filter(Boolean)
      .slice(0, 8);
    const matchingLines = this.matchingContextLines(lines, terms, 8);
    const excerptSource = matchingLines.length
      ? matchingLines.join('\n')
      : lines.filter((line) => line.trim() && !line.match(/^---$/)).slice(0, 12).join('\n');
    return {
      headings,
      matchingLines,
      excerpt: this.trimContextText(excerptSource, 700),
    };
  }

  private async readContextSignal(file: TFile, terms: string[]): Promise<string> {
    const content = await this.plugin.app.vault.cachedRead(file);
    return this.trimContextText(this.matchingContextLines(content.split(/\r?\n/), terms, 6).join('\n'), 500);
  }

  private matchingContextLines(lines: string[], terms: string[], limit: number): string[] {
    const normalizedTerms = terms.map((term) => term.toLowerCase()).filter((term) => term.length >= 3);
    const matches = normalizedTerms.length
      ? lines.filter((line) => normalizedTerms.some((term) => line.toLowerCase().includes(term)))
      : [];
    return matches
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, limit);
  }

  private trimContextText(value: string, maxLength: number): string {
    const normalized = String(value || '').replace(/\s+\n/g, '\n').trim();
    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trim()}…`;
  }

  private normalizeTaskText(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/#[a-z0-9_/-]+/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private resolveMarkdownFile(path: string): TFile | null {
    const file = this.plugin.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile && file.extension.toLowerCase() === 'md' ? file : null;
  }

  private insertTaskLine(content: string, taskLine: string, proposal: AiTaskCreationProposal): string {
    if (proposal.insertionStrategy === 'under_heading' && proposal.heading.trim()) {
      const inserted = this.insertUnderHeading(content, taskLine, proposal.heading);
      if (inserted) return inserted;
    }
    return this.insertAfterFrontmatter(content, taskLine);
  }

  private insertUnderHeading(content: string, taskLine: string, heading: string): string | null {
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const endsWithNewline = /\r?\n$/.test(content);
    const lines = content.split(/\r?\n/);
    if (endsWithNewline) lines.pop();
    const cleanHeading = heading.trim().toLowerCase();
    const headingIndex = lines.findIndex((line) => {
      const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      return String(match?.[2] || '').trim().toLowerCase() === cleanHeading;
    });
    if (headingIndex < 0) return null;
    let insertIndex = headingIndex + 1;
    while (insertIndex < lines.length && lines[insertIndex].trim() === '') insertIndex++;
    lines.splice(insertIndex, 0, taskLine);
    return `${lines.join(newline)}${newline}`;
  }

  private insertAfterFrontmatter(content: string, taskLine: string): string {
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const endsWithNewline = /\r?\n$/.test(content);
    const lines = content.split(/\r?\n/);
    if (endsWithNewline) lines.pop();
    const insertIndex = findAfterFrontmatterIndex(lines);
    lines.splice(insertIndex, 0, '', taskLine);
    return `${lines.join(newline).replace(/\n{4,}/g, '\n\n\n')}${newline}`;
  }

  private getTodayDailyNotePath(): string | null {
    const format = this.plugin.fileNamingService.getDailyNoteDateFormat();
    const momentLib = (window as any).moment || (moment as any);
    const dateStr = momentLib().format(format || 'YYYY-MM-DD');
    const folder = this.getDailyNoteFolder();
    return normalizePath(`${folder}/${dateStr}.md`);
  }

  private isDailyNoteFile(file: TFile): boolean {
    const format = this.plugin.fileNamingService.getDailyNoteDateFormat();
    const momentLib = (window as any).moment || (moment as any);
    const parsed = momentLib(file.basename, [format || 'YYYY-MM-DD', 'YYYY-MM-DD', 'ddd, MMM DD YYYY'], true);
    return Boolean(parsed?.isValid?.() && parsed.isValid());
  }

  private getDailyNoteFolder(): string {
    try {
      const dailyNotesPlugin = (this.plugin.app as any).internalPlugins?.plugins?.['daily-notes'];
      const folder = String(dailyNotesPlugin?.instance?.options?.folder || '').trim();
      if (folder) return folder;
    } catch (error) {
      logger.warn('[TPS GCM] Failed to resolve Daily Notes folder for AI assisted task creation', error);
    }
    return 'System/Dailynotes';
  }
}
