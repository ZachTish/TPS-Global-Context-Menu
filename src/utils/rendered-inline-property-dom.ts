export const RENDERED_INLINE_LINE_HOST_SELECTOR =
  'li, p, div.task-list-item, div.HyperMD-list-line';

export const RENDERED_INLINE_EXCLUDED_TEXT_SELECTOR = [
  'pre',
  'code',
  '.dataview.inline-field',
  '.metadata-property',
  '.tps-gcm-rendered-inline-property-chip',
  '.tps-gcm-hidden-inline-property-rendered',
].join(', ');

export type RenderedTextNodeRange<T> = {
  node: T;
  start: number;
  end: number;
};

/**
 * A rendered list item can contain nested list items and property widgets.
 * Only text whose nearest line host is the block being processed belongs to
 * that block; native/GCM property widgets are already authoritative output.
 */
export function isOwnedRenderedInlineTextNode(
  block: Element,
  parent: Element | null,
): boolean {
  if (!parent) return false;
  if (parent.closest(RENDERED_INLINE_EXCLUDED_TEXT_SELECTOR)) return false;
  return parent.closest(RENDERED_INLINE_LINE_HOST_SELECTOR) === block;
}

export function isOwnedRenderedInlineElement(block: Element, element: Element): boolean {
  return element.closest(RENDERED_INLINE_LINE_HOST_SELECTOR) === block;
}

/**
 * DOM Range boundaries have opposite ownership at a text-node seam: a start
 * belongs to the following node while an end belongs to the preceding node.
 */
export function resolveRenderedTextPosition<T extends { length: number }>(
  ranges: readonly RenderedTextNodeRange<T>[],
  offset: number,
  affinity: 'start' | 'end',
): { node: T; offset: number } | null {
  if (!Number.isFinite(offset) || offset < 0 || ranges.length === 0) return null;

  if (affinity === 'start') {
    for (const range of ranges) {
      if (offset >= range.start && offset < range.end) {
        return { node: range.node, offset: offset - range.start };
      }
    }
    return null;
  }

  for (const range of ranges) {
    if (offset > range.start && offset <= range.end) {
      return { node: range.node, offset: offset - range.start };
    }
  }
  const first = ranges[0];
  return offset === 0 && first ? { node: first.node, offset: 0 } : null;
}
