import { TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../../main';
import { deleteValueCaseInsensitive, findKeyCaseInsensitive, setValueCaseInsensitive } from '../../core';
import {
  extractLinkTargetsFromText,
  normalizeLinkTarget,
  parseLinksFromFrontmatterValue,
  resolveLinkTargetToFile,
} from '../link-target-service';
import type { ResolvedParentLink } from '../subitem-types';
import { SharedScheduleService } from './schedule-service';
import { SharedStatusService } from './status-service';

type FrontmatterMutator = (frontmatter: Record<string, unknown>) => void;

export type GcmSharedServices = ReturnType<typeof createSharedServices>;

export function createSharedServices(plugin: TPSGlobalContextMenuPlugin) {
  const statusService = new SharedStatusService(plugin);
  const scheduleService = new SharedScheduleService();

  const links = {
    normalizeTarget: (rawTarget: string) => normalizeLinkTarget(rawTarget),
    extractTargetsFromText: (text: string, allowBareValue = false) => extractLinkTargetsFromText(text, allowBareValue),
    extractTargetsFromValue: (value: unknown, allowBareValue = true): string[] => {
      const output: string[] = [];
      const seen = new Set<string>();
      const add = (target: string) => {
        const normalized = normalizeLinkTarget(target);
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        output.push(normalized);
      };
      const walk = (candidate: unknown): void => {
        if (candidate == null) return;
        if (Array.isArray(candidate)) {
          candidate.forEach(walk);
          return;
        }
        if (typeof candidate === 'object') {
          Object.values(candidate as Record<string, unknown>).forEach(walk);
          return;
        }
        const text = String(candidate || '').trim();
        if (!text) return;
        const extracted = extractLinkTargetsFromText(text, allowBareValue);
        if (extracted.length) extracted.forEach(add);
        else add(text);
      };
      walk(value);
      return output;
    },
    resolveToFile: (rawTarget: string, sourcePath: string): TFile | null =>
      resolveLinkTargetToFile(plugin.app, rawTarget, sourcePath),
    resolveToPath: (rawTarget: string, sourcePath: string): string | null =>
      resolveLinkTargetToFile(plugin.app, rawTarget, sourcePath)?.path ?? null,
    parseFrontmatterLinks: (value: unknown, sourcePath: string): TFile[] =>
      parseLinksFromFrontmatterValue(plugin.app, value, sourcePath),
  };

  const frontmatter = {
    process: (file: TFile, mutator: FrontmatterMutator) =>
      plugin.frontmatterMutationService.process(file, mutator),
    setValues: (files: TFile[], updates: Record<string, unknown>) =>
      plugin.frontmatterMutationService.updateValues(files, updates),
    setListValues: (files: TFile[], key: string, values: unknown[]) =>
      plugin.frontmatterMutationService.setListValues(files, key, values),
    addListValues: (files: TFile[], key: string, values: unknown[]) =>
      plugin.frontmatterMutationService.addValuesToList(files, key, values),
    removeListValues: (files: TFile[], key: string, values: unknown[]) =>
      plugin.frontmatterMutationService.removeValuesFromList(files, key, values),
    setDateValue: (files: TFile[], key: string, value: string | null) =>
      plugin.frontmatterMutationService.setDateValue(files, key, value),
    deleteKeys: (files: TFile[], keys: string[]) =>
      plugin.frontmatterMutationService.deleteKeys(files, keys),
    findKey: (record: Record<string, unknown>, key: string) => findKeyCaseInsensitive(record, key),
    setValue: (record: Record<string, unknown>, key: string, value: unknown) =>
      setValueCaseInsensitive(record, key, value),
    deleteValue: (record: Record<string, unknown>, key: string) =>
      deleteValueCaseInsensitive(record, key),
  };

  const parents = {
    getParentKey: () => plugin.parentLinkResolutionService.getParentKey(),
    getParentKeys: (): string[] => Array.from(new Set([
      plugin.parentLinkResolutionService.getParentKey(),
      'parent',
      'childOf',
    ].map((key) => String(key || '').trim()).filter(Boolean))),
    getParentsForChild: (childFile: TFile): ResolvedParentLink[] =>
      plugin.parentLinkResolutionService.getParentsForChild(childFile),
    getParentFile: (childFile: TFile): TFile | null =>
      plugin.parentLinkResolutionService.getParentsForChild(childFile)[0]?.file ?? null,
    hasParent: (childFile: TFile, parentFile: TFile) =>
      plugin.parentLinkResolutionService.hasParent(childFile, parentFile),
    addParentToChild: (childFile: TFile, parentFile: TFile) =>
      plugin.parentLinkResolutionService.addParentToChild(childFile, parentFile),
    ensureSelfLinkForParent: (parentFile: TFile) =>
      plugin.parentLinkResolutionService.ensureSelfLinkForParent(parentFile),
    removeParentFromChild: (childFile: TFile, parentFile: TFile) =>
      plugin.parentLinkResolutionService.removeParentFromChild(childFile, parentFile),
    reconcileMarkdownParent: (file: TFile) =>
      plugin.subitemRelationshipSyncService.reconcileMarkdownParent(file),
  };

  const recurrence = {
    getCompletionStatuses: () => statusService.getDoneStatuses(),
    isCompletionStatus: (rawStatus: unknown) => statusService.isDoneStatus(rawStatus),
    getStaleInstanceFields: () => ['sort', 'hidden', 'icon', 'color', 'isRecurrenceTemplate', 'completedDate'],
    stripStaleInstanceFields: (frontmatterRecord: Record<string, unknown>) => {
      for (const key of recurrence.getStaleInstanceFields()) {
        deleteValueCaseInsensitive(frontmatterRecord, key);
      }
    },
    checkMissingRecurrences: () => plugin.bulkEditService.checkMissingRecurrences(),
  };

  const identity = Object.assign(plugin.identityService, {
    getTpsId: (frontmatterRecord: Record<string, unknown> | null | undefined): string | null =>
      plugin.identityService.getInternalId(frontmatterRecord),
    setTpsId: (frontmatterRecord: Record<string, unknown>, id: string) =>
      plugin.identityService.setInternalId(frontmatterRecord, id),
  });

  const visualMetadata = {
    getIconField: (): string => {
      return String(plugin.settings.notebookNavigatorRules?.frontmatterIconField || 'icon').trim() || 'icon';
    },
    getColorField: (): string => {
      return String(plugin.settings.notebookNavigatorRules?.frontmatterColorField || 'color').trim() || 'color';
    },
    getIconValue: (frontmatterRecord: Record<string, unknown> | null | undefined): string => {
      const key = visualMetadata.getIconField();
      const actual = frontmatterRecord ? findKeyCaseInsensitive(frontmatterRecord, key) : null;
      return actual ? String(frontmatterRecord?.[actual] ?? '').trim() : '';
    },
    getColorValue: (frontmatterRecord: Record<string, unknown> | null | undefined): string => {
      const key = visualMetadata.getColorField();
      const actual = frontmatterRecord ? findKeyCaseInsensitive(frontmatterRecord, key) : null;
      return actual ? String(frontmatterRecord?.[actual] ?? '').trim() : '';
    },
  };

  return {
    status: statusService,
    frontmatter,
    links,
    parents,
    schedule: scheduleService,
    timeTracking: plugin.timeTrackingService,
    recurrence,
    identity,
    cardContent: plugin.cardContentService,
    visualMetadata,
  };
}
