import { IconColorRule } from "../types";
import { getOperatorLabel, ICON_OPTIONS, normalizeConditionSource, normalizeIconIdForPreview } from "./ui-common";

export function collectRuleFilterTerms(rule: IconColorRule, ruleNumber: number): string[] {
  const terms = [
    `rule ${ruleNumber}`,
    String(rule.name || "").trim(),
    rule.enabled ? "enabled" : "disabled",
    rule.match === "any" ? "any" : "all",
    String(rule.property || "").trim(),
    String(rule.operator || "").trim(),
    String(rule.value || "").trim(),
    String(rule.pathPrefix || "").trim(),
    String(rule.icon || "").trim(),
    normalizeIconIdForPreview(rule.icon),
    String(rule.color || "").trim(),
  ];

  const iconOption = ICON_OPTIONS.find((option) => option.value === rule.icon);
  if (iconOption?.label) {
    terms.push(iconOption.label);
  }

  if (rule.conditions?.length) {
    terms.push("advanced");
    for (const condition of rule.conditions) {
      terms.push(
        String(condition.source || "").trim(),
        String(condition.field || "").trim(),
        String(condition.operator || "").trim(),
        String(condition.value || "").trim(),
        normalizeConditionSource(condition.source),
        getOperatorLabel(condition.operator),
      );
    }
  } else {
    terms.push("simple");
  }

  return terms.filter(Boolean);
}

export function matchesRuleFilter(rule: IconColorRule, ruleNumber: number, rawQuery: string): boolean {
  const query = String(rawQuery || "").trim().toLowerCase();
  if (!query) {
    return true;
  }

  const terms = collectRuleFilterTerms(rule, ruleNumber).map((term) => term.toLowerCase());
  if (terms.includes(query)) {
    return true;
  }

  return terms.some((term) => term.includes(query));
}
