import { TextComponent } from "obsidian";
import TPSGlobalContextMenuPlugin from "../main";
import {
  RuleCondition,
  RuleConditionSource,
  RuleMatchMode,
  RuleOperator,
  SmartRuleOperator,
  SortValueMapping
} from "../types";

export const CONDITION_SOURCE_OPTIONS: Array<{ value: RuleConditionSource; label: string }> = [
  { value: "frontmatter", label: "Property" },
  { value: "path", label: "Folder path" },
  { value: "extension", label: "File extension" },
  { value: "name", label: "File name" },
  { value: "tag", label: "Tag" },
  { value: "body", label: "Body text" },
  { value: "date-created", label: "Created date" },
  { value: "date-modified", label: "Modified date" },
  { value: "parent-frontmatter", label: "Parent property" },
  { value: "parent-tag", label: "Parent tag" },
  { value: "parent-name", label: "Parent name" },
  { value: "parent-path", label: "Parent folder path" }
];

export const SORT_SOURCE_OPTIONS: Array<{ value: RuleConditionSource; label: string }> = [
  { value: "frontmatter", label: "Property" },
  { value: "parent-frontmatter", label: "Parent property" },
  { value: "name", label: "File name" },
  { value: "parent-name", label: "Parent name" },
  { value: "path", label: "Folder path" },
  { value: "parent-path", label: "Parent folder path" },
  { value: "tag", label: "Tag" },
  { value: "parent-tag", label: "Parent tag" },
  { value: "extension", label: "File extension" },
  { value: "date-created", label: "Created date" },
  { value: "date-modified", label: "Modified date" }
];

export const OPERATOR_LABELS: Record<SmartRuleOperator, string> = {
  is: "is",
  "!is": "is not",
  contains: "contains",
  "!contains": "does not contain",
  exists: "exists",
  "!exists": "does not exist",
  "is-not-empty": "is not empty",
  starts: "starts with",
  "!starts": "does not start with",
  "within-next-days": "within next days",
  "!within-next-days": "not within next days",
  "has-open-checkboxes": "has open checkboxes",
  "!has-open-checkboxes": "has no open checkboxes",
  "is-today": "is today",
  "!is-today": "is not today",
  "is-before-today": "is before today",
  "!is-before-today": "is not before today",
  "is-after-today": "is after today",
  "!is-after-today": "is not after today"
};

export const ICON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "(none)" },
  { value: "templater-icon", label: "templater-icon (template)" },
  { value: "lucide:check-square-2", label: "lucide:check-square-2 (complete)" },
  { value: "lucide:clipboard-list", label: "lucide:clipboard-list (working)" },
  { value: "lucide:clipboard-check", label: "lucide:clipboard-check (done)" },
  { value: "lucide:clipboard-x", label: "lucide:clipboard-x (blocked)" },
  { value: "lucide:triangle-alert", label: "lucide:triangle-alert (warning)" },
  { value: "lucide:archive", label: "lucide:archive (archive)" },
  { value: "lucide:calendar", label: "lucide:calendar (date)" },
  { value: "lucide:file-text", label: "lucide:file-text (note)" }
];

export type BindCommittedText = (
  text: TextComponent,
  initialValue: string,
  commit: (value: string) => Promise<void>,
  refreshOnCommit?: boolean,
  applyToActiveFileOnCommit?: boolean
) => void;

export interface SettingsSectionContext {
  plugin: TPSGlobalContextMenuPlugin;
  bindCommittedText: BindCommittedText;
  refresh: () => void;
  persistRuleChange: (applyActive?: boolean) => Promise<void>;
}

export function normalizeOperator(value: string): RuleOperator {
  if (
    value === "is" ||
    value === "!is" ||
    value === "contains" ||
    value === "!contains" ||
    value === "exists" ||
    value === "!exists"
  ) {
    return value;
  }
  return "is";
}

