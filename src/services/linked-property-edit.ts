import { Notice, parseYaml, type TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import type { CustomProperty } from '../types';
import { readLinkedChoices, type LinkedChoiceState } from '../utils/linked-property-options';

function editorSource(plugin: TPSGlobalContextMenuPlugin, file: TFile): string | undefined {
  for (const leaf of plugin.app.workspace.getLeavesOfType('markdown')) {
    const view = leaf.view as any;
    if (view.file === file && view.getMode?.() === 'source' && view.editor?.getValue) return view.editor.getValue();
  }
  return undefined;
}
function frontmatter(source: string): Record<string, unknown> {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) throw new Error('The linked note has no usable properties.');
  const fm = parseYaml(match[1]);
  if (!fm || Array.isArray(fm) || typeof fm !== 'object') throw new Error('Check the linked note properties.');
  return fm;
}

/** Explicit user edit only. Source reads belong here, never to rendering or filtering. */
export async function setLinkedPropertyChoice(plugin: TPSGlobalContextMenuPlugin, property: CustomProperty, files: TFile[], value: string, expected: LinkedChoiceState[]): Promise<number> {
  let changed = 0, rejected = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i], snapshot = expected[i];
    const cached = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    if (cached?.[property.key] === value) continue;
    if (!snapshot?.source || !snapshot.choices.some(c => c.value === value)) { rejected++; continue; }
    let guard = () => true;
    let invalid = false;
    changed += await plugin.bulkEditService.applyToFiles([file], async (fm) => {
      const current = readLinkedChoices(plugin.app, property, file, fm);
      if (current.fingerprint !== snapshot.fingerprint) { invalid = true; return; }
      const source = snapshot.source!;
      const path = source.path, mtime = source.stat.mtime, size = source.stat.size;
      const editor = editorSource(plugin, source);
      const raw = editor ?? await plugin.app.vault.read(source);
      const fresh = readLinkedChoices(plugin.app, property, file, fm, frontmatter(raw));
      guard = () => source.path === path && plugin.app.vault.getAbstractFileByPath(path) === source
        && source.stat.mtime === mtime && source.stat.size === size && editorSource(plugin, source) === editor;
      if (!guard() || fresh.fingerprint !== snapshot.fingerprint || !fresh.choices.some(c => c.value === value)) { invalid = true; return; }
      const key = Object.keys(fm).find(k => k.toLowerCase() === property.key.toLowerCase()) || property.key;
      fm[key] = value;
    }, { writeGuard: () => guard() });
    if (invalid) rejected++;
  }
  if (rejected) new Notice('The linked choices changed or are unavailable. Open the selector again. Existing values were preserved.');
  return changed;
}
