export type BaseEmbedRenderContext = {
  path: string;
  definition: string;
  sourcePath?: string;
};

const renderContextStack: BaseEmbedRenderContext[] = [];
const pendingRenderContexts: Array<{ context: BaseEmbedRenderContext; createdAt: number }> = [];

export function resolveBaseEmbedSourcePath(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const path = String(candidate || '').trim().replace(/^\/+/, '');
    if (path.toLowerCase().endsWith('.md')) return path;
  }
  return null;
}

export async function withBaseEmbedRenderContext<T>(context: BaseEmbedRenderContext, render: () => Promise<T>): Promise<T> {
  prunePendingContexts();
  pendingRenderContexts.push({ context, createdAt: Date.now() });
  renderContextStack.push(context);
  try {
    return await render();
  } finally {
    const index = renderContextStack.lastIndexOf(context);
    if (index >= 0) renderContextStack.splice(index, 1);
  }
}

export function getCurrentBaseEmbedRenderContext(): BaseEmbedRenderContext | null {
  return renderContextStack[renderContextStack.length - 1] || null;
}

export function takePendingBaseEmbedRenderContext(viewType: string): BaseEmbedRenderContext | null {
  prunePendingContexts();
  for (let index = pendingRenderContexts.length - 1; index >= 0; index -= 1) {
    const candidate = pendingRenderContexts[index];
    if (!definitionHasViewType(candidate.context.definition, viewType)) continue;
    pendingRenderContexts.splice(index, 1);
    return candidate.context;
  }
  return null;
}

function definitionHasViewType(serialized: string, viewType: string): boolean {
  try {
    const parsed = JSON.parse(serialized) as { views?: Array<{ type?: unknown }> };
    return Array.isArray(parsed.views) && parsed.views.some((view) => String(view?.type || '') === viewType);
  } catch {
    return false;
  }
}

function prunePendingContexts(): void {
  const cutoff = Date.now() - 10_000;
  for (let index = pendingRenderContexts.length - 1; index >= 0; index -= 1) {
    if (pendingRenderContexts[index].createdAt < cutoff) pendingRenderContexts.splice(index, 1);
  }
}