export function normalizeSmartOperator(value: string): SmartRuleOperator {
  if (
    value === "is" ||
    value === "contains" ||
    value === "exists" ||
    value === "!is" ||
    value === "!contains" ||
    value === "!exists" ||
    value === "is-not-empty" ||
    value === "starts" ||
    value === "!starts" ||
    value === "within-next-days" ||
    value === "!within-next-days" ||
    value === "has-open-checkboxes" ||
    value === "!has-open-checkboxes" ||
    value === "is-today" ||
    value === "!is-today" ||
    value === "is-before-today" ||
    value === "!is-before-today" ||
    value === "is-after-today" ||
    value === "!is-after-today"
  ) {
    return value;
  }

  return "is";
}

export function normalizeConditionSource(value: string): RuleConditionSource {
  if (
    value === "frontmatter" ||
    value === "path" ||
    value === "extension" ||
    value === "name" ||
    value === "tag" ||
    value === "body" ||
    value === "date-created" ||
    value === "date-modified" ||
    value === "parent-frontmatter" ||
    value === "parent-tag" ||
    value === "parent-name" ||
    value === "parent-path"
  ) {
    return value;
  }
  return "frontmatter";
}

export function normalizeRuleMatchMode(value: unknown): RuleMatchMode {
  return value === "any" ? "any" : "all";
}

export function getSourceLabel(source: RuleConditionSource): string {
  return CONDITION_SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source;
}

export function getOperatorLabel(operator: string): string {
  return OPERATOR_LABELS[operator as SmartRuleOperator] ?? operator;
}

export function createDefaultCondition(source: RuleConditionSource = "frontmatter"): RuleCondition {
  return {
    source,
    field: source === "frontmatter" ? "status" : "",
    operator: "is",
    value: ""
  };
}

export function smartToSimpleOperator(operator: SmartRuleOperator): RuleOperator {
  if (operator === "contains" || operator === "!contains") {
    return operator;
  }
  if (operator === "exists" || operator === "!exists") {
    return operator;
  }
  if (operator === "!is") {
    return "!is";
  }
  return "is";
}

export function getConditionValuePlaceholder(condition: RuleCondition): string {
  if (condition.operator === "within-next-days" || condition.operator === "!within-next-days") {
    return "7";
  }

  if (condition.source === "path") {
    return "01 Action Items";
  }

  if (condition.source === "extension") {
    return "md";
  }

  if (condition.source === "name") {
    return "Daily Standup";
  }

  if (condition.source === "tag") {
    return "hide";
  }
  if (condition.source === "parent-tag") {
    return "hide";
  }
  if (condition.source === "parent-name") {
    return "Parent Note";
  }
  if (condition.source === "parent-path") {
    return "01 Action Items";
  }
  if (condition.source === "parent-frontmatter") {
    return "working";
  }

  const field = String(condition.field || "").trim().toLowerCase();
  if (field === "priority") {
    return "normal";
  }
  if (field === "status") {
    return "working";
  }
  if (field === "scheduled" || field === "due") {
    return "2026-02-12 14:45:00";
  }
  if (field === "folderpath") {
    return "01 Action Items";
  }

  return "value";
}

export function parseMappings(raw: string): SortValueMapping[] {
  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .flatMap((pair) => {
      const separator = pair.includes("=") ? "=" : pair.includes(":") ? ":" : "";
      if (!separator) {
        return [];
      }
      const [input, output] = pair.split(separator);
      const normalizedInput = String(input || "").trim();
      const normalizedOutput = String(output || "").trim();
      if (!normalizedInput || !normalizedOutput) {
        return [];
      }
      return [{ input: normalizedInput, output: normalizedOutput }];
    });
}

export function stringifyMappings(mappings: SortValueMapping[]): string {
  return mappings
    .map((mapping) => `${mapping.input}=${mapping.output}`)
    .join(", ");
}

export function normalizeIconIdForPreview(rawIcon: string): string {
  const icon = String(rawIcon || "").trim();
  if (!icon) {
    return "";
  }
  if (icon.startsWith("lucide:")) {
    return icon.slice("lucide:".length).trim();
  }
  if (icon.startsWith("lucide-")) {
    return icon.slice("lucide-".length).trim();
  }
  return icon;
}

export function isValidCssColor(value: string): boolean {
  const color = String(value || "").trim();
  if (!color) {
    return false;
  }

  try {
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
      return CSS.supports("color", color);
    }
  } catch {
    // fall through
  }

  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color);
}
