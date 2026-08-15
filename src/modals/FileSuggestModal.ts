import { App, FuzzySuggestModal, Notice, TFile } from "obsidian";
import * as logger from '../logger';
import {
    isFilePropertiesCompanionPath,
    isFilePropertiesCompanionRecord,
} from '../services/file-properties-service';

export class FileSuggestModal extends FuzzySuggestModal<TFile> {
    private onChoose: (file: TFile) => void | Promise<void>;
    private readonly allowedExtensions: Set<string> | null;
    private readonly caseSensitiveExtensions: boolean;
    private readonly fileFilter: ((file: TFile) => boolean) | null;
    private readonly candidateFiles: readonly TFile[] | null;
    private readonly includeAllExtensions: boolean;

    constructor(
        app: App,
        onChoose: (file: TFile) => void | Promise<void>,
        options?: {
            extensions?: string[];
            caseSensitiveExtensions?: boolean;
            filter?: (file: TFile) => boolean;
            /** Opt-in source for callers that intentionally support non-Markdown files. */
            candidateFiles?: readonly TFile[];
            includeAllExtensions?: boolean;
        },
    ) {
        super(app);
        this.onChoose = onChoose;
        this.caseSensitiveExtensions = options?.caseSensitiveExtensions === true;
        this.fileFilter = typeof options?.filter === 'function' ? options.filter : null;
        this.candidateFiles = Array.isArray(options?.candidateFiles) ? options.candidateFiles : null;
        this.includeAllExtensions = options?.includeAllExtensions === true;
        this.allowedExtensions = Array.isArray(options?.extensions) && options.extensions.length > 0
            ? new Set(options.extensions
                .map((value) => this.normalizeExtension(value))
                .filter(Boolean))
            : null;
    }

    getItems(): TFile[] {
        const source = this.candidateFiles ?? this.app.vault.getAllLoadedFiles();
        const files = source.filter((file): file is TFile => (
            file instanceof TFile && !this.isFilePropertiesCompanion(file)
        ));
        const extensionFiltered = this.includeAllExtensions
            ? files
            : !this.allowedExtensions
            ? files.filter((file) => file.extension?.toLowerCase() === 'md')
            : files.filter((file) => this.allowedExtensions!.has(this.normalizeExtension(file.extension)));
        return this.fileFilter ? extensionFiltered.filter(this.fileFilter) : extensionFiltered;
    }

    getItemText(item: TFile): string {
        return item.path;
    }

    onChooseItem(item: TFile, evt: MouseEvent | KeyboardEvent): void {
        void Promise.resolve(this.onChoose(item)).catch((error) => {
            logger.flowError('FileSuggestModal', 'choose:failed', error, { path: item.path });
            new Notice('Could not complete the file action.');
        });
    }

    private normalizeExtension(value: unknown): string {
        const extension = String(value || '').trim();
        return this.caseSensitiveExtensions ? extension : extension.toLowerCase();
    }

    private isFilePropertiesCompanion(file: TFile): boolean {
        if (isFilePropertiesCompanionPath(file.path)) return true;
        return isFilePropertiesCompanionRecord(this.app.metadataCache.getFileCache(file)?.frontmatter);
    }
}
