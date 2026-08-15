import { App, FuzzySuggestModal, Notice, TFile } from "obsidian";
import * as logger from '../logger';

export class FileSuggestModal extends FuzzySuggestModal<TFile> {
    private onChoose: (file: TFile) => void | Promise<void>;
    private readonly allowedExtensions: Set<string> | null;
    private readonly caseSensitiveExtensions: boolean;
    private readonly fileFilter: ((file: TFile) => boolean) | null;

    constructor(
        app: App,
        onChoose: (file: TFile) => void | Promise<void>,
        options?: {
            extensions?: string[];
            caseSensitiveExtensions?: boolean;
            filter?: (file: TFile) => boolean;
        },
    ) {
        super(app);
        this.onChoose = onChoose;
        this.caseSensitiveExtensions = options?.caseSensitiveExtensions === true;
        this.fileFilter = typeof options?.filter === 'function' ? options.filter : null;
        this.allowedExtensions = Array.isArray(options?.extensions) && options.extensions.length > 0
            ? new Set(options.extensions
                .map((value) => this.normalizeExtension(value))
                .filter(Boolean))
            : null;
    }

    getItems(): TFile[] {
        const files = this.app.vault.getAllLoadedFiles().filter((file): file is TFile => file instanceof TFile);
        const extensionFiltered = !this.allowedExtensions
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
}
