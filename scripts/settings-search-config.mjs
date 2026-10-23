export const ROUTES = {
  "custom-fields": "Properties \u2192 Custom fields",
  "records": "Properties \u2192 Records",
  "frontmatter": "Properties \u2192 Note maintenance",
  "menus-surfaces": "Menus & surfaces",
  "daily-notes": "Workflows \u2192 Daily notes",
  "tasks": "Workflows \u2192 Tasks",
  "child-notes": "Workflows \u2192 Child notes",
  "recurrence": "Workflows \u2192 Status values",
  "time-tracking": "Workflows \u2192 Time tracking",
  "appearance": "Appearance",
  "advanced": "Advanced"
};
export const SOURCES = {
  "src/settings-tab.ts": {
    "methods": {
      "renderLinkedContextSettings": "menus-surfaces",
      "renderIntegrationPropertyNames": "advanced",
      "renderNoteMaintenance": "frontmatter",
      "renderDailyNoteRecognition": "records",
      "renderRecordSettings": "records",
      "renderProperties": "custom-fields",
      "renderUndefinedPropertyEditor": "custom-fields",
      "renderCustomPropertyEditor": "custom-fields",
      "renderBaseQueryGuide": "advanced",
      "renderCustomPropertyValueSettings": "custom-fields",
      "renderPropertyOptionSettings": "custom-fields",
      "renderMigratingKeySetting": "advanced"
    },
    "conditions": {
      "activeSettingsPage:menus-surfaces": "menus-surfaces",
      "activeSettingsPage:appearance": "appearance",
      "activeSettingsPage:advanced": "advanced",
      "activeRulesFieldsPage:custom-fields": "custom-fields",
      "activeRulesFieldsPage:records": "records",
      "activeRulesFieldsPage:frontmatter": "frontmatter",
      "activeWorkflowPage:daily-notes": "daily-notes",
      "activeWorkflowPage:tasks": "tasks",
      "activeWorkflowPage:child-notes": "child-notes",
      "activeWorkflowPage:recurrence": "recurrence",
      "activeWorkflowPage:time-tracking": "time-tracking"
    },
    "helpers": {
      "renderMigratingKeySetting": {
        "name": 1,
        "desc": 2
      }
    },
    "maps": {
      "labels": "advanced"
    }
  },
  "src/integrations/notebook-navigator-property-visibility.ts": {
    "route": "custom-fields"
  }
};
export const EXTRA_ENTRIES = [];
