export type PointerDragPreview = {
  el: HTMLElement;
};

export function createPointerDragPreview(
  ownerDocument: Document,
  title: string,
  itemCount: number,
  clientX: number,
  clientY: number,
): PointerDragPreview {
  const count = Math.max(1, Math.trunc(itemCount || 1));
  const preview = ownerDocument.createElement('div');
  preview.className = 'tps-gcm-pointer-drag-preview';
  preview.setAttribute('aria-hidden', 'true');

  const icon = ownerDocument.createElement('span');
  icon.className = 'tps-gcm-pointer-drag-preview__icon';
  icon.textContent = count > 1 ? String(count) : '↗';
  preview.appendChild(icon);

  const label = ownerDocument.createElement('span');
  label.className = 'tps-gcm-pointer-drag-preview__label';
  label.textContent = count > 1
    ? `${count} selected tasks`
    : String(title || '').trim() || 'Task item';
  preview.appendChild(label);

  ownerDocument.body.appendChild(preview);
  movePointerDragPreview({ el: preview }, clientX, clientY);
  return { el: preview };
}

export function movePointerDragPreview(
  preview: PointerDragPreview | null | undefined,
  clientX: number,
  clientY: number,
): void {
  if (!preview?.el?.isConnected) return;
  const view = preview.el.ownerDocument?.defaultView;
  const bounds = preview.el.getBoundingClientRect?.();
  const width = Math.max(40, Number(bounds?.width) || 0);
  const height = Math.max(30, Number(bounds?.height) || 0);
  const maxX = view ? Math.max(8, view.innerWidth - width - 8) : Number.POSITIVE_INFINITY;
  const maxY = view ? Math.max(8, view.innerHeight - height - 8) : Number.POSITIVE_INFINITY;
  const x = Math.max(8, Math.min(clientX + 16, maxX));
  const y = Math.max(8, Math.min(clientY + 16, maxY));
  preview.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
}

export function removePointerDragPreview(preview: PointerDragPreview | null | undefined): void {
  preview?.el?.remove();
}
