import {
  ViewModeConditionOperator,
  ViewModeConditionType,
  ViewModeRule,
  ViewModeRuleCondition,
  ViewModeRuleMatch,
} from "../types";

/** Shared condition evaluation for custom-property and ignore rules. */
export class ViewModeService {
  shouldIgnorePath(path: string, ignoredFoldersRaw: string | undefined): boolean {
    if (!ignoredFoldersRaw) return false;
    const ignored = ignoredFoldersRaw
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    return ignored.some((prefix) => path.startsWith(prefix));
  }

  public evaluateConditions(matchType: ViewModeRuleMatch | undefined, conditions: ViewModeRuleCondition[] | undefined, data: Record<string, unknown>): boolean {
    if (!conditions || conditions.length === 0) return false;
    const match = this.normalizeMatch(matchType);
    const results = conditions.map((condition) => this.conditionMatches(condition, data));
    return match === "any" ? results.some(Boolean) : results.every(Boolean);
  }

  public getRuleConditions(rule: ViewModeRule | null | undefined): ViewModeRuleCondition[] {
    if (!rule) return [];
    if (Array.isArray(rule.conditions) && rule.conditions.length) {
      return rule.conditions.filter((condition) => !!condition && typeof condition === "object");
    }

    // Backward compatibility for legacy key/value rules
    const legacyKey = String(rule.key ?? "").trim();
    const legacyValue = String(rule.value ?? "").trim();
    if (!legacyKey || !legacyValue) return [];

    return [{
      type: "frontmatter",
      key: legacyKey,
      operator: "equals",
      value: legacyValue,
    }];
  }

  public normalizeMatch(match: unknown): ViewModeRuleMatch {
    return String(match ?? "").trim().toLowerCase() === "any" ? "any" : "all";
  }

  public conditionMatches(condition: ViewModeRuleCondition, data: Record<string, unknown>): boolean {
    const type = this.normalizeConditionType(condition.type);

    if (type === "path") {
      const fullPath = String(data.path ?? data.filePath ?? "");
      const operator = this.normalizeOperator(condition.operator, type);

      // Always check against the full path first
      if (this.matchStringCondition(fullPath, operator, condition.value)) {
        return true;
      }

      // Also check each parent-stripped subpath so patterns can target nested
      // folders by name, e.g. "_*" matches "Projects/_archive/file.md".
      if (operator === "starts-with" || operator === "equals" || this.hasWildcard(condition.value)) {
        const parts = fullPath.split("/");
        for (let i = 1; i < parts.length; i++) {
          const subPath = parts.slice(i).join("/");
          if (this.matchStringCondition(subPath, operator, condition.value)) {
            return true;
          }
        }
      }

      return false;
    }

    if (type === "frontmatter") {
      const key = String(condition.key ?? "").trim();
      if (!key) return false;
      const val = this.getValueCaseInsensitive(data, key);
      const operator = this.normalizeOperator(condition.operator, type);

      // is-empty: key exists but value is empty/null/undefined/empty-array
      if (operator === "is-empty") {
        if (val === undefined || val === null) return true;
        if (typeof val === "string") return val.trim().length === 0;
        if (Array.isArray(val)) return val.length === 0;
        return false;
      }

      return this.matchStringCondition(val, operator, condition.value);
    }

    if (type === "scheduled") {
      const key = String(condition.key ?? "scheduled").trim() || "scheduled";
      const rawValue = data[key] ?? data.scheduled;
      return this.matchDateRelation(rawValue, this.normalizeOperator(condition.operator, type));
    }
    const dailyRelation = this.normalizeDateRelation(data.dailyNoteRelation);
    return this.matchNormalizedRelation(dailyRelation, this.normalizeOperator(condition.operator, type));
  }

  private getValueCaseInsensitive(data: Record<string, any>, key: string): any {
    if (!data || !key) return undefined;
    if (key in data) return data[key];
    const lowerKey = key.toLowerCase();
    for (const k of Object.keys(data)) {
      if (k.toLowerCase() === lowerKey) return data[k];
    }
    return undefined;
  }

  private normalizeConditionType(type: unknown): ViewModeConditionType {
    const normalized = String(type ?? "").trim().toLowerCase();
    if (normalized === "path") return "path";
    if (normalized === "scheduled") return "scheduled";
    if (normalized === "daily-note") return "daily-note";
    return "frontmatter";
  }

