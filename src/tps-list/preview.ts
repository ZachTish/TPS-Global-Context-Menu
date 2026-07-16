import { App, TFile } from 'obsidian';

export const NATIVE_PREVIEW_SOURCE = 'tps-kanban';

type PreviewPointerEvent = MouseEvent | PointerEvent;

export function openNativeNotePreview(
  app: App,
  event: PreviewPointerEvent,
  targetEl: HTMLElement,
  file: TFile,
  hoverParent: unknown,
  sourcePath = file.path,
  linktext = file.path,
): void {
  const payload = {
    event,
    source: NATIVE_PREVIEW_SOURCE,
    hoverParent,
    targetEl,
    linktext,
    sourcePath,
  };

  app.workspace.trigger('hover-link' as any, payload);
}
