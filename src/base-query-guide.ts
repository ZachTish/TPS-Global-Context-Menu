export const OBSIDIAN_BASES_SYNTAX_URL = 'https://help.obsidian.md/bases/syntax';
export const OBSIDIAN_BASES_FUNCTIONS_URL = 'https://help.obsidian.md/bases/functions';

export const CURRENT_DAILY_NOTE_FEED_QUERY = `filters:
  and:
    - file.path == this.file.path
    - task.path == this.file.path
views:
  - type: tps-list
    name: Daily note
    createAction: default
    filters:
      or:
        - kind == "task"
        - kind == "bullet"
        - kind == "header"`;

export type BaseQueryGuideEntry = {
  expression: string;
  appliesTo: string;
  description: string;
};

export type BaseQueryGuideSection = {
  title: string;
  description: string;
  defaultOpen?: boolean;
  entries: BaseQueryGuideEntry[];
};

export const BASE_QUERY_GUIDE_SECTIONS: BaseQueryGuideSection[] = [
  {
    title: 'GCM custom view contracts',
    description: 'Start here: these are GCM-defined view types and row selectors, not native Obsidian note properties.',
    defaultOpen: true,
    entries: [
      {
        expression: 'type: tps-list',
        appliesTo: 'Custom view configuration',
        description: 'GCM TPS List. It combines native whole-note rows with synthesized checkbox-task, plain-bullet, and Markdown-heading rows.',
      },
      {
        expression: 'kind == "note"',
        appliesTo: 'TPS List row selector',
        description: 'One native row per matching Markdown note. Query its frontmatter with note.<property> and its file metadata with file.*.',
      },
      {
        expression: 'kind == "task"',
        appliesTo: 'TPS List row selector',
        description: 'A Markdown checkbox line such as - [ ] text. It exposes task status, tags, inline fields, source path, line number, and title.',
      },
      {
        expression: 'kind == "bullet"',
        appliesTo: 'TPS List row selector',
        description: 'A plain Markdown bullet such as - text. It exposes tags, inline fields, source path, line number, and title but no checkbox status.',
      },
      {
        expression: 'kind == "header" / kind == "heading"',
        appliesTo: 'TPS List row selector',
        description: 'All Markdown ATX headings (# through ######). header and heading are equivalent generic aliases.',
      },
      {
        expression: 'kind == "h1" … kind == "h6"',
        appliesTo: 'TPS List row selector',
        description: 'Only the requested Markdown heading level. For example, kind == "h3" selects lines beginning with ###.',
      },
      {
        expression: 'type: tps-table',
        appliesTo: 'Custom view configuration',
        description: 'GCM TPS Table. Each row is a Markdown line record selected by inline-field keys or a task/bullet kind filter; it is not a whole-note table.',
      },
      {
        expression: 'lineFilterKey / lineProperty / lineFilterKeys',
        appliesTo: 'TPS Table view options',
        description: 'Select lines that contain every configured [key:: value] field. The singular aliases select one required field.',
      },
      {
        expression: 'lineFilterAnyKeys',
        appliesTo: 'TPS Table view option',
        description: 'Select a line when it contains at least one configured inline-field key, as used by Activity Log for activity or workout rows.',
      },
      {
        expression: 'order / sort / groupBy / totalsRow',
        appliesTo: 'TPS List + TPS Table options',
        description: 'Choose displayed fields, ordering, grouping, and (TPS Table) numeric totals. These configure the view; they are not filter variables.',
      },
      {
        expression: 'createAction / createCommandId',
        appliesTo: 'TPS List + TPS Table options',
        description: 'Keep filter-derived creation with default, or route + New to an explicit Obsidian command with command.',
      },
    ],
  },
  {
    title: 'Context and dynamic variables',
    description: 'Values supplied by the Base location, Home, a formula, or a list/summary expression.',
    defaultOpen: true,
    entries: [
      {
        expression: 'this',
        appliesTo: 'Native Bases',
        description: 'The Base context: the Base file when opened directly, the embedding note when embedded, or the active file in a sidebar.',
      },
      {
        expression: 'this.file.path',
        appliesTo: 'Native Bases + TPS List',
        description: 'The current context file path. In TPS Home this is replaced with the selected Daily Note path before the Base renders.',
      },
      {
        expression: 'this.file.name',
        appliesTo: 'Native Bases + TPS List',
        description: 'The current context filename, including its extension.',
      },
      {
        expression: 'this.file.basename',
        appliesTo: 'TPS List',
        description: 'GCM alias for the current context filename without its extension.',
      },
      {
        expression: 'this.<property>',
        appliesTo: 'Native Bases + TPS List',
        description: 'Any frontmatter property on the context note, for example this.scheduled or this.project.',
      },
      {
        expression: 'values',
        appliesTo: 'Native summary formulas',
        description: 'The list of values for the summarized property across the current result set.',
      },
      {
        expression: 'value, index',
        appliesTo: 'Native list functions',
        description: 'The current list item and zero-based position inside filter(), map(), and reduce().',
      },
      {
        expression: 'acc',
        appliesTo: 'Native list reduce()',
        description: 'The accumulated value passed between reduce() iterations.',
      },
    ],
  },
  {
    title: 'Note and formula properties',
    description: 'Every frontmatter key and every formula name is queryable; these namespaces are open-ended rather than a fixed list.',
    entries: [
      {
        expression: '<property> or note.<property>',
        appliesTo: 'Native Bases + TPS note rows',
        description: 'Any Markdown frontmatter property. status and note.status refer to the same note property.',
      },
      {
        expression: 'note["property with spaces"]',
        appliesTo: 'Native Bases',
        description: 'Bracket form for a frontmatter property whose name cannot be written with dot notation.',
      },
      {
        expression: 'formula.<name>',
        appliesTo: 'Native Bases',
        description: 'A formula declared in the Base file, for example formula.days_open.',
      },
    ],
  },
  {
    title: 'Native file properties',
    description: 'The complete file.* property set currently documented by Obsidian Bases.',
    entries: [
      { expression: 'file.backlinks', appliesTo: 'Native Bases', description: 'Files that link to this file. Performance-heavy and not automatically refreshed for every vault change.' },
      { expression: 'file.ctime', appliesTo: 'Native Bases', description: 'File creation date and time.' },
      { expression: 'file.embeds', appliesTo: 'Native Bases', description: 'Embedded files referenced by the note.' },
      { expression: 'file.ext', appliesTo: 'Native Bases', description: 'File extension without a leading period, such as md.' },
      { expression: 'file.file', appliesTo: 'Native Bases', description: 'The file object used by file-aware functions.' },
      { expression: 'file.folder', appliesTo: 'Native Bases + TPS rows', description: 'Vault-relative parent folder path.' },
      { expression: 'file.links', appliesTo: 'Native Bases', description: 'Internal links in note content and frontmatter.' },
      { expression: 'file.mtime', appliesTo: 'Native Bases', description: 'File modification date and time.' },
      { expression: 'file.name', appliesTo: 'Native Bases + TPS rows', description: 'Filename, including its extension.' },
      { expression: 'file.path', appliesTo: 'Native Bases + TPS rows', description: 'Full vault-relative file path.' },
      { expression: 'file.properties', appliesTo: 'Native Bases', description: 'Object containing all properties on the file.' },
      { expression: 'file.size', appliesTo: 'Native Bases', description: 'File size in bytes.' },
      { expression: 'file.tags', appliesTo: 'Native Bases', description: 'Tags found in content and frontmatter.' },
    ],
  },
  {
    title: 'TPS List synthesized-line fields',
    description: 'Virtual fields GCM adds while TPS List turns Markdown tasks, bullets, and headings into queryable rows.',
    defaultOpen: true,
    entries: [
      {
        expression: 'kind / itemKind / itemType',
        appliesTo: 'TPS List',
        description: 'Structural row type. Values are note, task, bullet, or the exact heading level h1 through h6. header/heading match every heading; all/mixed match every row family. tps.* and kanban.* aliases also work.',
      },
      {
        expression: 'task.path / task.file.path / line.path / heading.path',
        appliesTo: 'TPS List',
        description: 'Containing-note path for a synthesized line. task.path equality also supplies the explicit + New task/bullet creation target; line.path and heading.path are query-only aliases.',
      },
      {
        expression: 'title / task.title / line.text / heading.text',
        appliesTo: 'TPS List synthesized rows',
        description: 'Visible line text after Markdown decoration, tags, inline fields, and hidden TPS metadata are removed.',
      },
      {
        expression: 'line.number / task.line / heading.line',
        appliesTo: 'TPS List synthesized rows',
        description: 'One-based source line number inside the containing Markdown note.',
      },
      {
        expression: 'heading.level',
        appliesTo: 'TPS List heading rows',
        description: 'Numeric heading depth from 1 through 6. kind == "h3" is the shorter exact-level form.',
      },
      {
        expression: 'status / task.status / checkboxStatus',
        appliesTo: 'TPS List checkbox tasks',
        description: 'Mapped checkbox status such as todo, working, holding, wont-do, or complete. Pair with kind == "task" when bullets are also in scope.',
      },
      {
        expression: 'open / isOpen',
        appliesTo: 'TPS List checkbox tasks',
        description: 'Boolean shortcut for a status that is not configured as done.',
      },
      {
        expression: 'done / isDone / completed / complete',
        appliesTo: 'TPS List checkbox tasks',
        description: 'Boolean shortcut for a status configured as done.',
      },
      {
        expression: 'tags / tag / task.tags',
        appliesTo: 'TPS List task + bullet rows',
        description: 'Task/bullet tags exposed by TPS line parsing. A leading # is optional when comparing values.',
      },
      {
        expression: 'task.file.ext / task.file.extension',
        appliesTo: 'TPS List synthesized rows',
        description: 'Extension of the containing source file.',
      },
      {
        expression: 'file.folder',
        appliesTo: 'TPS List synthesized rows',
        description: 'Folder containing the source note. Equality matches one folder; != also excludes descendants in TPS List.',
      },
      {
        expression: 'task.<inline-key> or <inline-key>',
        appliesTo: 'TPS List synthesized rows',
        description: 'Any line field written as [key:: value] or (key:: value), such as scheduled, priority, due, recurrence, or project.',
      },
    ],
  },
  {
    title: 'TPS Table line fields',
    description: 'Variables available when TPS Table parses inline records from Markdown lines.',
    entries: [
      {
        expression: '<field> / line.<field> / log.<field>',
        appliesTo: 'TPS Table',
        description: 'Any parsed field on the current line. Prefixes are optional, so amount and line.amount are equivalent.',
      },
      { expression: 'file.path', appliesTo: 'TPS Table', description: 'Path of the Markdown file containing the line.' },
      { expression: 'file.name / file.basename', appliesTo: 'TPS Table', description: 'Containing filename with or without the extension.' },
      { expression: 'file.folder', appliesTo: 'TPS Table', description: 'Folder containing the source Markdown file.' },
      { expression: 'file.ext / file.extension', appliesTo: 'TPS Table', description: 'Extension of the source file.' },
      { expression: 'file.tags', appliesTo: 'TPS Table', description: 'Tags collected for the source file.' },
      { expression: 'file.<frontmatter-key>', appliesTo: 'TPS Table', description: 'Any frontmatter property on the source file.' },
      { expression: 'this.scheduled / this.date', appliesTo: 'TPS Table in Home', description: 'The selected Home date supplied as query context.' },
    ],
  },
  {
    title: 'Operators and useful functions',
    description: 'Common query forms. Native note rows support the full Obsidian function reference linked below; synthesized rows support the forms listed here.',
    entries: [
      { expression: '==, !=, >, >=, <, <=', appliesTo: 'Native Bases + TPS Table', description: 'Equality and ordered comparisons. TPS List task fields support == and !=.' },
      { expression: 'and / or / not', appliesTo: 'Filter trees', description: 'Nested YAML filter groups. Whole-Base filters and the active view filters are combined with an outer AND.' },
      { expression: '.contains(), .containsAny(), .equals()', appliesTo: 'Native Bases + TPS rows', description: 'String/list matching supported by the GCM row evaluators.' },
      { expression: '.startsWith(), .endsWith()', appliesTo: 'Native Bases + TPS Table', description: 'Prefix and suffix matching. TPS List additionally supports startsWith() for task paths.' },
      { expression: '.isEmpty() / .empty()', appliesTo: 'Native Bases + TPS rows', description: 'True when the value is missing or empty.' },
      { expression: '.isNotEmpty() / .exists()', appliesTo: 'Native Bases + TPS rows', description: 'True when at least one value is present.' },
      { expression: 'today() / now() / date()', appliesTo: 'Native Bases', description: 'Construct current or explicit dates. TPS Table also resolves today() and date(); TPS List task rows should compare stored values to this.<property> instead.' },
      { expression: 'duration(), if(), list(), link()', appliesTo: 'Native Bases', description: 'Common native helpers for durations, conditional values, normalized lists, and links.' },
      { expression: 'escapeHTML(), file(), html(), image(), icon()', appliesTo: 'Native Bases', description: 'Native helpers for safe HTML, file objects, rendered HTML, images, and icons.' },
      { expression: 'max(), min(), number(), random()', appliesTo: 'Native Bases', description: 'Native numeric and random-value helpers.' },
    ],
  },
];

export const BASE_QUERY_GUIDE_GOTCHAS = [
  'In TPS Home, this.file.path is the selected Daily Note—not Daily Note Feed.base and not whichever Markdown tab happened to be active.',
  'TPS List kind is a GCM structural selector: task, bullet, note, h1 through h6, plus header/heading as aliases for every Markdown heading level. Use note.kind when you mean frontmatter named kind.',
  'TPS List exposes whole-note, checkbox-task, plain-bullet, and Markdown-heading rows. Ordinary paragraphs are not standalone rows.',
  'Heading filters are display-only. They never make + New create a heading; keep task or bullet first in the active-view or/any branch to choose the creation route.',
  'Keep both Daily Note path filters for a deterministic feed: file.path scopes displayed note data, while task.path scopes synthesized rows and gives + New an explicit task/bullet write target. Without an exact target, Workflows → Tasks can supply today’s Daily Note or one configured note as a fallback.',
  'Paths are vault-relative. Use the .md extension for explicit task.path creation targets.',
];