  private normalizeOperator(operator: unknown, type: ViewModeConditionType): ViewModeConditionOperator {
    const normalized = String(operator ?? "").trim().toLowerCase() as ViewModeConditionOperator;
    const pathOps: ViewModeConditionOperator[] = ["contains", "equals", "starts-with", "ends-with", "not-contains", "exists", "missing"];
    const frontmatterOps: ViewModeConditionOperator[] = ["equals", "contains", "not-equals", "not-contains", "exists", "missing", "is-empty"];
    const dateOps: ViewModeConditionOperator[] = ["past", "future", "today", "not-today", "exists", "missing"];

    if (type === "path") {
      if (pathOps.includes(normalized)) return normalized;
      return "contains";
    }
    if (type === "frontmatter") {
      if (frontmatterOps.includes(normalized)) return normalized;
      return "equals";
    }
    if (dateOps.includes(normalized)) return normalized;
    return "past";
  }

  private matchStringCondition(rawValue: unknown, operator: ViewModeConditionOperator, rawNeedle?: string): boolean {
    const leftRaw = String(rawValue ?? "").trim();
    const rightRaw = String(rawNeedle ?? "").trim();
    const left = leftRaw.toLowerCase();
    const right = rightRaw.toLowerCase();

    if (operator === "exists") return !!leftRaw;
    if (operator === "missing") return !leftRaw;
    if (operator === "is-empty") return !leftRaw;
    if (!leftRaw || !rightRaw) return false;
    if (this.hasWildcard(rightRaw)) {
      const wildcardMatch = this.matchesWildcard(right, left);
      if (operator === "not-contains" || operator === "not-equals") return !wildcardMatch;
      return wildcardMatch;
    }
    if (operator === "equals") return left === right;
    if (operator === "not-equals") return left !== right;
    if (operator === "starts-with") return left.startsWith(right);
    if (operator === "ends-with") return left.endsWith(right);
    if (operator === "not-contains") return !left.includes(right);
    return left.includes(right);
  }

  private hasWildcard(value: unknown): boolean {
    return String(value ?? "").includes("*");
  }

  private matchesWildcard(pattern: string, value: string): boolean {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i").test(value);
  }

  private matchDateRelation(rawValue: unknown, operator: ViewModeConditionOperator): boolean {
    const parsed = this.parseDate(rawValue);
    if (!parsed) {
      return operator === "missing";
    }
    if (operator === "exists") return true;

    const rawText = String(rawValue ?? "").trim();
    const hasTimeComponent = /[T\s]\d{1,2}:\d{2}/.test(rawText);
    const now = new Date();
    const parsedDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    if (operator === "today") return parsedDay === nowDay;
    if (operator === "not-today") return parsedDay !== nowDay;
    if (operator === "past") {
      if (hasTimeComponent) return parsed.getTime() < now.getTime();
      return parsedDay < nowDay;
    }
    if (operator === "future") {
      if (hasTimeComponent) return parsed.getTime() > now.getTime();
      return parsedDay > nowDay;
    }
    return false;
  }

  private matchNormalizedRelation(
    relation: "past" | "today" | "future" | "none",
    operator: ViewModeConditionOperator,
  ): boolean {
    if (operator === "exists") return relation !== "none";
    if (operator === "missing") return relation === "none";
    if (operator === "past") return relation === "past";
    if (operator === "future") return relation === "future";
    if (operator === "today") return relation === "today";
    if (operator === "not-today") return relation === "past" || relation === "future";
    return false;
  }

  private normalizeDateRelation(value: unknown): "past" | "today" | "future" | "none" {
    const relation = String(value ?? "").trim().toLowerCase();
    if (relation === "past" || relation === "today" || relation === "future") return relation;
    return "none";
  }

  private parseDate(rawValue: unknown): Date | null {
    const text = String(rawValue ?? "").trim();
    if (!text) return null;

    const momentLib = (window as any)?.moment;
    if (momentLib) {
      const parsed = momentLib(text, [
        momentLib.ISO_8601,
        "YYYY-MM-DD",
        "YYYY-MM-DD HH:mm",
        "YYYY-MM-DD HH:mm:ss",
        "MM/DD/YYYY",
        "MM/DD/YYYY HH:mm",
      ], true);
      if (parsed?.isValid?.()) {
        return parsed.toDate();
      }
      const fallback = momentLib(text);
      if (fallback?.isValid?.()) {
        return fallback.toDate();
      }
    }

    const nativeDate = new Date(text);
    return Number.isNaN(nativeDate.getTime()) ? null : nativeDate;
  }

}
