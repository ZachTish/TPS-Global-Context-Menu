/**
 * CSS styles for the plugin
 */
export const PLUGIN_STYLES = `
      :root {
        --tps-gcm-text-scale: 1;
        --tps-gcm-button-scale: 1;
        --tps-gcm-control-scale: 1;
        --tps-gcm-density: 1;
        --tps-gcm-radius-scale: 1;
        --tps-gcm-live-left: 50%;
        --tps-gcm-live-right: auto;
        --tps-gcm-live-transform: translate(-50%, 0px);
        --tps-gcm-modal-width: 520px;
        --tps-gcm-modal-max-height: 80vh;
        --tps-gcm-subitems-margin-bottom: 0px;
        --tps-gcm-daily-nav-scale: 1;
        --tps-gcm-daily-nav-rest-opacity: 0;
        --tps-gcm-mobile-toolbar-offset: 0px;
        --tps-gcm-base-hover-height: min(340px, 42vh);
        --tps-visible-viewport-left: 0px;
        --tps-visible-viewport-top: 0px;
        --tps-visible-viewport-width: 100vw;
        --tps-visible-viewport-height: 100dvh;
        --tps-visible-keyboard-inset: 0px;
      }

      .tps-keyboard-aware-overlay {
        left: var(--tps-overlay-left, 12px) !important;
        top: var(--tps-overlay-top, 12px) !important;
        width: var(--tps-overlay-width, min(480px, calc(100vw - 24px))) !important;
        max-height: var(--tps-overlay-max-height, calc(100dvh - 24px)) !important;
      }

      .tps-gcm-virtual-base-embed .internal-embed:is([src$=".base"], [data-src$=".base"], [alt$=".base"]) {
        display: block;
        position: relative;
        box-sizing: border-box;
        min-height: 0;
        height: auto;
        max-height: none;
        overflow: visible;
        margin-block: 0;
        background: transparent;
      }

      .tps-list-container {
        padding: 0 0 12px;
      }

      .tps-list-container .tps-kanban-view-controls {
        display: none;
      }

      .tps-list-native {
        box-sizing: border-box;
        width: 100%;
        padding: 8px 16px 24px;
        color: var(--text-normal);
        font-size: var(--font-ui-small);
        line-height: var(--line-height-normal, 1.5);
      }

      .tps-list-native-group {
        margin: 0 0 12px;
      }

      .tps-list-native-group-label {
        margin: 0 0 5px;
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        font-weight: 650;
      }

      .tps-list-native-rows {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .tps-list-native-row {
        content-visibility: auto;
        contain-intrinsic-block-size: 24px;
        display: grid;
        grid-template-columns: 14px minmax(0, 1fr);
        column-gap: 6px;
        align-items: center;
        min-height: 0;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--text-normal);
        font: inherit;
      }

      .tps-list-native-row--task {
        padding-inline-start: var(--tps-list-task-indent, 0px);
      }

      .tps-list-native-row--heading {
        margin: 7px 0 2px;
      }

      .tps-list-native-leading {
        width: 14px;
        height: 14px;
        min-width: 14px;
        margin: 0;
        align-self: center;
      }

      .tps-list-native-row-body {
        min-width: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        column-gap: 8px;
        row-gap: 2px;
      }

      .tps-list-native-heading-marker {
        color: var(--text-faint);
        font-size: 0.68em;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }

      .tps-list-native-heading-title {
        font-weight: 650 !important;
      }

      .tps-list-native-row--heading[data-tps-heading-level="1"] .tps-list-native-heading-title,
      .tps-list-native-row--heading[data-tps-heading-level="2"] .tps-list-native-heading-title {
        font-size: 1.08em !important;
        font-weight: 700 !important;
      }

      .tps-list-native-row:hover {
        background: transparent;
      }

      .tps-list-native-row--selected {
        background: color-mix(in srgb, var(--interactive-accent) 10%, transparent);
        outline: 1px solid color-mix(in srgb, var(--interactive-accent) 56%, transparent);
        outline-offset: 1px;
        border-radius: 4px;
      }

      .tps-list-native-checkbox {
        display: block;
      }

      .tps-list-native-bullet-marker,
      .tps-list-native-file-marker,
      .tps-list-native-heading-marker {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .tps-list-native-bullet-marker,
      .tps-list-native-file-marker {
        color: var(--text-muted);
      }

      .tps-list-native-bullet-marker svg,
      .tps-list-native-file-marker svg {
        width: 12px;
        height: 12px;
        stroke-width: 2;
      }

      .tps-list-native-title {
        color: inherit;
        font: inherit;
        font-weight: inherit;
        text-decoration: none;
        cursor: pointer;
      }

      .tps-list-native-row--note .tps-list-native-title {
        color: var(--link-color);
        text-decoration: var(--link-decoration);
      }

      .tps-list-native-row--note .tps-list-native-title:hover,
      .tps-list-native-row--note .tps-list-native-title:focus-visible {
        color: var(--link-color-hover);
        text-decoration: var(--link-decoration-hover);
      }

      .tps-list-native-title-button {
        appearance: none !important;
        -webkit-appearance: none !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        padding: 0;
        margin: 0;
        height: auto;
        min-height: 0;
        color: inherit !important;
        font: inherit !important;
        font-weight: inherit !important;
        line-height: inherit;
        text-align: left;
        text-decoration: none !important;
        box-shadow: none !important;
        cursor: pointer;
      }

      .tps-list-native-title-button:hover,
      .tps-list-native-title-button:focus-visible,
      .tps-list-native-title:hover {
        color: inherit;
        background: transparent !important;
        text-decoration: none !important;
      }

      .tps-list-native-property {
        display: inline;
        margin-left: 0;
        align-self: center;
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        font-weight: 500;
        white-space: nowrap;
      }

      .tps-list-native-property--editable {
        cursor: text;
        border-radius: 4px;
      }

      .tps-list-native-property--checkbox {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
      }

      .tps-list-native-property-checkbox {
        width: 1em;
        height: 1em;
        margin: 0;
      }

      .tps-list-native-property--readonly {
        cursor: default;
      }

      .tps-list-native-property--readonly .tps-list-native-property-checkbox:disabled {
        opacity: 1;
        pointer-events: none;
      }

      .tps-list-native-property--editable:hover,
      .tps-list-native-property--editable:focus-visible,
      .tps-list-native-property--editing {
        background: var(--background-modifier-hover);
        color: var(--text-normal);
      }

      .tps-list-native-property-input {
        width: min(220px, 35vw);
        min-width: 72px;
        height: 1.6em;
        margin: -2px 0;
        padding: 0 4px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        background: var(--background-primary);
        color: var(--text-normal);
        font: inherit;
        font-size: inherit;
      }

      .tps-list-native-empty {
        padding: 24px 16px;
        color: var(--text-muted);
        font-size: var(--font-ui-small);
      }

      .tps-log-base {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        color: var(--text-normal);
      }

      .tps-log-base-table-scroll {
        flex: 1 1 auto;
        width: 100%;
        min-width: 0;
        min-height: 0;
        overflow-x: auto;
        overflow-y: auto;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        overscroll-behavior-x: contain;
        overscroll-behavior-y: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-gutter: stable;
        scrollbar-width: thin;
        touch-action: pan-x pan-y;
      }

      .tps-log-base-table {
        display: table;
        width: var(--tps-log-base-table-width) !important;
        min-width: 100% !important;
        max-width: none !important;
        table-layout: fixed;
        border-collapse: separate;
        border-spacing: 0;
        border: 0;
        border-radius: 0;
        overflow: visible;
        transform-origin: top left;
        flex: 0 0 auto !important;
        height: auto !important;
        max-height: none !important;
      }

      .markdown-preview-view .tps-log-base,
      .markdown-reading-view .tps-log-base,
      .markdown-embed .tps-log-base,
      .internal-embed .tps-log-base,
      .canvas-node-content .tps-log-base {
        min-width: 0 !important;
        max-width: 100% !important;
      }

      .markdown-preview-view .tps-log-base-table-scroll,
      .markdown-reading-view .tps-log-base-table-scroll,
      .markdown-embed .tps-log-base-table-scroll,
      .internal-embed .tps-log-base-table-scroll,
      .canvas-node-content .tps-log-base-table-scroll {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        overflow-x: auto !important;
        overflow-y: auto !important;
        overscroll-behavior-x: contain !important;
        overscroll-behavior-y: auto !important;
        touch-action: pan-x pan-y !important;
      }

      .tps-log-base-head {
        display: table-header-group;
      }

      .tps-log-base-body {
        display: table-row-group;
      }

      .tps-log-base-row {
        display: table-row;
      }

      .tps-log-base-row:not(.tps-log-base-row--header):not(.tps-log-base-row--totals) {
        cursor: pointer;
      }

      .tps-log-base-row--active .tps-log-base-cell,
      .tps-log-base-row:not(.tps-log-base-row--header):not(.tps-log-base-row--totals):hover .tps-log-base-cell {
        background: var(--background-modifier-hover);
      }

      .tps-log-base-row--selected .tps-log-base-cell {
        background: color-mix(in srgb, var(--interactive-accent) 10%, transparent);
      }

      .tps-log-base-row--selected .tps-log-base-cell:first-child {
        box-shadow: inset 3px 0 0 var(--interactive-accent);
      }

      .tps-log-base-cell {
        display: table-cell;
        box-sizing: border-box;
        padding: 6px 8px;
        border-bottom: 1px solid var(--background-modifier-border);
        border-right: 1px solid var(--background-modifier-border);
        min-width: 0;
        max-width: none;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        vertical-align: middle;
        font-size: var(--font-ui-small);
        line-height: 1.35;
        background: var(--background-primary);
      }

      .tps-log-base-cell--editable {
        cursor: pointer;
      }

      .tps-log-base-cell--editable.is-empty {
        color: var(--text-faint);
        font-style: italic;
      }

      .tps-log-base-cell--editable:hover,
      .tps-log-base-cell--editable:focus-visible {
        color: var(--text-normal);
        background: var(--background-modifier-hover);
        outline: 2px solid var(--interactive-accent);
        outline-offset: -2px;
      }

      .tps-log-base-boolean-control {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        min-height: 24px;
        margin: -4px 0;
      }

      .tps-log-base-boolean-control--editable {
        cursor: pointer;
      }

      .tps-log-base-boolean-checkbox {
        width: 16px;
        height: 16px;
        margin: 0;
      }

      .tps-log-base-boolean-control--readonly .tps-log-base-boolean-checkbox:disabled {
        opacity: 1;
        pointer-events: none;
      }

      .tps-log-base-file-link {
        color: var(--link-color);
        text-decoration: var(--link-decoration);
      }

      .tps-log-base-file-link:hover,
      .tps-log-base-file-link:focus-visible {
        color: var(--link-color-hover);
        text-decoration: var(--link-decoration-hover);
      }

      .tps-log-base-body .tps-log-base-row:last-child .tps-log-base-cell {
        border-bottom: 0;
      }

      .tps-log-base-row--totals .tps-log-base-cell {
        background: color-mix(in srgb, var(--background-secondary) 82%, var(--background-primary));
        color: var(--text-normal);
        font-weight: 750;
        font-variant-numeric: tabular-nums;
      }

      .tps-log-base-row--totals[data-position="top"] .tps-log-base-cell {
        box-shadow: inset 0 -1px color-mix(in srgb, var(--interactive-accent) 35%, var(--background-modifier-border));
      }

      .tps-log-base-row--totals[data-position="bottom"] .tps-log-base-cell {
        box-shadow: inset 0 1px color-mix(in srgb, var(--interactive-accent) 35%, var(--background-modifier-border));
      }

      .tps-log-base-group-row .tps-log-base-cell--group {
        background: color-mix(in srgb, var(--background-secondary) 88%, var(--background-primary));
        color: var(--text-normal);
        border-right: 0;
        padding-block: 7px;
        font-weight: 700;
        text-align: left;
      }

      .tps-log-base-group-content {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }

      .tps-log-base-group-count {
        flex: 0 0 auto;
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        font-weight: 500;
      }

      .tps-log-base-cell--total-label {
        color: var(--text-muted) !important;
        text-align: left !important;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .tps-log-base-cell--total-value {
        text-align: right;
      }

      .tps-log-base-cell--header {
        position: relative;
        padding-right: 16px;
        background: var(--background-secondary) !important;
        color: var(--text-muted);
        font-weight: 600;
        text-align: left;
        user-select: none;
      }

      .tps-log-base-header-label {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tps-log-base-column-resize {
        position: absolute;
        top: 0;
        right: -4px;
        width: 8px;
        height: 100%;
        cursor: col-resize;
        z-index: 2;
        touch-action: none;
      }

      .tps-log-base-column-resize::after {
        content: "";
        position: absolute;
        top: 20%;
        bottom: 20%;
        left: 3px;
        border-left: 1px solid transparent;
      }

      .tps-log-base-cell--header:hover .tps-log-base-column-resize::after,
      .tps-log-base--resizing .tps-log-base-column-resize::after {
        border-left-color: var(--interactive-accent);
      }

      .tps-log-base--resizing,
      .tps-log-base--resizing * {
        cursor: col-resize !important;
        user-select: none !important;
      }

      .tps-log-base-cell--qty,
      .tps-log-base-cell--servings,
      .tps-log-base-cell--amount,
      .tps-log-base-cell--cal,
      .tps-log-base-cell--protein,
      .tps-log-base-cell--carbs,
      .tps-log-base-cell--fat {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .tps-log-base-empty {
        padding: 16px;
        color: var(--text-muted);
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
      }

      .tps-gcm-virtual-base-embed .internal-embed:is([src$=".base"], [data-src$=".base"], [alt$=".base"]) > .markdown-embed-content {
        display: block;
        max-height: none;
        overflow: visible;
      }

      .tps-gcm-virtual-base-embed .internal-embed:is([src$=".base"], [data-src$=".base"], [alt$=".base"]) .markdown-preview-view {
        min-height: 0;
        height: auto;
        overflow: visible;
      }

      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .markdown-embed-content,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .internal-embed > .markdown-embed-content,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .markdown-preview-view,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .markdown-preview-sizer,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .markdown-preview-section {
        min-height: 0 !important;
        height: auto !important;
        max-height: none !important;
        padding: 0 !important;
        margin: 0 !important;
        overflow: visible !important;
      }

      .tps-gcm-virtual-base-embed .internal-embed:is([src$=".base"], [data-src$=".base"], [alt$=".base"]) .bases-view {
        max-height: none;
        min-height: 0;
      }

      .tps-gcm-virtual-base-embed {
        display: block;
        box-sizing: border-box;
        width: 100%;
        max-width: 100%;
        max-height: none;
        margin: 8px 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        overflow: visible;
      }

      .tps-gcm-virtual-base-embed-item {
        display: block;
        min-height: 0;
      }

      .tps-gcm-virtual-base-embed-item + .tps-gcm-virtual-base-embed-item {
        margin-top: 8px;
      }

      .tps-gcm-virtual-base-embed-item--empty {
        display: none !important;
      }

      .tps-gcm-virtual-base-empty-state-inline {
        display: none !important;
        min-height: 0 !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }

      .tps-gcm-virtual-base-embed > .internal-embed,
      .tps-gcm-virtual-base-embed > .markdown-embed,
      .tps-gcm-virtual-base-embed .internal-embed:is([src$=".base"], [data-src$=".base"], [alt$=".base"]) {
        margin: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        min-height: 0 !important;
        background: transparent !important;
      }

      .tps-gcm-virtual-base-embed .markdown-embed-title,
      .tps-gcm-virtual-base-embed .markdown-embed-link {
        display: none !important;
      }

      .tps-gcm-virtual-base-embed--hover .bases-header,
      .tps-gcm-virtual-base-embed--hover .bases-toolbar,
      .tps-gcm-virtual-base-embed--hover .view-header {
        display: none !important;
      }

      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-header,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-toolbar {
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        height: auto !important;
        min-height: 28px !important;
      }

      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-header {
        align-items: center !important;
      }

      .tps-gcm-virtual-base-embed .bases-view {
        padding: 0 !important;
        min-height: 0 !important;
        height: auto !important;
      }

      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-view,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-embed,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .block-language-base,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-table,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-table-container,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-cards,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-kanban,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-feed,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-feed-view,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .empty-state,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .empty-state-container,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-empty-state,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-no-results {
        min-height: 0 !important;
        height: auto !important;
        max-height: none !important;
      }

      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .empty-state,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .empty-state-container,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-empty-state,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .bases-no-results {
        padding-block: 16px !important;
        justify-content: flex-start !important;
      }

      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .tps-kanban-root,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .tps-kanban-container {
        padding: 0 !important;
        min-height: 0 !important;
        max-height: none !important;
        overflow: visible !important;
        scrollbar-gutter: auto !important;
      }

      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .tps-kanban-view-controls {
        display: none !important;
      }

      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .tps-kanban-reading-embed-section,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .tps-kanban-reading-embed-block {
        transform: none !important;
        margin-bottom: 0 !important;
      }

      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .tps-kanban-board {
        display: grid !important;
        grid-auto-flow: column;
        grid-auto-columns: minmax(180px, 1fr);
        gap: 8px !important;
        width: 100% !important;
        min-width: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
      }

      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .tps-kanban-lane {
        width: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        padding: 8px !important;
        overflow: visible !important;
      }

      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .tps-kanban-lane--empty {
        min-height: 44px !important;
      }

      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .tps-kanban-lane-header {
        margin-bottom: 0 !important;
        min-height: 28px !important;
        padding: 2px 3px !important;
      }

      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .tps-kanban-lane--empty .tps-kanban-cards,
      .tps-gcm-virtual-base-embed:not(.tps-gcm-virtual-base-embed--hover) .tps-kanban-lane--empty .tps-kanban-add-card {
        display: none !important;
      }

      .tps-gcm-virtual-base-embed--top {
        margin-top: 6px;
        margin-bottom: 10px;
      }

      .tps-gcm-virtual-base-embed--bottom {
        margin-top: 10px;
        margin-bottom: 6px;
      }

      .tps-gcm-virtual-base-embed--hover {
        position: fixed;
        left: max(16px, calc(env(safe-area-inset-left, 0px) + 16px));
        right: max(16px, calc(env(safe-area-inset-right, 0px) + 16px));
        bottom: calc(var(--tps-gcm-mobile-toolbar-offset, 0px) + env(safe-area-inset-bottom, 0px) + 72px);
        z-index: 90;
        max-height: var(--tps-gcm-base-hover-height);
        overflow: auto;
        overscroll-behavior: contain;
        border: 1px solid color-mix(in srgb, var(--background-modifier-border) 80%, transparent);
        border-radius: 12px;
        background: color-mix(in srgb, var(--background-primary) 96%, var(--background-secondary));
        box-shadow: 0 8px 26px rgba(0, 0, 0, 0.22);
        scrollbar-width: thin;
      }

      .tps-gcm-virtual-base-embed--hover .markdown-embed-content,
      .tps-gcm-virtual-base-embed--hover .internal-embed > .markdown-embed-content {
        max-height: var(--tps-gcm-base-hover-height);
        overflow: auto;
        overscroll-behavior: contain;
        scrollbar-width: thin;
      }

      body.tps-gcm-gesture-collapsed .tps-gcm-virtual-base-embed--hover,
      body.tps-gcm-gesture-collapsed .tps-gcm-hover-element,
      body.tps-gcm-gesture-collapsed [data-tps-hover-element="true"],
      body.tps-tps-mobile-ui-gesture-hidden .tps-gcm-hover-element,
      body.tps-tps-mobile-ui-gesture-hidden [data-tps-hover-element="true"],
      body.tps-tps-mobile-ui-keyboard-hidden .tps-gcm-hover-element,
      body.tps-tps-mobile-ui-keyboard-hidden [data-tps-hover-element="true"],
      .is-mobile.tps-context-hidden-for-keyboard .tps-gcm-virtual-base-embed--hover,
      .is-mobile.tps-context-hidden-for-keyboard .tps-gcm-hover-element,
      .is-mobile.tps-context-hidden-for-keyboard [data-tps-hover-element="true"],
      .is-phone.tps-context-hidden-for-keyboard .tps-gcm-virtual-base-embed--hover,
      .is-phone.tps-context-hidden-for-keyboard .tps-gcm-hover-element,
      .is-phone.tps-context-hidden-for-keyboard [data-tps-hover-element="true"] {
        display: none !important;
      }

      body.is-mobile .tps-gcm-virtual-base-embed,
      body.is-phone .tps-gcm-virtual-base-embed,
      body.is-tablet .tps-gcm-virtual-base-embed {
        margin-left: calc(var(--file-margins, 0px) * -1);
        margin-right: calc(var(--file-margins, 0px) * -1);
        width: calc(100% + (var(--file-margins, 0px) * 2));
      }

      body.is-mobile .tps-gcm-virtual-base-embed--hover,
      body.is-phone .tps-gcm-virtual-base-embed--hover,
      body.is-tablet .tps-gcm-virtual-base-embed--hover {
        left: max(10px, env(safe-area-inset-left, 0px));
        right: max(10px, env(safe-area-inset-right, 0px));
        bottom: calc(var(--tps-gcm-mobile-toolbar-offset, 0px) + env(safe-area-inset-bottom, 0px) + 86px);
        max-height: min(300px, 40vh);
      }

      .canvas-node-content:has(.internal-embed:is([src$=".base"], [data-src$=".base"], [alt$=".base"])),
      .canvas-node-content:has(:is(.bases-view, .bases-embed, .bases-table, .bases-feed-container, .tps-kanban-container, .tps-health-food-log-base, .bases-calendar-container--canvas-embedded)) {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        overflow: hidden !important;
        background: var(--background-primary);
      }

      .canvas-node-content .internal-embed:is([src$=".base"], [data-src$=".base"], [alt$=".base"]),
      .canvas-node-content .internal-embed:is([src$=".base"], [data-src$=".base"], [alt$=".base"]) > .markdown-embed-content,
      .canvas-node-content .internal-embed:is([src$=".base"], [data-src$=".base"], [alt$=".base"]) .markdown-preview-view,
      .canvas-node-content .internal-embed:is([src$=".base"], [data-src$=".base"], [alt$=".base"]) .markdown-preview-sizer,
      .canvas-node-content .internal-embed:is([src$=".base"], [data-src$=".base"], [alt$=".base"]) .markdown-preview-section {
        box-sizing: border-box;
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        max-height: none !important;
        min-width: 0 !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        background: transparent !important;
        overflow: hidden !important;
      }

      .canvas-node-content .internal-embed:is([src$=".base"], [data-src$=".base"], [alt$=".base"]) .markdown-embed-title,
      .canvas-node-content .internal-embed:is([src$=".base"], [data-src$=".base"], [alt$=".base"]) .markdown-embed-link,
      .canvas-node-content .internal-embed:is([src$=".base"], [data-src$=".base"], [alt$=".base"]) .edit-block-button {
        display: none !important;
      }

      .canvas-node-content .bases-header,
      .canvas-node-content .bases-toolbar,
      .canvas-node-content .bases-view-header,
      .canvas-node-content .base-view-header {
        display: flex !important;
        flex: 0 0 auto;
        visibility: visible !important;
        opacity: 1 !important;
        min-height: 30px !important;
      }

      .canvas-node-content .bases-view,
      .canvas-node-content .bases-embed,
      .canvas-node-content .block-language-base,
      .canvas-node-content .bases-table,
      .canvas-node-content .bases-table-container,
      .canvas-node-content .bases-cards,
      .canvas-node-content .bases-feed,
      .canvas-node-content .bases-feed-view,
      .canvas-node-content .bases-feed-container,
      .canvas-node-content .tps-health-food-log-base {
        box-sizing: border-box;
        width: 100% !important;
        max-width: none !important;
        min-width: 0 !important;
        min-height: 0 !important;
      }

      .canvas-node-content .bases-view,
      .canvas-node-content .bases-embed,
      .canvas-node-content .block-language-base {
        display: flex !important;
        flex-direction: column;
        height: 100% !important;
        max-height: 100% !important;
        overflow: hidden !important;
      }

      .canvas-node-content .bases-table,
      .canvas-node-content .bases-table-container,
      .canvas-node-content .bases-cards,
      .canvas-node-content .bases-feed,
      .canvas-node-content .bases-feed-view,
      .canvas-node-content .bases-feed-container,
      .canvas-node-content .tps-health-food-log-base {
        flex: 1 1 auto;
        height: auto !important;
        max-height: 100% !important;
        overflow: auto !important;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        scrollbar-width: thin;
        -webkit-overflow-scrolling: touch;
      }

      .canvas-node-content .bases-feed-container {
        max-width: none !important;
        margin: 0 !important;
        padding: 10px !important;
      }

      .canvas-node-content .bases-feed-entry {
        padding: 12px !important;
        border-radius: 6px !important;
      }

      .canvas-node-content .bases-feed-entry-header {
        margin-bottom: 8px !important;
      }

      .canvas-node-content .bases-feed-entry-content {
        font-size: var(--font-ui-small);
        line-height: 1.45;
      }

      .canvas-node-content :is(.bases-view, .bases-embed, .bases-feed-container, .tps-kanban-container, .tps-health-food-log-base) :is(.bases-empty-state, .bases-no-results, .empty-state, .empty-state-container, .bases-feed-empty) {
        min-height: 0 !important;
        padding: 14px !important;
        color: var(--text-muted);
      }

      .canvas-node-content .tps-kanban-root,
      .canvas-node-content .tps-kanban-container {
        box-sizing: border-box;
        width: 100% !important;
        max-width: none !important;
        height: 100% !important;
        max-height: 100% !important;
        min-width: 0 !important;
        min-height: 0 !important;
        padding: 8px !important;
        overflow: auto !important;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
      }

      .canvas-node-content .tps-kanban-view-controls {
        top: 0;
        margin-bottom: 6px !important;
        padding-bottom: 6px !important;
        background: color-mix(in srgb, var(--background-primary) 88%, transparent) !important;
        backdrop-filter: blur(8px);
      }

      .canvas-node-content .tps-kanban-board {
        width: max-content !important;
        min-width: 100% !important;
        align-items: stretch !important;
      }

      .canvas-node-content .tps-kanban-lane {
        max-height: none !important;
        min-height: 96px !important;
      }

      .canvas-node-content .tps-kanban-card,
      .canvas-node-content .tps-kanban-task-card {
        min-width: 0 !important;
      }

      .canvas-node-content .tps-health-food-log-base {
        min-height: 0 !important;
        padding: 8px !important;
        gap: 8px !important;
      }

      .canvas-node-content .tps-health-food-log-base :is(.tps-health-food-log-toolbar, .tps-health-food-log-summary, .tps-health-food-log-day-header) {
        gap: 6px !important;
        min-width: 0 !important;
      }

      .canvas-node-content .tps-health-food-log-base :is(.tps-health-food-log-title, .tps-health-food-log-summary-macros, .tps-health-food-log-day-meta, .tps-health-food-log-day-macros, .tps-health-food-log-entry-main, .tps-health-food-log-entry-macros) {
        min-width: 0 !important;
      }

      .canvas-node-content .tps-health-food-log-base .tps-health-food-log-toolbar {
        align-items: flex-start !important;
        flex-wrap: wrap !important;
      }

      .canvas-node-content .tps-health-food-log-base .tps-health-food-log-heading {
        font-size: var(--font-ui-medium) !important;
        line-height: 1.15 !important;
      }

      .canvas-node-content .tps-health-food-log-base .tps-health-food-log-subtitle {
        font-size: var(--font-ui-smaller) !important;
        line-height: 1.25 !important;
      }

      .canvas-node-content .tps-health-food-log-base .tps-health-food-log-action-button {
        min-height: 28px !important;
        padding: 3px 9px !important;
      }

      .canvas-node-content .tps-health-food-log-base :is(.tps-health-food-log-summary, .tps-health-food-log-day-header) {
        align-items: flex-start !important;
        flex-wrap: wrap !important;
        padding: 7px !important;
      }

      .canvas-node-content .tps-health-food-log-base .tps-health-food-log-day-meta {
        justify-content: flex-start !important;
      }

      .canvas-node-content .tps-health-food-log-entry {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) !important;
        grid-template-areas:
          "main"
          "macros"
          "actions" !important;
        align-items: start !important;
        gap: 6px 8px !important;
        padding: 8px !important;
      }

      .canvas-node-content .tps-health-food-log-entry-main {
        grid-area: main;
      }

      .canvas-node-content .tps-health-food-log-entry-title {
        align-items: flex-start !important;
        display: flex !important;
        flex-wrap: wrap !important;
        gap: 4px 6px !important;
      }

      .canvas-node-content .tps-health-food-log-entry-name {
        flex: 1 1 150px;
        min-width: 0 !important;
        overflow-wrap: anywhere;
        white-space: normal !important;
      }

      .canvas-node-content .tps-health-food-log-entry-serving {
        flex: 0 1 auto;
        max-width: 100%;
        min-width: 0 !important;
      }

      .canvas-node-content .tps-health-food-log-entry-source {
        display: none !important;
      }

      .canvas-node-content .tps-health-food-log-entry-macros {
        grid-area: macros;
        justify-content: flex-start !important;
      }

      .canvas-node-content .tps-health-food-log-entry-actions {
        grid-area: actions;
        display: grid !important;
        grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
        gap: 5px !important;
        justify-content: stretch !important;
        min-width: 0 !important;
        width: 100% !important;
      }

      .canvas-node-content .tps-health-food-log-entry-action {
        min-height: 28px !important;
        padding: 2px 5px !important;
        font-size: 11px !important;
        line-height: 1 !important;
        min-width: 0 !important;
      }

      .canvas-node-content .tps-health-food-log-base .tps-health-macro-pill {
        max-width: 100%;
        overflow: hidden;
        padding: 1px 6px !important;
        text-overflow: ellipsis;
      }

      .canvas-node-content .tps-health-food-log-base .tps-health-macro-empty {
        display: none !important;
      }

      @container (max-width: 560px) {
        .canvas-node-content .tps-health-food-log-base {
          padding: 6px !important;
          gap: 6px !important;
        }

        .canvas-node-content .tps-health-food-log-base .tps-health-food-log-actions {
          flex: 1 1 100% !important;
          justify-content: stretch !important;
          margin-left: 0 !important;
        }

        .canvas-node-content .tps-health-food-log-base .tps-health-food-log-action-button {
          width: 100% !important;
        }

        .canvas-node-content .tps-health-food-log-base .tps-health-food-log-day-meta > span {
          display: none !important;
        }

        .canvas-node-content .tps-health-food-log-entry {
          gap: 5px !important;
          padding: 7px !important;
        }

        .canvas-node-content .tps-health-food-log-entry-name {
          flex-basis: 100%;
          font-size: var(--font-ui-small) !important;
          line-height: 1.25 !important;
        }

        .canvas-node-content .tps-health-food-log-entry-serving {
          font-size: 11px !important;
          line-height: 1.25 !important;
          padding: 1px 6px !important;
        }

        .canvas-node-content .tps-health-food-log-entry-actions {
          display: none !important;
        }
      }

      .tps-gcm-hover-editor-note-scale .workspace-leaf-content[data-type="markdown"] {
        --tps-gcm-hover-editor-scale: 0.82;
        zoom: var(--tps-gcm-hover-editor-scale);
        width: calc(100% / var(--tps-gcm-hover-editor-scale));
        height: calc(100% / var(--tps-gcm-hover-editor-scale));
      }

      .tps-gcm-hover-editor-note-scale .workspace-leaf-content[data-type="markdown"] .view-content {
        overflow-x: hidden;
      }

      .tps-gcm-create-task-modal {
        width: min(640px, calc(100vw - 32px));
      }

      .tps-gcm-ai-task-modal {
        width: min(720px, calc(100vw - 32px));
      }

      .tps-gcm-create-task-modal .setting-item {
        align-items: center;
      }

      .tps-gcm-ai-task-modal textarea {
        width: 100%;
        min-height: 84px;
        resize: vertical;
      }

      .tps-gcm-create-task-modal .setting-item-control input,
      .tps-gcm-create-task-modal .setting-item-control select {
        min-width: min(280px, 52vw);
      }

      .tps-gcm-create-task-preview-wrap,
      .tps-gcm-create-task-line-wrap {
        margin: 12px 0;
        padding: 10px 12px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: var(--background-secondary);
      }

      .tps-gcm-create-task-label {
        margin-bottom: 6px;
        color: var(--text-muted);
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
      }

      .tps-gcm-create-task-detected,
      .tps-gcm-create-task-line {
        color: var(--text-normal);
        overflow-wrap: anywhere;
        line-height: 1.45;
      }

      .tps-gcm-create-task-detected mark {
        padding: 0 3px;
        border-radius: 4px;
        color: var(--text-on-accent);
        background: var(--interactive-accent);
      }

      .tps-gcm-create-task-scheduled-hint {
        margin-top: 6px;
        color: var(--text-muted);
        font-size: 12px;
      }

      .tps-gcm-create-task-line {
        font-family: var(--font-monospace);
        font-size: 13px;
      }

      .tps-gcm-ai-task-status {
        margin: 10px 0;
        color: var(--text-muted);
        font-size: 13px;
      }

      .tps-gcm-ai-task-proposal h3 {
        margin: 16px 0 8px;
      }

      .tps-gcm-ai-task-summary,
      .tps-gcm-ai-task-rationale,
      .tps-gcm-ai-task-warnings {
        margin: 10px 0;
        padding: 10px 12px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: var(--background-secondary);
        color: var(--text-normal);
        line-height: 1.45;
      }

      .tps-gcm-ai-task-summary {
        display: grid;
        gap: 4px;
      }

      .tps-gcm-ai-task-warnings {
        border-color: var(--text-warning);
      }

      .tps-daily-note-nav {
        z-index: 50;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: calc(8px * var(--tps-gcm-daily-nav-scale));
        max-width: 100%;
        background: transparent;
        border: none;
        border-radius: 0;
        padding: 0;
        box-shadow: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
      }

      .tps-daily-note-nav-control {
        user-select: none;
        -webkit-user-select: none;
        touch-action: manipulation;
      }

      .tps-daily-note-nav--floating {
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        opacity: 1;
        transition: none;
        pointer-events: auto;
      }

      .markdown-source-view:hover .tps-daily-note-nav--floating,
      .markdown-reading-view:hover .tps-daily-note-nav--floating,
      .tps-daily-note-nav--floating:hover {
         opacity: 1;
         pointer-events: auto;
      }

      /* When rest opacity > 0 the nav is always partially visible and interactive */
      .tps-daily-note-nav--floating[data-rest-visible] {
        pointer-events: auto;
      }

      /* Mobile is the only layout where the daily nav can rest hidden/collapsed. */
      .is-mobile .tps-daily-note-nav--floating,
      .is-phone .tps-daily-note-nav--floating {
        opacity: var(--tps-gcm-daily-nav-rest-opacity);
        transition: opacity 0.2s ease;
        pointer-events: none;
      }

      .is-mobile .markdown-source-view:hover .tps-daily-note-nav--floating,
      .is-mobile .markdown-reading-view:hover .tps-daily-note-nav--floating,
      .is-mobile .tps-daily-note-nav--floating:hover,
      .is-mobile .tps-daily-note-nav--floating[data-rest-visible],
      .is-phone .markdown-source-view:hover .tps-daily-note-nav--floating,
      .is-phone .markdown-reading-view:hover .tps-daily-note-nav--floating,
      .is-phone .tps-daily-note-nav--floating:hover,
      .is-phone .tps-daily-note-nav--floating[data-rest-visible] {
        opacity: 1;
        pointer-events: auto;
      }

      .tps-daily-note-nav--inline {
        position: absolute;
        inset-inline-end: 0;
        top: 50%;
        transform: translateY(-50%);
        margin: 0;
      }

      .tps-daily-note-nav-host {
        position: relative;
        padding-inline-end: 160px;
      }

      .tps-daily-note-nav-anchor {
        position: relative;
      }

      .tps-daily-note-nav-mobile-host {
        position: relative;
      }

      .view-header.tps-daily-note-nav-header-host {
        position: relative;
        min-height: calc(62px * var(--tps-gcm-daily-nav-scale));
        overflow: visible;
      }

      .view-header.tps-daily-note-nav-header-host .view-header-title-container {
        visibility: hidden;
      }

      .tps-daily-note-nav-anchor .inline-title,
      .tps-daily-note-nav-anchor .markdown-preview-sizer > h1,
      .tps-daily-note-nav-anchor .markdown-preview-view h1 {
        padding-inline-end: 0;
        box-sizing: border-box;
      }

      .tps-daily-note-nav--under-title {
        position: relative;
        display: flex;
        align-items: flex-start;
        width: 100%;
        margin: 0 0 22px;
        opacity: 1;
        pointer-events: auto;
        z-index: 4;
      }

      body:not(.is-mobile):not(.is-phone) .tps-daily-note-nav {
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto;
      }

      .tps-daily-note-nav--mobile-bottom {
        position: absolute;
        display: flex;
        left: max(10px, env(safe-area-inset-left, 0px));
        right: max(10px, env(safe-area-inset-right, 0px));
        bottom: calc(126px + env(safe-area-inset-bottom, 0px));
        width: auto;
        max-width: 100%;
        margin: 0;
        flex-direction: column-reverse;
        gap: 8px;
        align-items: stretch;
        opacity: 1;
        pointer-events: none;
        z-index: 100001;
        padding: 0;
        border-radius: 0;
        background: transparent;
        border: none;
        box-shadow: none;
        box-sizing: border-box;
        overflow: visible;
      }

      .tps-daily-note-nav--header {
        position: absolute;
        left: 50%;
        top: calc(6px * var(--tps-gcm-daily-nav-scale));
        transform: translateX(-50%);
        width: min(560px, calc(100% - 210px));
        gap: 2px;
        pointer-events: auto;
      }

      .tps-scheduled-daily-note-link-host {
        position: relative;
      }

      .tps-scheduled-daily-note-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: calc(6px * var(--tps-gcm-daily-nav-scale));
        height: calc(30px * var(--tps-gcm-daily-nav-scale));
        min-width: 0;
        padding: 0 calc(10px * var(--tps-gcm-daily-nav-scale));
        border: 1px solid var(--background-modifier-border);
        border-radius: calc(7px * var(--tps-gcm-daily-nav-scale));
        background: var(--background-primary);
        color: var(--text-muted);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
        cursor: pointer;
        font-size: calc(12px * var(--tps-gcm-daily-nav-scale));
        font-weight: 600;
        line-height: 1;
        pointer-events: auto;
        white-space: nowrap;
      }

      .tps-scheduled-daily-note-link:hover {
        color: var(--text-normal);
        background: var(--background-modifier-hover);
      }

      .tps-scheduled-daily-note-link svg {
        width: calc(15px * var(--tps-gcm-daily-nav-scale));
        height: calc(15px * var(--tps-gcm-daily-nav-scale));
        flex: 0 0 auto;
      }

      .tps-scheduled-daily-note-link--header {
        position: absolute;
        right: calc(8px * var(--tps-gcm-daily-nav-scale));
        top: 50%;
        transform: translateY(-50%);
        z-index: 4;
      }

      .tps-scheduled-daily-note-link--under-title {
        position: relative;
        margin: 0 0 12px;
        z-index: 4;
      }

      .tps-scheduled-daily-note-link--floating {
        position: absolute;
        top: 10px;
        right: 12px;
        z-index: 4;
      }

      .tps-scheduled-daily-note-link--mobile-bottom,
      .is-mobile .tps-scheduled-daily-note-link--mobile-bottom,
      .is-phone .tps-scheduled-daily-note-link--mobile-bottom {
        position: absolute;
        right: max(10px, env(safe-area-inset-right, 0px));
        bottom: calc(126px + env(safe-area-inset-bottom, 0px));
        z-index: 100001;
        height: 32px;
        padding: 0 10px;
        border-radius: 16px;
        background: color-mix(in srgb, var(--background-primary) 82%, transparent);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
      }

      .tps-daily-nav-timeline,
      .tps-daily-nav-controls {
        display: flex;
        align-items: center;
        justify-content: center;
        max-width: 100%;
      }

      .tps-daily-nav-timeline {
        gap: calc(6px * var(--tps-gcm-daily-nav-scale));
        overflow-x: auto;
        scrollbar-width: none;
      }

      .tps-daily-nav-timeline::-webkit-scrollbar {
        display: none;
      }

      .tps-daily-nav-controls {
        gap: calc(8px * var(--tps-gcm-daily-nav-scale));
        width: 100%;
        margin-top: calc(2px * var(--tps-gcm-daily-nav-scale));
      }

      .tps-daily-nav-day {
        height: calc(24px * var(--tps-gcm-daily-nav-scale));
        min-width: calc(56px * var(--tps-gcm-daily-nav-scale));
        border: none;
        border-radius: calc(6px * var(--tps-gcm-daily-nav-scale));
        background: transparent !important;
        box-shadow: none !important;
        color: var(--text-muted);
        cursor: pointer;
        font-size: calc(12px * var(--tps-gcm-daily-nav-scale));
        font-weight: 500;
        padding: 0 calc(8px * var(--tps-gcm-daily-nav-scale));
        transition: color 0.15s ease, background-color 0.15s ease;
        white-space: nowrap;
      }

      .tps-daily-nav-day:hover {
        color: var(--text-normal);
        background: var(--background-modifier-hover);
      }

      .tps-daily-nav-day.is-active {
        color: var(--text-on-accent);
        background: var(--color-purple, var(--interactive-accent)) !important;
        font-weight: 700;
      }

      .tps-daily-nav-btn {
        background: transparent !important;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: calc(2px * var(--tps-gcm-daily-nav-scale));
        border-radius: calc(4px * var(--tps-gcm-daily-nav-scale));
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s ease, background-color 0.15s ease;
      }
      .tps-daily-nav-btn:hover {
        color: var(--text-normal);
        background-color: var(--background-modifier-hover);
      }

      .tps-daily-nav-btn svg {
        width: calc(16px * var(--tps-gcm-daily-nav-scale));
        height: calc(16px * var(--tps-gcm-daily-nav-scale));
      }

      .tps-daily-nav-today {
        font-size: calc(12px * var(--tps-gcm-daily-nav-scale));
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0;
        color: var(--text-muted);
        background: transparent !important;
        box-shadow: none !important;
        cursor: pointer;
        padding: calc(1px * var(--tps-gcm-daily-nav-scale)) calc(8px * var(--tps-gcm-daily-nav-scale));
        border-radius: calc(4px * var(--tps-gcm-daily-nav-scale));
      }
      .tps-daily-nav-today:hover {
        background-color: var(--background-modifier-hover);
      }

      .tps-daily-nav-today.is-active {
        color: var(--text-on-accent);
        background: var(--color-purple, var(--interactive-accent)) !important;
        font-weight: 700;
      }

      .tps-daily-note-nav--mobile-bottom,
      .is-mobile .tps-daily-note-nav--mobile-bottom,
      .is-phone .tps-daily-note-nav--mobile-bottom {
        position: absolute;
        left: max(10px, env(safe-area-inset-left, 0px));
        right: max(10px, env(safe-area-inset-right, 0px));
        bottom: calc(126px + env(safe-area-inset-bottom, 0px));
        transform: none;
        width: auto;
        max-width: 100%;
        margin: 0;
        flex-direction: column-reverse;
        gap: 8px;
        align-items: stretch;
        z-index: 100001;
        padding: 0;
        border-radius: 0;
        background: transparent;
        border: none;
        box-shadow: none;
        pointer-events: none;
        box-sizing: border-box;
        overflow: visible;
      }

      .tps-daily-note-nav--mobile-bottom .tps-daily-nav-timeline,
      .is-mobile .tps-daily-note-nav--mobile-bottom .tps-daily-nav-timeline,
      .is-phone .tps-daily-note-nav--mobile-bottom .tps-daily-nav-timeline {
        display: none;
      }

      .tps-daily-note-nav--mobile-bottom .tps-daily-nav-controls,
      .is-mobile .tps-daily-note-nav--mobile-bottom .tps-daily-nav-controls,
      .is-phone .tps-daily-note-nav--mobile-bottom .tps-daily-nav-controls {
        display: grid;
        grid-template-columns: 30px minmax(72px, auto) 30px;
        justify-content: center;
        gap: 6px;
        width: fit-content;
        max-width: 100%;
        margin-top: 0;
        margin-left: auto;
        margin-right: auto;
        padding: 6px 8px;
        border-radius: 16px;
        background: color-mix(in srgb, var(--background-primary) 82%, transparent);
        border: 1px solid var(--background-modifier-border);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        pointer-events: auto;
      }

      .tps-daily-note-nav--mobile-bottom .tps-daily-nav-day,
      .is-mobile .tps-daily-note-nav--mobile-bottom .tps-daily-nav-day,
      .is-phone .tps-daily-note-nav--mobile-bottom .tps-daily-nav-day {
        flex: 0 0 auto;
        min-width: 40px;
        height: 24px;
        min-height: 0;
        padding: 0 7px;
        border-radius: 7px;
        font-size: 12px;
        line-height: 24px;
      }

      .tps-daily-note-nav--mobile-bottom .tps-daily-nav-btn,
      .is-mobile .tps-daily-note-nav--mobile-bottom .tps-daily-nav-btn,
      .is-phone .tps-daily-note-nav--mobile-bottom .tps-daily-nav-btn {
        width: 30px;
        height: 28px;
        min-width: 0;
        min-height: 0;
        padding: 0;
        border-radius: 7px;
      }

      .tps-daily-note-nav--mobile-bottom .tps-daily-nav-today,
      .is-mobile .tps-daily-note-nav--mobile-bottom .tps-daily-nav-today,
      .is-phone .tps-daily-note-nav--mobile-bottom .tps-daily-nav-today {
        height: 28px;
        min-height: 0;
        padding: 0 10px;
        border-radius: 7px;
        font-size: 12px;
        line-height: 28px;
      }

      .tps-global-context-menu {
        position: fixed;
        min-width: 220px;
        color: var(--text-normal);
        z-index: 9999;
        font-size: calc(14px * var(--tps-gcm-text-scale));
        animation: tps-context-fade 120ms ease-out;
        touch-action: none;
      }

      .tps-gcm-mobile-menu-host {
        position: relative;
      }

      .tps-global-context-menu--mobile-pane {
        position: absolute !important;
        left: max(10px, env(safe-area-inset-left, 0px)) !important;
        right: max(10px, env(safe-area-inset-right, 0px)) !important;
        bottom: calc(58px + env(safe-area-inset-bottom, 0px)) !important;
        top: auto !important;
        width: auto !important;
        max-width: none !important;
        min-width: 0 !important;
        transform: none !important;
        z-index: 100002 !important;
      }
      @keyframes tps-context-fade {
        from { opacity: 0; transform: translateY(4px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .tps-global-context-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        width: 100%;
        border: none;
        background: transparent;
        padding: 6px 14px;
        text-align: left;
        cursor: pointer;
        color: inherit;
      }
      .tps-global-context-item:hover,
      .tps-global-context-item:focus {
        background-color: var(--background-modifier-hover);
        outline: none;
      }
      .tps-global-context-item-label {
        font-weight: 500;
      }
      .tps-global-context-item-desc {
        font-size: calc(12px * var(--tps-gcm-text-scale));
        color: var(--text-muted);
      }
      .tps-global-context-header {
        padding: calc(4px * var(--tps-gcm-density)) calc(14px * var(--tps-gcm-density)) calc(8px * var(--tps-gcm-density));
        font-size: calc(11px * var(--tps-gcm-text-scale));
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-faint);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: calc(8px * var(--tps-gcm-density));
      }
      .tps-gcm-header-left {
        display: flex;
        align-items: center;
        gap: calc(8px * var(--tps-gcm-density));
        flex: 1;
        min-width: 0;
      }
      .tps-gcm-file-title {
        font-weight: 600;
        color: var(--text-normal);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: calc(11px * var(--tps-gcm-text-scale));
      }
      .tps-gcm-note-title-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.05em;
        height: 1.05em;
        margin-right: 0.35em;
        color: currentColor;
        opacity: 1;
        flex-shrink: 0;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        vertical-align: -0.08em;
      }
      .tps-gcm-note-title-icon svg {
        width: 0.95em;
        height: 0.95em;
      }
      .tps-gcm-note-title-icon--emoji {
        font-size: 0.95em;
        line-height: 1;
      }
      .tps-gcm-header-right {
        display: flex;
        align-items: center;
        gap: calc(4px * var(--tps-gcm-density));
        flex-shrink: 0;
      }
      .tps-gcm-panel {
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: calc(6px * var(--tps-gcm-density));
      }
      .tps-gcm-multi-banner {
        font-size: calc(12px * var(--tps-gcm-text-scale));
        color: var(--text-muted);
        background: var(--background-modifier-hover);
        padding: calc(4px * var(--tps-gcm-density)) calc(8px * var(--tps-gcm-density));
        border-radius: calc(6px * var(--tps-gcm-radius-scale));
      }
      .tps-gcm-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .tps-gcm-row label {
        font-size: calc(11px * var(--tps-gcm-text-scale));
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-muted);
      }
      .tps-gcm-input-wrapper {
        position: relative;
        width: 100%;
        display: flex;
        flex-direction: column;
      }
      .tps-gcm-viewmode-rule {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .tps-gcm-viewmode-rule .setting-item {
        margin: 0;
        flex: 1 1 160px;
        min-width: 140px;
      }
      .tps-gcm-viewmode-rule span {
        white-space: nowrap;
      }
      .tps-gcm-row select,
      .tps-gcm-row input[type="text"],
      .tps-gcm-row input[type="datetime-local"],
      .tps-gcm-row input[type="date"] {
        width: 100%;
        border-radius: calc(6px * var(--tps-gcm-control-scale));
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        padding: calc(4px * var(--tps-gcm-control-scale)) calc(8px * var(--tps-gcm-control-scale));
        font-size: calc(12px * var(--tps-gcm-text-scale) * var(--tps-gcm-control-scale));
      }

      /* Live preview: compact toolbar fixed at the bottom of the viewport.
         Uses fixed positioning to avoid affecting readable line length. */
      .tps-global-context-menu--live,
      .tps-global-context-menu--reading {
        /* Shared sizing + surface variables */
        --tps-inline-bar-width: calc(100vw - 24px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px));
        font-size: calc(var(--font-text-size) * 0.85 * var(--tps-gcm-text-scale));
        width: max(220px, var(--tps-inline-bar-width));
        max-width: var(--tps-gcm-pane-width, none);
        margin-left: auto;
        margin-right: auto;
        box-sizing: border-box;
      }

      .markdown-preview-view .tps-global-context-menu--reading {
        /* No background, border, or shadow - just the chips */
      }
      .markdown-view.is-readable-line-width .tps-global-context-menu--live,
      .markdown-view.is-readable-line-width .tps-global-context-menu--reading,
      .markdown-source-view.is-readable-line-width .tps-global-context-menu--live,
      .markdown-source-view.is-readable-line-width .tps-global-context-menu--reading,
      .markdown-preview-view.is-readable-line-width .tps-global-context-menu--reading,
      body.tps-readable-line-width .tps-global-context-menu--live,
      body.tps-readable-line-width .tps-global-context-menu--reading,
      body.is-readable-line-width .tps-global-context-menu--live,
      body.is-readable-line-width .tps-global-context-menu--reading {
        --tps-inline-bar-width: calc(100vw - 24px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px));
        max-width: var(--tps-gcm-pane-width, none);
      }

      .tps-global-context-menu--live,
      .tps-global-context-menu--reading {
        display: flex;
        flex-direction: column;
        justify-content: flex-end; /* Ensure content stacks from bottom up if height is constrained? No, with auto height it grows up from bottom anchor. */
        align-items: center; /* Center children horizontally */
        
        position: fixed;
        /* Move up to clear Obsidian mobile toolbar (approx 50px) + status bar */
        bottom: calc(max(var(--tps-auto-base-embed-bottom, var(--tps-gcm-live-bottom, 16px)), var(--tps-gcm-mobile-toolbar-offset, 0px)) + env(safe-area-inset-bottom, 0px) + var(--tps-auto-base-embed-height, 0px) + 8px);
        left: var(--tps-gcm-live-left);
        right: var(--tps-gcm-live-right);
        /* Respect Obsidian UI text scaling */
        font-size: calc(var(--font-ui-medium) * var(--tps-gcm-text-scale));
        z-index: 100000;
        /* Ensure it fits on screen with the higher bottom offset */
        max-height: calc(100vh - 120px); 
        overflow: visible;
        pointer-events: auto;
        --tps-gcm-scale: 1;
        transform: var(--tps-gcm-live-transform);
        transform-origin: center bottom;
        margin-left: 0;
        margin-right: 0;
      }

      .tps-global-context-menu--collapsed.tps-global-context-menu--live,
      .tps-global-context-menu--collapsed.tps-global-context-menu--reading {
        /* Transparent when collapsed */
      }

      .tps-global-context-menu--live .tps-gcm-panel,
      .tps-global-context-menu--reading .tps-gcm-panel {
        padding: calc(4px * var(--tps-gcm-density)) 0 0;
        background: transparent;
        /* Adjust max-height for inner panel */
        max-height: calc(100vh - 200px);
        overflow-y: auto;
        scrollbar-width: thin;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-auto-flow: row dense;
        column-gap: calc(10px * var(--tps-gcm-density));
        row-gap: calc(10px * var(--tps-gcm-density));
      }


      .tps-global-context-menu--live .tps-gcm-title-row,
      .tps-global-context-menu--reading .tps-gcm-title-row,
      .tps-global-context-menu--live .tps-gcm-tags-row,
      .tps-global-context-menu--reading .tps-gcm-tags-row,
      .tps-global-context-menu--live .tps-gcm-actions-row,
      .tps-global-context-menu--reading .tps-gcm-actions-row,
      .tps-global-context-menu--live .tps-gcm-file-ops-row,
      .tps-global-context-menu--reading .tps-gcm-file-ops-row,
      .tps-global-context-menu--live .tps-gcm-multi-banner,
      .tps-global-context-menu--reading .tps-gcm-multi-banner {
        grid-column: 1 / -1;
      }
      .tps-global-context-menu--live .tps-gcm-unified-row,
      .tps-global-context-menu--reading .tps-gcm-unified-row {
        grid-column: 1 / -1;
        width: 100%;
      }
      .tps-global-context-menu--live .tps-gcm-subitems-panel,
      .tps-global-context-menu--reading .tps-gcm-subitems-panel {
        grid-column: 1 / -1;
        width: 100%;
      }
      .tps-gcm-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .tps-gcm-toolbar .tps-gcm-row {
        margin: 0;
        padding: 0;
      }
      .tps-gcm-toolbar .tps-gcm-row > label {
        display: none;
      }
      .tps-gcm-toolbar select,
      .tps-gcm-toolbar input,
      .tps-gcm-toolbar .tps-gcm-actions-row button {
        font-size: 11px;
        padding: 2px 6px;
      }
      .tps-gcm-toolbar .tps-gcm-actions-row {
        gap: 4px;
      }

      /* Hide only non-persistent context menus for keyboard/modal states */
      .is-mobile.tps-context-hidden-for-keyboard .tps-global-context-menu:not(.tps-global-context-menu--persistent),
      .is-phone.tps-context-hidden-for-keyboard .tps-global-context-menu:not(.tps-global-context-menu--persistent) {
        visibility: hidden;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease, visibility 0.15s ease;
      }
      .is-mobile.tps-auto-base-embed-hidden-for-keyboard .tps-global-context-menu:not(.tps-global-context-menu--persistent),
      .is-phone.tps-auto-base-embed-hidden-for-keyboard .tps-global-context-menu:not(.tps-global-context-menu--persistent) {
        visibility: hidden;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease, visibility 0.15s ease;
      }
      .tps-context-hidden-for-modal .tps-global-context-menu:not(.tps-global-context-menu--persistent) {
        visibility: hidden;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease, visibility 0.15s ease;
      }
      /* Hide floating inline UI surfaces when keyboard is visible.
         The JS handler applies inline-styles as the primary mechanism; this
         body-class rule is a belt-and-suspenders CSS fallback. */
      .is-mobile.tps-context-hidden-for-keyboard .tps-global-context-menu--persistent,
      .is-mobile.tps-context-hidden-for-keyboard .tps-global-context-menu--mobile-pane,
      .is-mobile.tps-context-hidden-for-keyboard .tps-daily-note-nav--mobile-bottom,
      .is-mobile.tps-context-hidden-for-keyboard .tps-gcm-panel,
      .is-mobile.tps-context-hidden-for-keyboard .tps-gcm-note-graph,
      .is-mobile.tps-context-hidden-for-keyboard .tps-gcm-note-references,
      .is-mobile.tps-context-hidden-for-keyboard .tps-gcm-linked-subitem-task,
      .is-mobile.tps-context-hidden-for-keyboard .tps-gcm-linked-subitem-row,
      .is-mobile.tps-context-hidden-for-keyboard .tps-gcm-linked-subitem-link,
      .is-mobile.tps-context-hidden-for-keyboard .tps-gcm-top-parent-nav:not(.tps-gcm-top-parent-nav--with-properties),
      .is-mobile.tps-context-hidden-for-keyboard .tps-gcm-bases-preview-properties,
      .is-mobile.tps-context-hidden-for-keyboard .tps-gcm-base-link-preview-properties,
      .is-mobile.tps-context-hidden-for-keyboard .tps-gcm-inline-subtask-btn,
      .is-mobile.tps-context-hidden-for-keyboard .tps-gcm-action-bar,
      .is-phone.tps-context-hidden-for-keyboard .tps-global-context-menu--persistent,
      .is-phone.tps-context-hidden-for-keyboard .tps-global-context-menu--mobile-pane,
      .is-phone.tps-context-hidden-for-keyboard .tps-daily-note-nav--mobile-bottom,
      .is-phone.tps-context-hidden-for-keyboard .tps-gcm-panel,
      .is-phone.tps-context-hidden-for-keyboard .tps-gcm-note-graph,
      .is-phone.tps-context-hidden-for-keyboard .tps-gcm-note-references,
      .is-phone.tps-context-hidden-for-keyboard .tps-gcm-linked-subitem-task,
      .is-phone.tps-context-hidden-for-keyboard .tps-gcm-linked-subitem-row,
      .is-phone.tps-context-hidden-for-keyboard .tps-gcm-linked-subitem-link,
      .is-phone.tps-context-hidden-for-keyboard .tps-gcm-top-parent-nav:not(.tps-gcm-top-parent-nav--with-properties),
      .is-phone.tps-context-hidden-for-keyboard .tps-gcm-bases-preview-properties,
      .is-phone.tps-context-hidden-for-keyboard .tps-gcm-base-link-preview-properties,
      .is-phone.tps-context-hidden-for-keyboard .tps-gcm-inline-subtask-btn,
      .is-phone.tps-context-hidden-for-keyboard .tps-gcm-action-bar {
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        transition: opacity 0.15s ease, visibility 0.15s ease;
      }
      /* Gesture collapse: smooth hide/reveal for persistent menu surfaces.
         This mirrors mobile toolbar-style motion instead of abruptly removing nodes. */
      .tps-global-context-menu--persistent {
        transition: opacity 0.22s ease, visibility 0.22s ease;
      }

      .tps-global-context-menu--persistent.tps-gcm-gesture-collapsed {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      body.tps-gcm-gesture-collapsed .tps-daily-note-nav--mobile-bottom {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      body.tps-gcm-gesture-collapsed .tps-gcm-bases-preview-properties,
      body.tps-gcm-gesture-collapsed .tps-gcm-base-link-preview-properties {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        transition: opacity 0.22s ease, visibility 0.22s ease;
      }
      body.tps-gcm-gesture-collapsed.is-mobile .tps-global-context-menu--persistent .tps-gcm-action-bar,
      body.tps-gcm-gesture-collapsed.is-phone .tps-global-context-menu--persistent .tps-gcm-action-bar {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        transition: opacity 0.22s ease, visibility 0.22s ease;
      }
      .tps-gcm-tags {
        display: flex;
        flex-wrap: wrap;
        gap: calc(6px * var(--tps-gcm-density));
      }
      
      /* Inline tags container */
      .tps-gcm-tags-inline {
        display: flex;
        flex-wrap: wrap;
        gap: calc(4px * var(--tps-gcm-density));
        align-items: center;
      }
      
      .tps-gcm-tag {
        background: var(--background-modifier-hover);
        border-radius: 999px;
        padding: calc(1px * var(--tps-gcm-density)) calc(6px * var(--tps-gcm-density));
        font-size: calc(9px * var(--tps-gcm-text-scale));
        display: inline-flex;
        align-items: center;
        gap: calc(4px * var(--tps-gcm-density));
        line-height: 1.2;
        text-transform: uppercase;
        font-weight: 600;
        color: var(--text-muted);
      }
      
      .tps-gcm-tag-removable {
        padding-right: 3px;
      }
      
      .tps-gcm-tag-text {
        display: inline;
      }

      .tps-gcm-tag-link {
        color: inherit;
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;
      }

      .tps-gcm-tag-link:hover {
        color: var(--interactive-accent);
      }

      .tps-gcm-external-link,
      .tps-gcm-property-link {
        color: var(--text-accent) !important;
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;
      }

      .tps-gcm-external-link:hover,
      .tps-gcm-property-link:hover {
        color: var(--text-accent-hover) !important;
      }
      
      .tps-gcm-tag-remove {
        border: none;
        background: transparent;
        color: inherit;
        opacity: 0.6;
        cursor: pointer;
        font-size: calc(14px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        padding: 0 2px;
        line-height: 1;
        font-weight: normal;
        transition: opacity 0.15s ease;
      }
      
      .tps-gcm-tag-remove:hover {
        opacity: 1;
      }

      .tps-gcm-inline-subtask-btn {
        border: 1px solid color-mix(in srgb, var(--interactive-accent) 30%, var(--background-modifier-border));
        background: color-mix(in srgb, var(--background-primary) 78%, var(--interactive-accent) 22%);
        color: color-mix(in srgb, var(--text-normal) 75%, var(--interactive-accent));
        cursor: pointer;
        padding: 0;
        width: 22px;
        height: 22px;
        min-width: 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        border-radius: 999px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
        z-index: 9999;
        position: fixed;
        pointer-events: none;
        backdrop-filter: blur(10px);
        transition: opacity 0.12s ease, color 0.12s ease, border-color 0.12s ease, background 0.12s ease, transform 0.12s ease;
        transform: translateY(0) scale(0.96);
      }

      .tps-gcm-inline-subtask-btn.is-visible {
        opacity: 0.95;
        pointer-events: auto;
        transform: translateY(0) scale(1);
      }

      .tps-gcm-inline-subtask-btn:hover {
        color: var(--interactive-accent);
        opacity: 1;
        border-color: color-mix(in srgb, var(--interactive-accent) 78%, transparent);
        background: color-mix(in srgb, var(--background-primary) 62%, var(--interactive-accent) 38%);
      }

      .tps-gcm-linked-subitem-task .tps-gcm-linked-subitem-link,
      .tps-gcm-linked-subitem-task .internal-link,
      .tps-gcm-linked-subitem-task .cm-hmd-internal-link {
        text-decoration: none;
      }

      li.tps-gcm-linked-subitem-task,
      .task-list-item.tps-gcm-linked-subitem-task,
      p.tps-gcm-linked-subitem-task,
      .cm-line.tps-gcm-linked-subitem-task {
        position: relative;
        min-width: 0;
        --tps-gcm-linked-subitem-gap: 6px;
        --tps-gcm-linked-subitem-checkbox-gap: 8px;
      }

      .cm-line.tps-gcm-linked-subitem-task {
        display: block !important;
        border-radius: 0;
        padding-left: var(--list-indent, 1.5em) !important;
        border-left: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        outline: none !important;
      }

      .cm-line.tps-gcm-linked-subitem-task,
      .cm-line.tps-gcm-linked-subitem-task.HyperMD-task-line,
      .cm-line.tps-gcm-linked-subitem-task.cm-active,
      .cm-line.tps-gcm-linked-subitem-task.cm-active.HyperMD-task-line {
        background: transparent !important;
        box-shadow: none !important;
        border: 0 !important;
        outline: none !important;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task,
      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task.HyperMD-task-line,
      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task.cm-active,
      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task.cm-active.HyperMD-task-line {
        display: block !important;
        padding-top: 0 !important;
        padding-bottom: 0 !important;
        padding-right: 0 !important;
        min-height: 0 !important;
        line-height: inherit !important;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task::before,
      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task::after {
        content: none !important;
        display: none !important;
        background: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task > * {
        align-self: center !important;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task *,
      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task *::before,
      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task *::after {
        box-shadow: none !important;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task input.task-list-item-checkbox,
      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task .task-list-item-checkbox {
        margin: 0 var(--tps-gcm-linked-subitem-checkbox-gap) 0 0 !important;
        transform: translateX(var(--list-indent, 1.5em));
        vertical-align: middle !important;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task .tps-gcm-linked-subitem-cm-widget,
      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task .tps-gcm-linked-subitem-row-content.is-cm-widget {
        margin-left: var(--list-indent, 1.5em) !important;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task .cm-formatting-task {
        margin: 0 !important;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task .cm-formatting-list,
      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task .cm-formatting-task,
      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task [class*="cm-formatting-list"],
      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task [class*="cm-formatting-task"],
      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task .cm-indent {
        display: inline-block !important;
        width: 0 !important;
        min-width: 0 !important;
        overflow: hidden !important;
        opacity: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      .tps-gcm-linked-subitem-row,
      .tps-gcm-linked-subitem-row-content {
        display: flex !important;
        align-items: center;
        gap: var(--tps-gcm-linked-subitem-gap);
        flex-wrap: nowrap !important;
        min-width: 0;
        max-width: none;
        flex: 0 1 auto;
        white-space: nowrap;
        width: auto !important;
        background: transparent !important;
        box-shadow: none !important;
        border: 0 !important;
      }

      .tps-gcm-linked-subitem-link {
        display: inline-flex;
        align-items: center;
        flex-shrink: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 300px;
        min-width: 0;
        cursor: pointer;
      }

      button.tps-gcm-linked-subitem-link {
        appearance: none;
        background: none;
        border: 0;
        padding: 0;
        margin: 0;
        color: inherit;
        font: inherit;
        text-align: left;
      }

      .tps-gcm-linked-subitem-link-widget {
        margin-left: 0;
      }

      .tps-gcm-linked-subitem-props-widget {
        margin-left: 6px;
      }

      li.tps-gcm-linked-subitem-task > p.tps-gcm-linked-subitem-row,
      li.tps-gcm-linked-subitem-task > div.tps-gcm-linked-subitem-row,
      li.tps-gcm-linked-subitem-task > span.tps-gcm-linked-subitem-row-content {
        display: flex !important;
        margin: 0;
        flex: 1 1 auto;
        min-width: 0;
        width: auto;
      }

      .tps-gcm-linked-subitem-checkbox {
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-muted);
        width: 18px;
        height: 18px;
        min-width: 18px;
        border-radius: 5px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        padding: 0;
        margin-right: 8px;
        vertical-align: middle;
        transition: opacity 0.1s ease, background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
        flex-shrink: 0;
      }

      .markdown-source-view.mod-cm6 .cm-line .metadata-property[data-property-key="icon"],
      .markdown-source-view.mod-cm6 .cm-line .metadata-property[data-property-key="color"],
      .markdown-source-view.mod-cm6 .cm-line .metadata-property[data-property-key="sort"],
      .markdown-reading-view li.task-list-item .metadata-property[data-property-key="icon"],
      .markdown-reading-view li.task-list-item .metadata-property[data-property-key="color"],
      .markdown-reading-view li.task-list-item .metadata-property[data-property-key="sort"],
      .markdown-preview-view li.task-list-item .metadata-property[data-property-key="icon"],
      .markdown-preview-view li.task-list-item .metadata-property[data-property-key="color"],
      .markdown-preview-view li.task-list-item .metadata-property[data-property-key="sort"],
      .markdown-source-view.mod-cm6 .cm-line .metadata-property[data-property-name="icon"],
      .markdown-source-view.mod-cm6 .cm-line .metadata-property[data-property-name="color"],
      .markdown-source-view.mod-cm6 .cm-line .metadata-property[data-property-name="sort"],
      .markdown-reading-view li.task-list-item .metadata-property[data-property-name="icon"],
      .markdown-reading-view li.task-list-item .metadata-property[data-property-name="color"],
      .markdown-reading-view li.task-list-item .metadata-property[data-property-name="sort"],
      .markdown-preview-view li.task-list-item .metadata-property[data-property-name="icon"],
      .markdown-preview-view li.task-list-item .metadata-property[data-property-name="color"],
      .markdown-preview-view li.task-list-item .metadata-property[data-property-name="sort"] {
        display: none !important;
      }

      .markdown-reading-view input.task-list-item-checkbox.tps-gcm-inline-task-native-checkbox-hidden,
      .markdown-preview-view input.task-list-item-checkbox.tps-gcm-inline-task-native-checkbox-hidden {
        opacity: 0 !important;
        width: 0 !important;
        min-width: 0 !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        position: absolute !important;
        pointer-events: none !important;
      }


      .tps-gcm-linked-subitem-checkbox.is-cm-widget {
        margin-right: 10px;
      }

      .tps-gcm-linked-subitem-checkbox.is-bullet {
        border-color: transparent;
        background: transparent;
      }

      /* Hide native checkbox only when explicitly marked hidden in Live Preview */
      .cm-line input.task-list-item-checkbox.tps-gcm-linked-subitem-checkbox-hidden,
      .cm-line .task-list-item-checkbox.tps-gcm-linked-subitem-checkbox-hidden,
      .cm-line .cm-formatting-task.tps-gcm-linked-subitem-checkbox-hidden {
        opacity: 0 !important;
        width: 0 !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        position: absolute !important;
      }

      /* Hide native links in reading mode when replaced by custom row */
      .tps-gcm-hidden-native-link {
        display: none !important;
        font-size: 0 !important;
        width: 0 !important;
        height: 0 !important;
        overflow: hidden !important;
      }

      /* Row content container - unified structure for both modes */
      .tps-gcm-linked-subitem-row-content {
        display: inline-flex !important;
        align-items: center;
        gap: var(--tps-gcm-linked-subitem-gap);
        flex-wrap: nowrap;
        vertical-align: baseline;
      }

      .tps-gcm-linked-subitem-row-content.is-cm-widget,
      .tps-gcm-linked-subitem-cm-widget {
        display: inline-flex !important;
        align-items: center;
        gap: var(--tps-gcm-linked-subitem-gap);
        flex-wrap: nowrap;
        vertical-align: baseline;
        width: auto !important;
        max-width: none !important;
        flex: 0 0 auto !important;
        background: transparent !important;
        box-shadow: none !important;
        border: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
      }

      /* Link text styling */
      .tps-gcm-linked-subitem-link {
        font-weight: 600;
        color: var(--text-normal);
        cursor: pointer;
      }

      .tps-gcm-linked-subitem-link:hover {
        color: var(--text-accent);
      }

      /* Pills container */
      .tps-gcm-linked-subitem-pills {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex-wrap: nowrap;
        margin-left: 4px;
      }

      .task-list-item.tps-gcm-linked-subitem-task {
        list-style: none;
        padding-left: 0;
      }

      .task-list-item.tps-gcm-linked-subitem-task::marker {
        color: transparent;
      }

      .tps-gcm-linked-subitem-checkbox {
        margin-right: 4px;
        cursor: pointer;
      }

      .tps-gcm-linked-subitem-pill {
        display: inline-block;
        border: 1px solid var(--background-modifier-border);
        border-radius: 999px;
        background: var(--background-modifier-form-field);
        color: var(--text-muted);
        font-size: 0.85em;
        font-weight: 500;
        padding: 1px 4px;
        margin-left: 4px;
        cursor: pointer;
        white-space: nowrap;
        opacity: 1;
        visibility: visible;
      }

      .tps-gcm-linked-subitem-pill:hover {
        border-color: var(--interactive-accent);
        background: color-mix(in srgb, var(--background-modifier-hover), var(--background-primary));
      }

      .tps-gcm-linked-subitem-pill--status {
        color: var(--text-muted);
      }

      .tps-gcm-linked-subitem-pill--priority {
        color: var(--text-muted);
      }

      .tps-gcm-linked-subitem-pill--scheduled {
        color: var(--text-muted);
      }

      .tps-gcm-linked-subitem-pill--tag {
        color: var(--text-accent);
      }

      .tps-gcm-linked-subitem-pill--folder {
        color: var(--text-muted);
      }

      .tps-gcm-linked-subitem-pill--action {
        color: var(--text-muted);
      }

      /* CodeMirror widget context - ensure pills are visible in live preview */
      .cm-widget .tps-gcm-linked-subitem-pill,
      .cm-content .tps-gcm-linked-subitem-pill,
      .cm-line .tps-gcm-linked-subitem-pill {
        display: inline-block;
        opacity: 1;
        visibility: visible;
      }

      /* Wikilink mark decoration in live preview - style without replacing */
      .cm-line .tps-gcm-linked-subitem-wikilink {
        font-weight: 600;
      }

      /* CodeMirror widget wrapper for pills */
      .tps-gcm-linked-subitem-cm-widget {
        display: inline-flex;
        align-items: center;
        flex-wrap: nowrap;
        gap: var(--tps-gcm-linked-subitem-gap);
        vertical-align: baseline;
        max-width: none;
        overflow: visible;
        background: transparent !important;
        box-shadow: none !important;
        border: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
      }

      .tps-gcm-linked-subitem-caret-spacer {
        display: inline-block;
        width: 0.5ch;
        min-width: 0.5ch;
        opacity: 0;
        pointer-events: none;
        user-select: none;
        white-space: pre;
      }

      /* Ensure widget pills inherit proper styling */
      .tps-gcm-linked-subitem-cm-widget .tps-gcm-linked-subitem-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-linked-subitem-task .tps-gcm-linked-subitem-pill {
        background: var(--background-modifier-form-field) !important;
        border-color: var(--background-modifier-border) !important;
      }

      /* Reading mode should mirror the clean inline live-preview row, not a full-width card. */
      .markdown-reading-view li.task-list-item.tps-gcm-linked-subitem-task,
      .markdown-preview-view li.task-list-item.tps-gcm-linked-subitem-task,
      .markdown-reading-view li.tps-gcm-linked-subitem-task,
      .markdown-preview-view li.tps-gcm-linked-subitem-task {
        background: transparent !important;
        box-shadow: none !important;
        border: 0 !important;
        border-radius: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        line-height: inherit !important;
      }

      .markdown-reading-view li.task-list-item.tps-gcm-linked-subitem-task > p,
      .markdown-preview-view li.task-list-item.tps-gcm-linked-subitem-task > p,
      .markdown-reading-view li.tps-gcm-linked-subitem-task > p,
      .markdown-preview-view li.tps-gcm-linked-subitem-task > p {
        display: inline-flex !important;
        align-items: center !important;
        gap: var(--tps-gcm-linked-subitem-gap) !important;
        margin: 0 !important;
        min-width: 0 !important;
        width: auto !important;
        background: transparent !important;
        box-shadow: none !important;
        border: 0 !important;
        line-height: inherit !important;
      }

      .markdown-reading-view li.task-list-item.tps-gcm-linked-subitem-task > input.task-list-item-checkbox,
      .markdown-preview-view li.task-list-item.tps-gcm-linked-subitem-task > input.task-list-item-checkbox,
      .markdown-reading-view li.tps-gcm-linked-subitem-task > input.task-list-item-checkbox,
      .markdown-preview-view li.tps-gcm-linked-subitem-task > input.task-list-item-checkbox {
        margin: 0 var(--tps-gcm-linked-subitem-checkbox-gap) 0 0 !important;
        align-self: center !important;
      }

      .markdown-reading-view li.tps-gcm-linked-subitem-task .tps-gcm-linked-subitem-row-content.is-reading-mode,
      .markdown-preview-view li.tps-gcm-linked-subitem-task .tps-gcm-linked-subitem-row-content.is-reading-mode,
      .markdown-reading-view li.task-list-item.tps-gcm-linked-subitem-task .tps-gcm-linked-subitem-row-content.is-reading-mode,
      .markdown-preview-view li.task-list-item.tps-gcm-linked-subitem-task .tps-gcm-linked-subitem-row-content.is-reading-mode {
        display: inline-flex !important;
        align-items: center !important;
        gap: var(--tps-gcm-linked-subitem-gap) !important;
        margin: 0 !important;
        padding: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
        border: 0 !important;
      }

      body[data-tps-gcm-linked-subitem-style="soft-link"] li.tps-gcm-linked-subitem-task,
      body[data-tps-gcm-linked-subitem-style="soft-link"] .task-list-item.tps-gcm-linked-subitem-task,
      body[data-tps-gcm-linked-subitem-style="soft-link"] p.tps-gcm-linked-subitem-task {
        border-radius: 0;
        transition: color 0.15s ease;
      }

      body[data-tps-gcm-linked-subitem-style="soft-link"] li.tps-gcm-linked-subitem-task.is-open,
      body[data-tps-gcm-linked-subitem-style="soft-link"] .task-list-item.tps-gcm-linked-subitem-task.is-open,
      body[data-tps-gcm-linked-subitem-style="soft-link"] p.tps-gcm-linked-subitem-task.is-open {
        background: transparent !important;
      }

      /* Green complete-state background removed - styling now driven by status mapping only */
      body[data-tps-gcm-linked-subitem-style="soft-link"] li.tps-gcm-linked-subitem-task.is-complete,
      body[data-tps-gcm-linked-subitem-style="soft-link"] .task-list-item.tps-gcm-linked-subitem-task.is-complete,
      body[data-tps-gcm-linked-subitem-style="soft-link"] p.tps-gcm-linked-subitem-task.is-complete {
        /* Default bullet styling for complete items - no special background */
      }

      body[data-tps-gcm-linked-subitem-style="soft-link"] li.tps-gcm-linked-subitem-task.is-canceled,
      body[data-tps-gcm-linked-subitem-style="soft-link"] .task-list-item.tps-gcm-linked-subitem-task.is-canceled,
      body[data-tps-gcm-linked-subitem-style="soft-link"] p.tps-gcm-linked-subitem-task.is-canceled {
        opacity: 0.84;
      }

      body[data-tps-gcm-linked-subitem-style="soft-link"] .tps-gcm-linked-subitem-link {
        font-weight: 600;
      }

      body[data-tps-gcm-linked-subitem-style="accent"] li.tps-gcm-linked-subitem-task,
      body[data-tps-gcm-linked-subitem-style="accent"] .task-list-item.tps-gcm-linked-subitem-task,
      body[data-tps-gcm-linked-subitem-style="accent"] p.tps-gcm-linked-subitem-task {
        border-left: 3px solid var(--interactive-accent);
        padding-left: 6px;
        border-radius: 6px;
      }

      body[data-tps-gcm-linked-subitem-style="accent"] li.tps-gcm-linked-subitem-task.is-complete,
      body[data-tps-gcm-linked-subitem-style="accent"] .task-list-item.tps-gcm-linked-subitem-task.is-complete,
      body[data-tps-gcm-linked-subitem-style="accent"] p.tps-gcm-linked-subitem-task.is-complete {
        border-left-color: var(--color-green);
      }

      body[data-tps-gcm-linked-subitem-style="accent"] li.tps-gcm-linked-subitem-task.is-canceled,
      body[data-tps-gcm-linked-subitem-style="accent"] .task-list-item.tps-gcm-linked-subitem-task.is-canceled,
      body[data-tps-gcm-linked-subitem-style="accent"] p.tps-gcm-linked-subitem-task.is-canceled {
        border-left-color: var(--color-orange);
        opacity: 0.82;
      }

      body[data-tps-gcm-linked-subitem-style="accent"] .tps-gcm-linked-subitem-link {
        font-weight: 700;
        letter-spacing: 0.01em;
      }
      
      .tps-gcm-tag-add {
        border: 1px dashed var(--text-muted);
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        font-size: calc(10px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        padding: calc(1px * var(--tps-gcm-control-scale)) calc(6px * var(--tps-gcm-control-scale));
        border-radius: 999px;
        font-weight: bold;
        transition: all 0.15s ease;
      }
      
      .tps-gcm-tag-add:hover {
        border-color: var(--interactive-accent);
        color: var(--interactive-accent);
      }
      
      .tps-gcm-tag button {
        border: none;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        font-size: calc(11px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        padding: 0;
      }
      
      /* File operations row */
      .tps-gcm-file-ops-row {
        padding-top: calc(8px * var(--tps-gcm-density));
        border-top: 1px solid var(--background-modifier-border);
        margin-top: calc(4px * var(--tps-gcm-density));
      }
      .tps-global-context-menu--live .tps-gcm-row label,
      .tps-global-context-menu--reading .tps-gcm-row label,
      .tps-global-context-menu--live .tps-gcm-file-op-btn,
      .tps-global-context-menu--reading .tps-gcm-file-op-btn,
      .tps-global-context-menu--live .tps-gcm-tag,
      .tps-global-context-menu--reading .tps-gcm-tag,
      .tps-global-context-menu--live .tps-gcm-file-title,
      .tps-global-context-menu--reading .tps-gcm-file-title {
        font-size: 0.95em;
      }

      
      .tps-gcm-file-ops {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      
      .tps-gcm-file-op-btn {
        display: inline-flex;
        align-items: center;
        gap: calc(4px * var(--tps-gcm-density));
        padding: calc(1px * var(--tps-gcm-control-scale) * var(--tps-gcm-density)) calc(5px * var(--tps-gcm-control-scale) * var(--tps-gcm-density));
        border: 1px solid var(--background-modifier-border);
        border-radius: calc(6px * var(--tps-gcm-control-scale) * var(--tps-gcm-radius-scale));
        background: var(--background-primary);
        color: var(--text-muted);
        cursor: pointer;
        font-size: calc(9px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        transition: all 0.15s ease;
      }

      
      .tps-gcm-file-op-btn:hover {
        background: var(--background-modifier-hover);
        color: var(--text-normal);
        border-color: var(--interactive-accent);
      }
      
      .tps-gcm-file-op-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      
      .tps-gcm-file-op-icon svg {
        width: calc(10px * var(--tps-gcm-button-scale));
        height: calc(10px * var(--tps-gcm-button-scale));
      }
      
      .tps-gcm-file-op-label {
        white-space: nowrap;
      }
      
      .tps-gcm-panel--hidden {
        display: none;
      }
      .tps-gcm-panel-toggle {
        display: flex;
        justify-content: flex-end;
        padding: 6px 14px 10px;
      }
      .tps-gcm-panel-toggle button {
        font-size: calc(11px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        border: none;
        cursor: pointer;
        color: var(--interactive-accent);
        background: transparent;
      }
      .tps-gcm-add-row {
        display: flex;
        gap: 6px;
      }
      .tps-gcm-add-row .tps-gcm-input-wrapper {
        flex: 1;
      }
      .tps-gcm-add-row button {
        border-radius: calc(5px * var(--tps-gcm-control-scale));
        border: 1px solid var(--background-modifier-border);
        background: var(--background-modifier-hover);
        padding: calc(3px * var(--tps-gcm-control-scale)) calc(6px * var(--tps-gcm-control-scale));
        font-size: calc(11px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        cursor: pointer;
        white-space: nowrap;
      }
      .tps-gcm-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-primary);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
        max-height: 200px;
        overflow-y: auto;
        z-index: 10000;
      }
      .tps-gcm-dropdown-item {
        padding: 6px 10px;
        cursor: pointer;
      }
      .tps-gcm-dropdown-item:hover {
        background: var(--background-modifier-hover);
      }
      .tps-gcm-input-button {
        width: 100%;
        border-radius: calc(5px * var(--tps-gcm-control-scale));
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        padding: calc(4px * var(--tps-gcm-control-scale)) calc(6px * var(--tps-gcm-control-scale));
        font-size: calc(12px * var(--tps-gcm-text-scale) * var(--tps-gcm-control-scale));
        text-align: left;
        cursor: pointer;
      }

      .tps-gcm-input-select {
        width: 100%;
        border-radius: calc(5px * var(--tps-gcm-control-scale));
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        padding: calc(4px * var(--tps-gcm-control-scale)) calc(6px * var(--tps-gcm-control-scale));
        font-size: calc(12px * var(--tps-gcm-text-scale) * var(--tps-gcm-control-scale));
        cursor: pointer;
        appearance: none;
        -webkit-appearance: none;
      }
      .tps-gcm-recurrence-options {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .tps-gcm-recurrence-options button {
        flex: 1 1 40%;
        border-radius: calc(6px * var(--tps-gcm-control-scale));
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        padding: calc(6px * var(--tps-gcm-control-scale));
        cursor: pointer;
        font-size: calc(12px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
      }
      .tps-gcm-recurrence-header {
        font-size: calc(11px * var(--tps-gcm-text-scale));
        text-transform: uppercase;
        color: var(--text-muted);
        letter-spacing: 0.1em;
      }
      .tps-gcm-recurrence-actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
      }
      .tps-gcm-recurrence-actions button {
        border-radius: calc(5px * var(--tps-gcm-control-scale));
        border: 1px solid var(--background-modifier-border);
        background: var(--background-modifier-hover);
        color: var(--text-normal);
        padding: calc(4px * var(--tps-gcm-control-scale)) calc(8px * var(--tps-gcm-control-scale));
        font-size: calc(11px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        cursor: pointer;
      }
      .tps-gcm-actions-row {
        display: flex;
        justify-content: space-between;
        gap: 6px;
        margin-top: 4px;
      }
      .tps-gcm-actions-row button {
        flex: 1;
        border-radius: calc(5px * var(--tps-gcm-control-scale));
        border: 1px solid var(--background-modifier-border);
        background: var(--background-modifier-hover);
        color: var(--text-normal);
        padding: calc(4px * var(--tps-gcm-control-scale)) calc(6px * var(--tps-gcm-control-scale));
        font-size: calc(11px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        cursor: pointer;
      }
      .tps-gcm-actions-row button.tps-gcm-actions-delete {
        color: var(--text-accent);
      }
      .tps-gcm-native-menu-section {
        border-top: 1px solid var(--background-modifier-border);
        padding: 8px 0;
        margin-top: 4px;
      }
      .tps-gcm-section-header {
        padding: 4px 14px 8px;
        font-size: calc(11px * var(--tps-gcm-text-scale));
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-muted);
      }
      .tps-gcm-native-items {
        display: flex;
        flex-direction: column;
      }
      .tps-gcm-native-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        border: 1px solid transparent;
        background: transparent;
        padding: 6px 14px;
        text-align: left;
        cursor: pointer;
        color: var(--text-normal);
        font-size: calc(13px * var(--tps-gcm-text-scale));
      }

      /* Mobile: smaller action / file-op buttons (collapse handled elsewhere) */
      @media (max-width: 640px) {
        .tps-gcm-actions-row button,
        .tps-gcm-add-row button,
        .tps-gcm-input-button,
        .tps-gcm-input-select,
        .tps-gcm-file-op-btn {
          font-size: calc(9px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
          padding: calc(2px * var(--tps-gcm-control-scale)) calc(4px * var(--tps-gcm-control-scale));
        }

        .tps-gcm-file-op-icon svg {
          width: 10px;
          height: 10px;
        }
      }

      /* --- NEW CONTEXT STRIP LAYOUT --- */
      
      .tps-gcm-unified-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: calc(8px * var(--tps-gcm-density));
        padding: calc(2px * var(--tps-gcm-density)) calc(8px * var(--tps-gcm-density));
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        overflow: hidden;
      }
      
      .tps-gcm-context-strip {
        grid-column: 1;
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: calc(6px * var(--tps-gcm-density));
        overflow-x: auto;
        flex-wrap: nowrap;
        flex: 1 1 auto;
        min-width: 0;
        padding: calc(2px * var(--tps-gcm-density)) 0;
        margin-bottom: 0;
        width: auto;
        max-width: 100%;
        box-sizing: border-box;
        
        /* Hide scrollbar but allow scroll */
        scrollbar-width: none; 
        -ms-overflow-style: none;
      }
      .tps-gcm-context-strip::-webkit-scrollbar {
        display: none;
      }

      body.is-mobile .tps-global-context-menu--persistent .tps-gcm-unified-row,
      body.is-phone .tps-global-context-menu--persistent .tps-gcm-unified-row,
      body.is-tablet .tps-global-context-menu--persistent .tps-gcm-unified-row {
        grid-template-columns: minmax(0, 1fr) auto;
        overflow: visible;
        min-width: 0;
      }

      body.is-mobile .tps-global-context-menu--persistent .tps-gcm-context-strip,
      body.is-phone .tps-global-context-menu--persistent .tps-gcm-context-strip,
      body.is-tablet .tps-global-context-menu--persistent .tps-gcm-context-strip {
        width: 100%;
        max-width: 100%;
        min-width: 0;
        overflow-x: auto;
        overflow-y: hidden;
        flex-wrap: nowrap;
        white-space: nowrap;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-x: contain;
        touch-action: pan-x;
        scroll-snap-type: x proximity;
        padding-inline: 2px;
      }

      body.is-mobile .tps-global-context-menu--persistent:has(.tps-gcm-context-strip) .tps-gcm-bottom-parent-nav,
      body.is-phone .tps-global-context-menu--persistent:has(.tps-gcm-context-strip) .tps-gcm-bottom-parent-nav {
        display: none !important;
      }

      body.is-mobile .tps-global-context-menu--persistent:has(.tps-gcm-context-strip) .tps-gcm-action-bar,
      body.is-phone .tps-global-context-menu--persistent:has(.tps-gcm-context-strip) .tps-gcm-action-bar {
        padding: 0;
        border: 0;
        min-width: auto;
      }

      body.is-mobile .tps-global-context-menu--persistent .tps-gcm-action-bar .tps-gcm-mobile-action-bar-external,
      body.is-phone .tps-global-context-menu--persistent .tps-gcm-action-bar .tps-gcm-mobile-action-bar-external {
        margin-left: 0 !important;
        min-width: calc(44px * var(--tps-gcm-button-scale, 1));
        width: calc(44px * var(--tps-gcm-button-scale, 1));
        padding-inline: 0;
        justify-content: center;
      }

      body.is-mobile .tps-global-context-menu--persistent .tps-gcm-action-bar .tps-gcm-mobile-action-bar-external .tps-gcm-parent-nav-label,
      body.is-phone .tps-global-context-menu--persistent .tps-gcm-action-bar .tps-gcm-mobile-action-bar-external .tps-gcm-parent-nav-label {
        display: none;
      }

      body.is-mobile .tps-global-context-menu--persistent .tps-gcm-context-strip > *,
      body.is-phone .tps-global-context-menu--persistent .tps-gcm-context-strip > *,
      body.is-tablet .tps-global-context-menu--persistent .tps-gcm-context-strip > * {
        flex: 0 0 auto;
        scroll-snap-align: start;
      }

      .tps-gcm-native-properties-expanded .tps-global-context-menu--persistent .tps-gcm-context-strip {
        display: none;
      }

      .tps-global-context-menu--persistent.tps-gcm-native-properties-expanded .tps-gcm-context-strip {
        display: none;
      }
      
      .tps-gcm-chip {
        display: inline-flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        gap: calc(5px * var(--tps-gcm-density));
        padding: calc(6px * var(--tps-gcm-density)) calc(12px * var(--tps-gcm-density));
        border-radius: calc(16px * var(--tps-gcm-radius-scale));
        background: var(--background-modifier-form-field);
        border: 1px solid var(--background-modifier-border);
        font-size: calc(12px * var(--tps-gcm-text-scale));
        font-weight: 500;
        color: var(--text-normal);
        cursor: pointer;
        transition: all 0.15s ease;
        flex-shrink: 0;
        white-space: nowrap;
        user-select: none;
      }
      
      .tps-gcm-chip:hover {
        background: color-mix(in srgb, var(--background-modifier-hover), var(--background-primary));
        border-color: var(--interactive-accent);
        transform: translateY(-1px);
        opacity: 1 !important;
      }
      
      .tps-gcm-chip-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        opacity: 0.8;
        flex-shrink: 0;
      }
      .tps-gcm-chip-icon svg {
        width: 13px;
        height: 13px;
      }
      
      .tps-gcm-chip-label {
        font-weight: 500;
        white-space: nowrap;
      }

      .tps-gcm-chip--tag-value .tps-gcm-chip-tag-remove {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: calc(14px * var(--tps-gcm-button-scale));
        height: calc(14px * var(--tps-gcm-button-scale));
        margin-left: calc(2px * var(--tps-gcm-density));
        border: none;
        border-radius: 999px;
        padding: 0;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease;
      }

      .tps-gcm-chip--tag-value:hover .tps-gcm-chip-tag-remove,
      .tps-gcm-chip--tag-value:focus-within .tps-gcm-chip-tag-remove {
        opacity: 0.95;
        pointer-events: auto;
      }

      .tps-gcm-chip--tag-value .tps-gcm-chip-tag-remove:hover {
        color: var(--text-normal);
        background: var(--background-modifier-hover);
      }

      .tps-gcm-chip--tag-value .tps-gcm-chip-tag-remove svg {
        width: calc(10px * var(--tps-gcm-button-scale));
        height: calc(10px * var(--tps-gcm-button-scale));
      }
      
      /* --- ACTION BAR --- */
      
      .tps-gcm-action-bar {
        grid-column: 2;
        position: static;
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: calc(8px * var(--tps-gcm-density));
        padding: calc(8px * var(--tps-gcm-density)) 0;
        flex: 0 0 auto;
        flex-shrink: 0;
        margin-inline-start: 0;
        justify-content: flex-end;
        justify-self: end;
        pointer-events: auto;
        min-width: max-content;
        white-space: nowrap;
        z-index: 2;
        border-top: 1px solid color-mix(in srgb, var(--background-modifier-border) 50%, transparent);
        border-bottom: 1px solid color-mix(in srgb, var(--background-modifier-border) 50%, transparent);
      }

      .tps-gcm-bottom-parent-nav {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: calc(4px * var(--tps-gcm-density));
        min-width: 0;
        max-width: min(52vw, 520px);
        overflow-x: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }

      .tps-gcm-bottom-parent-nav::-webkit-scrollbar {
        display: none;
      }

      @media (max-width: 700px), (pointer: coarse) {
        body.is-mobile .tps-global-context-menu--persistent,
        body.is-phone .tps-global-context-menu--persistent {
          pointer-events: none;
          touch-action: pan-y;
        }

        body.is-mobile .tps-global-context-menu--persistent .tps-gcm-panel,
        body.is-phone .tps-global-context-menu--persistent .tps-gcm-panel,
        body.is-mobile .tps-global-context-menu--persistent .tps-gcm-unified-row,
        body.is-phone .tps-global-context-menu--persistent .tps-gcm-unified-row,
        body.is-mobile .tps-global-context-menu--persistent .tps-gcm-action-bar,
        body.is-phone .tps-global-context-menu--persistent .tps-gcm-action-bar,
        body.is-mobile .tps-global-context-menu--persistent .tps-gcm-action-group,
        body.is-phone .tps-global-context-menu--persistent .tps-gcm-action-group,
        body.is-mobile .tps-global-context-menu--persistent .tps-gcm-bottom-parent-nav,
        body.is-phone .tps-global-context-menu--persistent .tps-gcm-bottom-parent-nav {
          pointer-events: none;
          touch-action: pan-y;
        }

        body.is-mobile .tps-global-context-menu--persistent button,
        body.is-phone .tps-global-context-menu--persistent button,
      body.is-mobile .tps-global-context-menu--persistent .tps-gcm-chip,
      body.is-phone .tps-global-context-menu--persistent .tps-gcm-chip {
        pointer-events: auto;
        touch-action: pan-x;
      }
      }

      @media (max-width: 980px) {
        .tps-gcm-unified-row { gap: calc(6px * var(--tps-gcm-density)); }
      }
      
      .tps-gcm-action-group {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: calc(4px * var(--tps-gcm-density));
      }
      
      .tps-gcm-icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: calc(36px * var(--tps-gcm-button-scale) * var(--tps-gcm-density));
        height: calc(36px * var(--tps-gcm-button-scale) * var(--tps-gcm-density));
        border-radius: calc(10px * var(--tps-gcm-radius-scale));
        background: var(--background-modifier-form-field);
        color: var(--text-muted);
        border: 1px solid var(--background-modifier-border);
        cursor: pointer;
        transition: all 0.15s ease;
        flex-shrink: 0;
      }
      
      .tps-gcm-icon-btn:hover {
        background: color-mix(in srgb, var(--background-modifier-hover), var(--background-primary));
        color: var(--text-normal);
        border-color: var(--interactive-accent);
        transform: translateY(-1px);
        opacity: 1 !important;
      }
      
      .tps-gcm-icon-btn svg {
        width: calc(16px * var(--tps-gcm-button-scale));
        height: calc(16px * var(--tps-gcm-button-scale));
        display: block;
        flex: 0 0 auto;
        color: currentColor;
        stroke: currentColor;
        fill: none;
        opacity: 1;
        visibility: visible;
      }

      .tps-gcm-subitems-panel {
        display: flex !important;
        flex-direction: column;
        gap: calc(6px * var(--tps-gcm-density));
        padding: calc(8px * var(--tps-gcm-density));
        border: 1px solid var(--background-modifier-border);
        border-radius: calc(10px * var(--tps-gcm-radius-scale));
        background: color-mix(in srgb, var(--background-secondary) 75%, transparent);
        min-width: 0;
        color: var(--text-normal);
        transition: opacity 0.2s ease, visibility 0.2s ease;
        opacity: 1;
        visibility: visible;
        box-sizing: border-box;
        font-size: calc(13px * var(--tps-gcm-text-scale));
        touch-action: none;
        max-height: min(78vh, 920px);
        overflow: hidden;
      }

      .tps-gcm-subitems-panel--hidden {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }

      /* Keyboard-visible state: hide subitems panel entirely so mobile viewport
         remains usable while editing with the on-screen keyboard open. */
      .is-mobile .tps-gcm-subitems-panel--keyboard-hidden,
      .is-phone .tps-gcm-subitems-panel--keyboard-hidden {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      /* Keyboard-visible state: hide persistent inline context menu bar. */
      .is-mobile .tps-gcm-menu--keyboard-hidden,
      .is-phone .tps-gcm-menu--keyboard-hidden {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      /* Gesture collapse behavior for subitems panel (paired with context menu). */
      .tps-gcm-subitems-panel.tps-gcm-gesture-collapsed {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: opacity 0.22s ease, visibility 0.22s ease;
      }

      .cm-sizer .tps-gcm-subitems-panel {
        display: flex !important;
      }

      /* In live preview the panel is fixed-positioned above the context menu bar */
      .tps-gcm-subitems-panel--title-inline.tps-gcm-subitems-panel--live {
        position: fixed;
        z-index: 99999;
        margin-bottom: 0;
      }

      .tps-gcm-subitems-section {
        display: flex;
        flex-direction: column;
        gap: calc(4px * var(--tps-gcm-density));
        min-height: 0;
      }

      .tps-gcm-subitems-section--attachments {
        padding-top: calc(12px * var(--tps-gcm-density));
        border-top: 1px solid color-mix(in srgb, var(--background-modifier-border) 60%, transparent);
      }

      .tps-gcm-subitems-panel--title-inline {
        display: flex !important;
        flex-direction: column;
        gap: calc(6px * var(--tps-gcm-density));
        padding: calc(8px * var(--tps-gcm-density));

        border: 1px solid var(--background-modifier-border);
        border-radius: calc(10px * var(--tps-gcm-radius-scale));
        background: color-mix(in srgb, var(--background-secondary) 75%, transparent);
        min-width: 0;
        color: var(--text-normal);
        transition: opacity 0.2s ease, visibility 0.2s ease;
        opacity: 1;
        visibility: visible;
        box-sizing: border-box;
        font-size: calc(13px * var(--tps-gcm-text-scale));
        max-height: min(78vh, 920px);
        overflow: hidden;
      }

      .tps-gcm-subitems-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
      }

      .tps-gcm-subitems-title-wrap {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1 1 auto;
      }

      .tps-gcm-subitems-title {
        margin: 0;
        font-size: calc(13px * var(--tps-gcm-text-scale));
        line-height: 1.3;
        font-weight: 700;
        color: #e0e0e0 !important;
      }

      .tps-gcm-subitems-subtitle {
        font-size: calc(11px * var(--tps-gcm-text-scale));
        line-height: 1.2;
        color: var(--text-muted);
        display: none;
      }

      .tps-gcm-subitems-subtitle--visible {
        display: block;
      }

      .tps-gcm-subitems-header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }

      .tps-gcm-subitems-header-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: calc(22px * var(--tps-gcm-button-scale));
        height: calc(22px * var(--tps-gcm-button-scale));
        border-radius: calc(6px * var(--tps-gcm-radius-scale));
        border: 1px solid var(--background-modifier-border);
        background: var(--background-modifier-form-field);
        color: var(--text-muted);
        cursor: pointer;
        padding: 0;
        flex-shrink: 0;
      }

      .tps-gcm-subitems-header-btn:hover {
        color: var(--text-normal);
        border-color: var(--interactive-accent);
        background: var(--background-modifier-hover);
      }

      .tps-gcm-subitems-header-btn svg {
        width: calc(14px * var(--tps-gcm-button-scale));
        height: calc(14px * var(--tps-gcm-button-scale));
        display: block;
        flex: 0 0 auto;
        color: currentColor;
        stroke: currentColor;
        fill: none;
        opacity: 1;
        visibility: visible;
      }

      .tps-gcm-subitems-header-btn.mod-cta {
        color: var(--text-on-accent);
        background: var(--interactive-accent);
        border-color: var(--interactive-accent);
      }

      .tps-gcm-subitems-header-btn.mod-cta:hover {
        background: var(--interactive-accent-hover);
      }

      .tps-gcm-subitems-body {
        display: flex;
        flex-direction: column;
        gap: 0;
        min-height: 0;
        transition: background 0.15s ease, outline 0.15s ease;
        border-radius: calc(8px * var(--tps-gcm-radius-scale));
        outline: 2px solid transparent;
        outline-offset: 2px;
      }

      .tps-gcm-subitems-body--children,
      .tps-gcm-subitems-body--attachments,
      .tps-gcm-subitems-body--references {
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        scrollbar-gutter: stable both-edges;
      }

      .tps-gcm-subitems-body--children {
        max-height: min(50vh, 640px);
        padding-right: 2px;
      }

      .tps-gcm-subitems-body--attachments {
        max-height: min(24vh, 280px);
        padding-right: 2px;
      }

      .tps-gcm-subitems-body--references {
        max-height: min(34vh, 420px);
        padding-right: 2px;
      }

      .tps-gcm-subitems-body--children::-webkit-scrollbar,
      .tps-gcm-subitems-body--attachments::-webkit-scrollbar,
      .tps-gcm-subitems-body--references::-webkit-scrollbar {
        width: 8px;
      }

      .tps-gcm-subitems-body--children::-webkit-scrollbar-thumb,
      .tps-gcm-subitems-body--attachments::-webkit-scrollbar-thumb,
      .tps-gcm-subitems-body--references::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--text-muted) 35%, transparent);
        border-radius: 999px;
      }

      .tps-gcm-subitems-body--children::-webkit-scrollbar-track,
      .tps-gcm-subitems-body--attachments::-webkit-scrollbar-track,
      .tps-gcm-subitems-body--references::-webkit-scrollbar-track {
        background: transparent;
      }

      .tps-gcm-subitems-body--drop-target {
        background: color-mix(in srgb, var(--interactive-accent) 10%, transparent) !important;
        outline: 2px solid var(--interactive-accent) !important;
      }

      .tps-gcm-subitem-empty {
        font-size: calc(12px * var(--tps-gcm-text-scale));
        color: var(--text-muted);
        padding: 0;
        line-height: 1.4;
      }

      .tps-gcm-subitem-row {
        margin-inline-start: calc(var(--tps-gcm-subitem-depth, 0) * 14px);
        padding: calc(5px * var(--tps-gcm-density)) calc(7px * var(--tps-gcm-density));
        border-radius: calc(8px * var(--tps-gcm-radius-scale));
        border: 1px solid color-mix(in srgb, var(--background-modifier-border) 70%, transparent);
        background: color-mix(in srgb, var(--background-primary) 84%, transparent);
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        gap: calc(8px * var(--tps-gcm-density));
        min-width: 0;
        overflow: hidden;
      }

      .tps-gcm-subitem-row::-webkit-scrollbar {
        display: none;
      }

      .tps-gcm-subitem-row--dragging {
        opacity: 0.4;
        cursor: grabbing;
      }

      .tps-gcm-subitem-row--hidden {
        opacity: 0.5;
      }

      .tps-gcm-subitem-row--hidden .tps-gcm-subitem-title {
        text-decoration: line-through;
      }

      .tps-gcm-subitems-hidden-badge {
        font-size: calc(10px * var(--tps-gcm-text-scale));
        color: var(--text-muted);
        background: color-mix(in srgb, var(--background-modifier-border) 60%, transparent);
        border-radius: calc(8px * var(--tps-gcm-radius-scale));
        padding: 1px calc(5px * var(--tps-gcm-density));
        margin-inline-start: 4px;
        white-space: nowrap;
      }

      .tps-gcm-subitem-row[draggable="true"] {
        cursor: grab;
      }

      .tps-gcm-subitem-strip {
        display: flex;
        flex: 1 1 auto;
        width: 100%;
        min-width: 0;
        overflow-x: auto;
        scrollbar-width: none;
      }

      .tps-gcm-subitem-inline-strip {
        flex: 0 1 auto;
        width: auto;
        max-width: 55%;
        min-width: 0;
        justify-content: flex-end;
      }

      .tps-gcm-subitem-strip::-webkit-scrollbar {
        display: none;
      }

      .tps-gcm-subitem-strip .tps-gcm-chip {
        gap: calc(3px * var(--tps-gcm-density));
        padding: calc(3px * var(--tps-gcm-density)) calc(6px * var(--tps-gcm-density));
        border-radius: calc(8px * var(--tps-gcm-radius-scale));
        font-size: calc(12px * var(--tps-gcm-text-scale) * 0.75);
        min-height: calc(16px * var(--tps-gcm-density) * var(--tps-gcm-button-scale));
      }

      .tps-gcm-subitem-strip .tps-gcm-chip-icon svg {
        width: calc(13px * var(--tps-gcm-button-scale) * 0.75);
        height: calc(13px * var(--tps-gcm-button-scale) * 0.75);
      }

      .tps-gcm-subitem-strip .tps-gcm-chip-label {
        font-size: calc(12px * var(--tps-gcm-text-scale) * 0.75);
      }

      .tps-gcm-subitem-content {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: calc(4px * var(--tps-gcm-density));
        min-width: 0;
        flex: 1 1 auto;
      }

      .tps-gcm-subitem-header {
        display: flex;
        align-items: flex-start;
        gap: calc(8px * var(--tps-gcm-density));
        min-width: 0;
        width: 100%;
      }

      .tps-gcm-subitem-icon {
        width: 18px;
        height: 18px;
        min-width: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
        font-size: calc(12px * var(--tps-gcm-text-scale));
        line-height: 1;
      }

      .tps-gcm-subitem-icon svg {
        width: 16px;
        height: 16px;
      }

      .tps-gcm-subitem-icon--emoji {
        font-size: calc(9px * var(--tps-gcm-text-scale));
      }

      .tps-gcm-subitem-text {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 2px;
        min-width: 0;
        flex: 1 1 auto;
      }

      .tps-gcm-subitem-title-line {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        width: 100%;
      }

      .tps-gcm-subitem-title {
        all: unset;
        display: inline-flex !important;
        align-items: center;
        gap: 4px;
        padding: 0 !important;
        margin: 0 !important;
        border: none !important;
        background: transparent !important;
        box-shadow: none !important;
        appearance: none;
        -webkit-appearance: none;
        color: var(--text-normal);
        font-size: calc(12px * var(--tps-gcm-text-scale));
        font-weight: 600;
        line-height: 1.2;
        cursor: pointer;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
        max-width: none;
        flex: 1 1 auto;
      }

      .tps-gcm-subitem-title:hover {
        color: var(--interactive-accent);
      }

      .tps-gcm-subitem-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        width: 100%;
        flex-wrap: nowrap;
        overflow: hidden;
      }

      .tps-gcm-subitem-relation {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 1px 6px;
        font-size: calc(9px * var(--tps-gcm-text-scale));
        font-weight: 600;
        line-height: 1.2;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .tps-gcm-subitem-relation--child {
        color: var(--text-accent);
        background: color-mix(in srgb, var(--interactive-accent) 18%, transparent);
      }

      .tps-gcm-subitem-relation--attachment {
        color: #76b7ff;
        background: rgba(75, 137, 212, 0.18);
      }

      .tps-gcm-subitem-path {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: calc(10px * var(--tps-gcm-text-scale));
        color: var(--text-faint);
        max-width: 28ch;
      }

      .tps-gcm-subitem-pills,
      .tps-gcm-subitem-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: nowrap;
        flex: 0 0 auto;
        white-space: nowrap;
      }

      .tps-gcm-subitem-pill,
      .tps-gcm-subitem-action {
        border: 1px solid var(--background-modifier-border);
        border-radius: 999px;
        background: var(--background-modifier-form-field);
        color: var(--text-normal);
        font-size: calc(10px * var(--tps-gcm-text-scale));
        line-height: 1.25;
        font-weight: 600;
        padding: 3px 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }

      .tps-gcm-subitem-pill:hover,
      .tps-gcm-subitem-action:hover {
        border-color: var(--interactive-accent);
        background: color-mix(in srgb, var(--background-modifier-hover), var(--background-primary));
        opacity: 1 !important;
      }

      .tps-gcm-subitem-action:disabled {
        opacity: 0.55;
        cursor: wait;
      }

      .tps-gcm-subitem-pill--status {
        color: var(--text-accent);
      }

      .tps-gcm-subitem-pill--priority {
        color: var(--color-yellow);
      }

      .tps-gcm-subitem-pill--scheduled {
        color: var(--color-blue);
      }

      .tps-gcm-subitem-children {
        display: flex;
        flex-direction: column;
        gap: calc(6px * var(--tps-gcm-density));
        margin-top: 2px;
      }

      .tps-gcm-checklist-subitems {
        display: flex;
        flex-direction: column;
        gap: calc(6px * var(--tps-gcm-density));
        margin-top: calc(8px * var(--tps-gcm-density));
        padding-top: calc(8px * var(--tps-gcm-density));
        border-top: 1px dashed var(--background-modifier-border);
      }

      .tps-gcm-checklist-subitems-title {
        font-size: calc(10px * var(--tps-gcm-text-scale));
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-faint);
      }

      .tps-gcm-checklist-subitems-list {
        display: flex;
        flex-direction: column;
        gap: calc(6px * var(--tps-gcm-density));
      }

      .tps-gcm-subitems-panel--title-inline .tps-gcm-subitems-body--children {
        gap: calc(3px * var(--tps-gcm-density));
      }

      .tps-gcm-subitems-panel--title-inline .tps-gcm-subitem-row {
        margin-inline-start: 0;
        padding: calc(3px * var(--tps-gcm-density)) 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
      }

      .tps-gcm-subitems-panel--title-inline .tps-gcm-subitem-children {
        margin-top: calc(3px * var(--tps-gcm-density));
        gap: calc(3px * var(--tps-gcm-density));
      }

      .tps-gcm-subitems-panel--title-inline .tps-gcm-checklist-subitems {
        margin-top: calc(3px * var(--tps-gcm-density));
        padding-top: 0;
        border-top: 0;
        gap: calc(3px * var(--tps-gcm-density));
      }

      .tps-gcm-subitems-panel--title-inline .tps-gcm-checklist-subitems-title {
        display: none;
      }

      .tps-gcm-subitems-panel--title-inline .tps-gcm-checklist-subitems-list {
        gap: calc(3px * var(--tps-gcm-density));
      }

      .tps-gcm-reference-direction {
        display: flex;
        flex-direction: column;
        gap: calc(6px * var(--tps-gcm-density));
      }

      .tps-gcm-reference-direction + .tps-gcm-reference-direction {
        margin-top: calc(10px * var(--tps-gcm-density));
        padding-top: calc(10px * var(--tps-gcm-density));
        border-top: 1px dashed var(--background-modifier-border);
      }

      .tps-gcm-reference-direction-title {
        font-size: calc(10px * var(--tps-gcm-text-scale));
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-faint);
      }

      .tps-gcm-reference-group {
        display: flex;
        flex-direction: column;
        gap: calc(6px * var(--tps-gcm-density));
        padding: calc(6px * var(--tps-gcm-density));
        border-radius: calc(8px * var(--tps-gcm-radius-scale));
        background: color-mix(in srgb, var(--background-primary) 82%, transparent);
        border: 1px solid color-mix(in srgb, var(--background-modifier-border) 68%, transparent);
      }

      .tps-gcm-reference-group-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
      }

      .tps-gcm-reference-group-title {
        appearance: none;
        -webkit-appearance: none;
        border: 0;
        background: transparent;
        color: var(--text-normal);
        font-size: calc(12px * var(--tps-gcm-text-scale));
        font-weight: 700;
        line-height: 1.2;
        cursor: pointer;
        padding: 0;
        margin: 0;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: left;
        flex: 1 1 auto;
      }

      .tps-gcm-reference-group-title:hover {
        color: var(--interactive-accent);
      }

      .tps-gcm-reference-link-target {
        color: var(--text-accent);
        text-decoration: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: 2px;
      }

      .tps-gcm-reference-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: 999px;
        font-size: calc(10px * var(--tps-gcm-text-scale));
        font-weight: 700;
        color: var(--text-accent);
        background: color-mix(in srgb, var(--interactive-accent) 18%, transparent);
      }

      .tps-gcm-reference-occurrences {
        display: flex;
        flex-direction: column;
        gap: calc(6px * var(--tps-gcm-density));
      }

      .tps-gcm-reference-occurrence {
        display: flex;
        flex-direction: column;
        gap: calc(5px * var(--tps-gcm-density));
        padding: calc(6px * var(--tps-gcm-density));
        border-radius: calc(7px * var(--tps-gcm-radius-scale));
        background: color-mix(in srgb, var(--background-secondary) 70%, transparent);
        content-visibility: auto;
        contain-intrinsic-size: 72px;
      }

      .tps-gcm-reference-occurrence-meta {
        font-size: calc(10px * var(--tps-gcm-text-scale));
        color: var(--text-faint);
        line-height: 1.3;
      }

      .tps-gcm-reference-preview {
        font-size: calc(11px * var(--tps-gcm-text-scale));
        color: var(--text-normal);
        line-height: 1.45;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .tps-gcm-reference-preview-link {
        appearance: none;
        -webkit-appearance: none;
        border: 0;
        background: transparent;
        color: var(--text-accent);
        cursor: pointer;
        font: inherit;
        line-height: inherit;
        padding: 0 1px;
        margin: 0;
        text-decoration: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: 2px;
      }

      .tps-gcm-reference-preview-link:hover {
        color: var(--interactive-accent);
      }

      .tps-gcm-reference-match {
        border-radius: 4px;
        padding: 0 2px;
        color: var(--text-normal);
        background: color-mix(in srgb, var(--text-highlight-bg) 82%, var(--interactive-accent) 18%);
      }

      .tps-gcm-reference-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      .tps-gcm-note-graph-host {
        position: relative;
      }

      .tps-gcm-note-graph {
        --tps-gcm-note-graph-space: clamp(230px, 24%, 284px);
        position: absolute;
        top: 12px;
        right: 12px;
        width: calc(var(--tps-gcm-note-graph-space) - 24px);
        margin: 0;
        padding: 10px 12px 9px;
        background:
          radial-gradient(circle at 78% 16%, color-mix(in srgb, var(--interactive-accent) 10%, transparent), transparent 58%),
          linear-gradient(170deg, color-mix(in srgb, var(--background-secondary) 88%, transparent), color-mix(in srgb, var(--background-primary) 78%, transparent));
        border: 1px solid color-mix(in srgb, var(--background-modifier-border) 72%, transparent);
        border-radius: 14px;
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.14);
        pointer-events: auto;
        z-index: 3;
      }

      .tps-gcm-note-graph-header {
        font-size: calc(10px * var(--tps-gcm-text-scale));
        font-weight: 650;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--text-faint);
        margin: 0 0 4px;
        text-align: left;
      }

      .tps-gcm-note-graph-body {
        width: 100%;
      }

      .tps-gcm-note-graph-empty {
        font-size: calc(11px * var(--tps-gcm-text-scale));
        color: var(--text-muted);
        padding: 10px 2px 4px;
      }

      .tps-gcm-note-graph-svg {
        display: block;
        width: 100%;
        height: auto;
        overflow: visible;
      }

      .tps-gcm-note-graph-root-halo {
        fill: color-mix(in srgb, var(--interactive-accent) 8%, transparent);
        stroke: color-mix(in srgb, var(--interactive-accent) 18%, transparent);
        stroke-width: 1;
      }

      .tps-gcm-note-graph-edge {
        fill: none;
        stroke-width: 1.4;
        stroke-linecap: round;
        opacity: 0.26;
      }

      .tps-gcm-note-graph-root-node {
        fill: var(--interactive-accent);
        opacity: 0.86;
        filter: drop-shadow(0 0 8px color-mix(in srgb, var(--interactive-accent) 28%, transparent));
      }

      .tps-gcm-note-graph-node {
        cursor: pointer;
        transition: transform 0.14s ease, opacity 0.14s ease, filter 0.14s ease;
      }

      .tps-gcm-note-graph-node:hover {
        opacity: 0.92;
        filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.12));
      }

      .tps-gcm-note-graph-root-label {
        fill: var(--text-normal);
        font-size: 11px;
        font-weight: 700;
        paint-order: stroke;
        stroke: color-mix(in srgb, var(--background-primary) 92%, transparent);
        stroke-width: 4px;
        stroke-linejoin: round;
      }

      .tps-gcm-note-graph-meta {
        fill: var(--text-faint);
        font-size: 8px;
        font-weight: 550;
      }

      .tps-gcm-note-references {
        display: flex;
        flex-direction: column;
        gap: 14px;
        max-width: var(--file-line-width, 700px);
        margin: 20px auto 40px;
        padding: 16px 18px 18px;
        border: 1px solid color-mix(in srgb, var(--background-modifier-border) 70%, transparent);
        border-radius: 18px;
        background: color-mix(in srgb, var(--background-secondary) 74%, transparent);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
      }

      .tps-gcm-note-references--top-popover {
        max-width: none;
        margin: 0;
        padding: 10px;
        border: none;
        border-radius: 10px;
        background: transparent;
        box-shadow: none;
      }

      .tps-gcm-note-references-header {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 12px;
      }

      .tps-gcm-note-references-title-wrap {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .tps-gcm-note-references-title {
        margin: 0;
        color: var(--text-normal);
        font-size: calc(15px * var(--tps-gcm-text-scale));
        font-weight: 700;
        line-height: 1.2;
      }

      .tps-gcm-note-references-subtitle {
        color: var(--text-muted);
        font-size: calc(11px * var(--tps-gcm-text-scale));
        line-height: 1.35;
      }

      .tps-gcm-note-references-body {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .tps-gcm-note-references .tps-gcm-reference-group {
        background: color-mix(in srgb, var(--background-primary) 55%, transparent);
      }

      .tps-gcm-note-references .tps-gcm-reference-direction {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .tps-gcm-note-references .tps-gcm-reference-simple-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .tps-gcm-top-calendar-popover {
        max-height: min(420px, calc(100vh - 120px));
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        overscroll-behavior: contain;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: var(--background-primary);
        box-shadow: 0 18px 38px rgba(0, 0, 0, 0.38);
        padding: 10px;
      }

      .tps-gcm-top-calendar-popover .tps-gcm-note-references {
        gap: 10px;
        display: flex;
        flex-direction: column;
        min-height: 0;
        max-height: inherit;
      }

      .tps-gcm-top-calendar-popover .tps-gcm-note-references-header {
        align-items: flex-start;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--background-modifier-border);
      }

      .tps-gcm-calendar-open-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 30px;
        padding: 4px 10px;
        border-radius: 8px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-modifier-form-field);
        color: var(--text-normal);
        font-size: calc(12px * var(--tps-gcm-text-scale));
        font-weight: 650;
        cursor: pointer;
        white-space: nowrap;
      }

      .tps-gcm-calendar-open-button:hover,
      .tps-gcm-calendar-open-button:focus-visible {
        border-color: var(--interactive-accent);
        background: color-mix(in srgb, var(--background-modifier-hover), var(--background-primary));
        outline: none;
      }

      .tps-gcm-calendar-open-button svg {
        width: 14px;
        height: 14px;
      }

      .tps-gcm-top-calendar-popover .tps-gcm-note-references-title {
        font-size: calc(16px * var(--tps-gcm-text-scale));
      }

      .tps-gcm-top-calendar-popover .tps-gcm-note-references-body {
        max-height: min(330px, var(--tps-gcm-calendar-popover-body-max-height, calc(100vh - 220px)));
        overflow-y: auto;
        overscroll-behavior: contain;
        min-height: 0;
        padding-right: 2px;
      }

      .tps-gcm-top-calendar-popover .tps-gcm-reference-simple-list {
        display: flex;
        flex-direction: column;
        flex-wrap: nowrap;
        gap: 6px;
      }

      .tps-gcm-calendar-item {
        --tps-gcm-calendar-item-color: var(--text-accent);
        width: 100%;
        display: grid;
        grid-template-columns: 18px 64px minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        min-height: 32px;
        padding: 5px 7px;
        border: 1px solid var(--background-modifier-border);
        border-left: 3px solid var(--tps-gcm-calendar-item-color);
        border-radius: 6px;
        background: var(--background-secondary);
        color: var(--text-normal);
        text-align: left;
      }

      button.tps-gcm-calendar-item {
        cursor: pointer;
      }

      button.tps-gcm-calendar-item:hover {
        background: var(--background-modifier-hover);
        border-color: var(--background-modifier-border-hover);
        border-left-color: var(--tps-gcm-calendar-item-color);
      }

      .tps-gcm-calendar-item.is-selected {
        background: color-mix(in srgb, var(--tps-gcm-calendar-item-color) 18%, var(--background-secondary));
        border-color: var(--tps-gcm-calendar-item-color);
        border-left-color: var(--tps-gcm-calendar-item-color);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tps-gcm-calendar-item-color) 45%, transparent);
      }

      .tps-gcm-calendar-item.is-current-note {
        --tps-gcm-calendar-item-color: var(--interactive-accent);
        background: color-mix(in srgb, var(--interactive-accent) 16%, var(--background-secondary));
        border-color: color-mix(in srgb, var(--interactive-accent) 58%, var(--background-modifier-border));
        border-left-color: var(--interactive-accent);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--interactive-accent) 38%, transparent);
      }

      button.tps-gcm-calendar-item.is-current-note:hover {
        background: color-mix(in srgb, var(--interactive-accent) 22%, var(--background-modifier-hover));
        border-color: var(--interactive-accent);
      }

      .tps-gcm-calendar-item-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        color: var(--tps-gcm-calendar-item-color);
        line-height: 1;
        font-size: calc(14px * var(--tps-gcm-text-scale));
      }

      .tps-gcm-calendar-item-icon svg {
        width: 14px;
        height: 14px;
        stroke-width: 2.25px;
      }

      .tps-gcm-calendar-item-time {
        color: var(--text-muted);
        font-size: calc(11px * var(--tps-gcm-text-scale));
        font-weight: 700;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      .tps-gcm-calendar-item .tps-gcm-reference-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
      }

      .tps-gcm-calendar-item.is-external-event,
      .tps-gcm-calendar-item.is-external-event .tps-gcm-reference-title,
      .tps-gcm-calendar-item.is-external-event .tps-gcm-reference-context,
      .tps-gcm-calendar-item.is-external-event .tps-gcm-calendar-item-time {
        text-decoration: none;
      }

      .tps-gcm-calendar-item.is-external-event .tps-gcm-reference-title {
        color: var(--text-normal);
      }

      .tps-gcm-calendar-item .tps-gcm-reference-context {
        color: var(--text-muted);
        font-size: calc(10px * var(--tps-gcm-text-scale));
        white-space: nowrap;
      }

      @media (max-width: 700px), (pointer: coarse) {
        .tps-gcm-top-calendar-popover {
          width: min(360px, calc(100vw - 24px)) !important;
          padding: 8px;
          border-radius: 10px;
        }

        .tps-gcm-top-calendar-popover .tps-gcm-note-references {
          gap: 8px;
        }

        .tps-gcm-top-calendar-popover .tps-gcm-note-references-header {
          align-items: center;
          padding-bottom: 8px;
          gap: 10px;
        }

        .tps-gcm-calendar-open-button {
          min-height: 36px;
          padding: 6px 10px;
          border-radius: 9px;
          font-size: calc(12px * var(--tps-gcm-text-scale));
          flex-shrink: 0;
        }

        .tps-gcm-top-calendar-popover .tps-gcm-note-references-body {
          padding-right: 0;
        }

        .tps-gcm-top-calendar-popover .tps-gcm-reference-simple-list {
          gap: 7px;
        }

        .tps-gcm-calendar-item {
          grid-template-columns: 18px 62px minmax(0, 1fr);
          grid-template-areas:
            "icon time title"
            "icon kind kind";
          gap: 3px 8px;
          min-height: 46px;
          padding: 7px 8px;
          border-radius: 8px;
        }

        .tps-gcm-calendar-item-icon {
          grid-area: icon;
          align-self: center;
        }

        .tps-gcm-calendar-item-time {
          grid-area: time;
          align-self: center;
          font-size: calc(11px * var(--tps-gcm-text-scale));
        }

        .tps-gcm-calendar-item .tps-gcm-reference-title {
          grid-area: title;
          align-self: center;
          font-size: calc(12px * var(--tps-gcm-text-scale));
          line-height: 1.2;
        }

        .tps-gcm-calendar-item .tps-gcm-reference-context {
          grid-area: kind;
          justify-self: start;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: calc(10px * var(--tps-gcm-text-scale));
          line-height: 1.2;
          opacity: 0.9;
        }
      }

      .tps-gcm-calendar-selection-actions {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid var(--background-modifier-border);
      }

      .tps-gcm-calendar-selection-actions[hidden] {
        display: none !important;
      }

      .tps-gcm-calendar-selection-actions .tps-gcm-panel {
        width: 100%;
        max-width: 100%;
      }

      .tps-gcm-calendar-detail-card {
        --tps-gcm-calendar-item-color: var(--text-accent);
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr);
        gap: 10px;
        padding: 10px;
        border: 1px solid color-mix(in srgb, var(--tps-gcm-calendar-item-color) 42%, var(--background-modifier-border));
        border-left: 3px solid var(--tps-gcm-calendar-item-color);
        border-radius: 8px;
        background: color-mix(in srgb, var(--tps-gcm-calendar-item-color) 8%, var(--background-secondary));
      }

      .tps-gcm-calendar-detail-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        color: var(--tps-gcm-calendar-item-color);
      }

      .tps-gcm-calendar-detail-icon svg {
        width: 18px;
        height: 18px;
        stroke-width: 2.3px;
      }

      .tps-gcm-calendar-detail-content {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }

      .tps-gcm-calendar-detail-title {
        color: var(--text-normal);
        font-size: calc(13px * var(--tps-gcm-text-scale));
        font-weight: 700;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }

      .tps-gcm-calendar-detail-meta,
      .tps-gcm-calendar-detail-path {
        color: var(--text-muted);
        font-size: calc(11px * var(--tps-gcm-text-scale));
        line-height: 1.25;
      }

      .tps-gcm-calendar-detail-path {
        overflow-wrap: anywhere;
      }

      .tps-gcm-calendar-detail-field {
        color: var(--text-muted);
        font-size: calc(11px * var(--tps-gcm-text-scale));
        line-height: 1.3;
        overflow-wrap: anywhere;
      }

      .tps-gcm-calendar-detail-field-label {
        color: var(--text-normal);
        font-weight: 700;
      }

      .tps-gcm-calendar-detail-field a {
        color: var(--text-accent);
        text-decoration: underline;
      }

      .tps-gcm-calendar-detail-actions {
        display: flex;
        justify-content: flex-start;
        margin-top: 3px;
      }

      .tps-gcm-calendar-detail-open-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 30px;
        padding: 4px 9px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 7px;
        background: var(--background-modifier-form-field);
        color: var(--text-normal);
        font-size: calc(11px * var(--tps-gcm-text-scale));
        font-weight: 650;
        cursor: pointer;
      }

      .tps-gcm-calendar-detail-open-button:hover,
      .tps-gcm-calendar-detail-open-button:focus-visible {
        border-color: var(--interactive-accent);
        background: var(--background-modifier-hover);
        outline: none;
      }

      .tps-gcm-calendar-detail-open-button svg {
        width: 14px;
        height: 14px;
      }

      .tps-gcm-note-references .tps-gcm-reference-frontmatter-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .tps-gcm-note-references .tps-gcm-reference-frontmatter-title {
        font-size: calc(10px * var(--tps-gcm-text-scale));
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--text-faint);
      }

      .tps-gcm-note-references .tps-gcm-reference-frontmatter-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .tps-gcm-note-references .tps-gcm-reference-frontmatter-chip {
        border: 1px solid var(--background-modifier-border);
        border-radius: 999px;
        background: color-mix(in srgb, var(--background-modifier-form-field) 85%, transparent);
        color: var(--text-muted);
        font-size: calc(11px * var(--tps-gcm-text-scale));
        line-height: 1.25;
        font-weight: 600;
        padding: 5px 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }

      .tps-gcm-note-references .tps-gcm-reference-frontmatter-chip:hover {
        border-color: var(--interactive-accent);
        color: var(--text-accent);
      }

      .tps-gcm-note-footer-host {
        display: block;
        width: 100%;
      }

      /* Removed fragile Editor Footer flex column hacks that broke cm-scroller native wrapping */

      /* Source mode footer host: mounted under CM content/sizer containers. */
      .cm-content > .tps-gcm-note-footer-host,
      .cm-sizer > .tps-gcm-note-footer-host,
      .cm-contentContainer > .tps-gcm-note-footer-host,
      .cm-scroller > .tps-gcm-note-footer-host {
        display: block;
        width: 100%;
        margin-top: 0;
        padding: 0 0 56px;
        box-sizing: border-box;
      }

      /* Reading mode footer host (inside markdown-preview-sizer) */
      .markdown-preview-sizer > .tps-gcm-note-footer-host {
        display: block;
        width: 100%;
        margin-top: 50px;
      }

      .cm-sizer .tps-gcm-note-references,
      .cm-contentContainer .tps-gcm-note-references,
      .cm-scroller .tps-gcm-note-references,
      .cm-editor .tps-gcm-note-references {
        display: flex !important;
      }


      @media (max-width: 900px) {
        .tps-gcm-note-graph {
          position: relative;
          top: auto;
          right: auto;
          width: 100%;
          min-width: 0;
          max-width: 280px;
          margin: 0 0 14px auto;
        }

        .tps-gcm-note-references {
          margin-top: 20px;
        }
      }

      .tps-gcm-subitem-row--checklist {
        margin-inline-start: 0;
        content-visibility: auto;
        contain-intrinsic-size: 54px;
        align-items: flex-start;
        overflow: hidden;
      }

      .tps-gcm-checklist-toggle {
        flex: 0 0 auto;
        margin: 0;
        width: 16px;
        height: 16px;
        cursor: pointer;
      }

      .tps-gcm-checklist-toggle:disabled {
        cursor: wait;
        opacity: 0.6;
      }

      .tps-gcm-subitem-title--checklist {
        cursor: pointer;
        max-width: none;
        flex: 1 1 auto;
      }

      .tps-gcm-subitem-row--checklist .tps-gcm-subitem-meta {
        align-items: center;
        gap: 8px;
      }

      .tps-gcm-subitem-row--checklist .tps-gcm-subitem-actions {
        margin-inline-start: auto;
      }

      .tps-gcm-subitem-title--checklist:hover {
        color: var(--interactive-accent);
      }

      @keyframes tps-gcm-line-flash {
        0%   { background: color-mix(in srgb, var(--interactive-accent) 35%, transparent); }
        100% { background: transparent; }
      }

      /* Live preview / source mode */
      .cm-line.tps-gcm-line-highlight {
        animation: tps-gcm-line-flash 1.4s ease-out forwards;
        border-radius: 3px;
      }

      /* Reading mode */
      li.tps-gcm-line-highlight,
      .task-list-item.tps-gcm-line-highlight {
        animation: tps-gcm-line-flash 1.4s ease-out forwards;
        border-radius: 3px;
      }

      .cm-line.tps-gcm-task-line-active,
      li.tps-gcm-task-line-active,
      .task-list-item.tps-gcm-task-line-active,
      .tps-calendar-task-entry.tps-gcm-task-line-active,
      .tps-kanban-card-task.tps-gcm-task-line-active,
      .tps-kanban-task-card.tps-gcm-task-line-active,
      [data-tps-gcm-context="calendar-task"].tps-gcm-task-line-active,
      [data-tps-gcm-context="kanban-task"].tps-gcm-task-line-active,
      [data-tps-gcm-context="table-task"].tps-gcm-task-line-active {
        background: color-mix(in srgb, var(--interactive-accent) 16%, transparent) !important;
        box-shadow: inset 3px 0 0 var(--interactive-accent);
        border-radius: 4px;
      }

      .cm-line.tps-gcm-task-line-selected,
      li.tps-gcm-task-line-selected,
      .task-list-item.tps-gcm-task-line-selected,
      .tps-calendar-task-entry.tps-gcm-task-line-selected,
      .tps-kanban-card-task.tps-gcm-task-line-selected,
      .tps-kanban-task-card.tps-gcm-task-line-selected,
      [data-tps-gcm-context="calendar-task"].tps-gcm-task-line-selected,
      [data-tps-gcm-context="kanban-task"].tps-gcm-task-line-selected,
      [data-tps-gcm-context="table-task"].tps-gcm-task-line-selected {
        background: color-mix(in srgb, var(--interactive-accent) 10%, transparent) !important;
        outline: 1px solid color-mix(in srgb, var(--interactive-accent) 56%, transparent);
        outline-offset: 1px;
        border-radius: 4px;
      }

      .cm-line.tps-gcm-task-line-active.tps-gcm-task-line-selected,
      li.tps-gcm-task-line-active.tps-gcm-task-line-selected,
      .task-list-item.tps-gcm-task-line-active.tps-gcm-task-line-selected,
      .tps-calendar-task-entry.tps-gcm-task-line-active.tps-gcm-task-line-selected,
      .tps-kanban-card-task.tps-gcm-task-line-active.tps-gcm-task-line-selected,
      .tps-kanban-task-card.tps-gcm-task-line-active.tps-gcm-task-line-selected,
      [data-tps-gcm-context="calendar-task"].tps-gcm-task-line-active.tps-gcm-task-line-selected,
      [data-tps-gcm-context="kanban-task"].tps-gcm-task-line-active.tps-gcm-task-line-selected,
      [data-tps-gcm-context="table-task"].tps-gcm-task-line-active.tps-gcm-task-line-selected {
        background: color-mix(in srgb, var(--interactive-accent) 22%, transparent) !important;
        outline-color: var(--interactive-accent);
      }

      .tps-gcm-subitem-create-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 12px;
      }

      .tps-gcm-subitem-folder-picker {
        margin-top: 6px;
      }

      .tps-gcm-native-item:hover:not(:disabled),
      .tps-gcm-native-item:focus:not(:disabled) {
        background-color: color-mix(in srgb, var(--background-modifier-hover), var(--background-primary));
        border-color: var(--interactive-accent);
        outline: none;
        opacity: 1 !important;
      }
      .tps-gcm-native-item:disabled,
      .tps-gcm-native-item.is-disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .tps-gcm-item-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }
      .tps-gcm-item-icon svg {
        width: 16px;
        height: 16px;
      }
      .tps-gcm-separator {
        height: 1px;
        background: var(--background-modifier-border);
        margin: 4px 8px;
      }
      
      /* Collapsed state styles */
      .tps-global-context-menu--collapsed .tps-gcm-panel {
        display: none;
      }
      
      .tps-global-context-menu--persistent .tps-global-context-header {
        cursor: pointer;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        user-select: none;
        gap: calc(8px * var(--tps-gcm-density));
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
      }
      
      .tps-global-context-menu--persistent .tps-global-context-header:hover {
        color: var(--text-normal);
      }

      .tps-gcm-header-left {
        display: flex;
        align-items: center;
        gap: calc(4px * var(--tps-gcm-density));
        flex-shrink: 0;
      }

      .tps-gcm-header-right {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: calc(6px * var(--tps-gcm-density));
        flex-wrap: nowrap;
        flex: 1;
        overflow: hidden;
        min-width: 0;
        padding-left: calc(2px * var(--tps-gcm-density));
      }
      
      .tps-gcm-header-right::-webkit-scrollbar {
        display: none;
      }

      .tps-gcm-header-title {
        font-weight: 600;
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 160px;
      }

      .tps-gcm-collapse-button {
        min-width: calc(26px * var(--tps-gcm-button-scale));
        min-height: calc(26px * var(--tps-gcm-button-scale));
        width: calc(26px * var(--tps-gcm-button-scale));
        height: calc(26px * var(--tps-gcm-button-scale));
        border-radius: calc(6px * var(--tps-gcm-control-scale) * var(--tps-gcm-radius-scale));
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
        padding: 0;
        flex-shrink: 0;
        position: relative;
        z-index: 10;
        transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        image-rendering: -webkit-optimize-contrast;
        -webkit-font-smoothing: antialiased;
      }

      .tps-gcm-collapse-button:hover {
        background: var(--background-modifier-hover);
        color: var(--text-normal);
        border-color: var(--interactive-accent);
      }

      .tps-gcm-collapse-button:active {
        background: var(--background-modifier-active-hover);
      }

      .tps-gcm-collapse-button::before {
        content: '';
        width: calc(10px * var(--tps-gcm-button-scale));
        height: calc(10px * var(--tps-gcm-button-scale));
        border-left: 2px solid currentColor;
        border-bottom: 2px solid currentColor;
        transform: rotate(-45deg);
        transition: transform 0.2s ease;
        image-rendering: crisp-edges;
      }

      .tps-gcm-collapse-button[aria-expanded='true']::before {
        transform: rotate(135deg);
      }

      /* Live preview: flip arrow direction */
      .tps-global-context-menu--live .tps-gcm-collapse-button::before {
        transform: rotate(135deg);
      }
      .tps-global-context-menu--live .tps-gcm-collapse-button[aria-expanded='true']::before {
        transform: rotate(-45deg);
      }

      .tps-gcm-collapse-button:focus-visible {
        outline: 2px solid var(--interactive-accent);
        outline-offset: 2px;
      }

      .tps-global-context-menu--collapsed.tps-global-context-menu--live {
        width: min(var(--tps-inline-bar-width), var(--tps-gcm-pane-width, var(--tps-inline-bar-width)));
        display: block;
        min-width: 0;
        border-top-left-radius: calc(8px * var(--tps-gcm-radius-scale));
        border-top-right-radius: calc(8px * var(--tps-gcm-radius-scale));
        background-color: var(--tps-inline-bar-bg);
        border: 1px solid var(--background-modifier-border);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        padding: calc(4px * var(--tps-gcm-density)) calc(8px * var(--tps-gcm-density));
      }

      .tps-global-context-menu--collapsed.tps-global-context-menu--live .tps-global-context-header {
        justify-content: flex-start;
        padding: 0;
        gap: 8px;
      }
      
      .tps-gcm-nav-group {
        display: flex;
        align-items: center;
        gap: 2px;
      }

      .tps-gcm-nav-button {
        min-width: calc(24px * var(--tps-gcm-button-scale));
        min-height: calc(24px * var(--tps-gcm-button-scale));
        width: calc(24px * var(--tps-gcm-button-scale));
        height: calc(24px * var(--tps-gcm-button-scale));
        border-radius: calc(4px * var(--tps-gcm-control-scale));
        border: none;
        background: transparent;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
        padding: 0;
        flex-shrink: 0;
        transition: color 0.15s ease, background-color 0.15s ease;
      }

      .tps-gcm-nav-button:hover {
        color: var(--text-normal);
        background: var(--background-modifier-hover);
      }
      
      .tps-gcm-nav-button svg {
        width: calc(14px * var(--tps-gcm-button-scale));
        height: calc(14px * var(--tps-gcm-button-scale));
      }

      /* Hide navigation buttons on very small screens or when constrained */
      @media (max-width: 400px) {
        .tps-gcm-nav-group {
          display: none;
        }
      }

      .tps-global-context-menu--collapsed.tps-global-context-menu--live .tps-gcm-header-right {
        margin-right: 0;
        flex: 0 0 auto;
      }
      
      /* Hide title text when collapsed, but keep the collapse button */
      .tps-global-context-menu--collapsed .tps-gcm-file-title {
        display: none;
      }

      /* Fix overlap: Ensure left section (button only) takes natural width in collapsed mode */
      .tps-global-context-menu--collapsed .tps-gcm-header-left {
        flex: 0 0 auto !important;
      }

      .tps-global-context-menu--collapsed .tps-gcm-collapse-button {
        min-width: calc(24px * var(--tps-gcm-button-scale));
        min-height: calc(24px * var(--tps-gcm-button-scale));
        width: calc(24px * var(--tps-gcm-button-scale));
        height: calc(24px * var(--tps-gcm-button-scale));
      }

      .tps-global-context-menu--collapsed .tps-gcm-nav-button {
        min-width: calc(32px * var(--tps-gcm-button-scale));
        min-height: calc(32px * var(--tps-gcm-button-scale));
        width: calc(32px * var(--tps-gcm-button-scale));
        height: calc(32px * var(--tps-gcm-button-scale));
      }

      .modal.mod-tps-gcm {
        width: min(var(--tps-gcm-modal-width), calc(100vw - 32px));
        max-height: var(--tps-gcm-modal-max-height);
      }

      .modal.mod-tps-gcm .modal-content {
        max-height: calc(var(--tps-gcm-modal-max-height) - 24px);
        overflow-y: auto;
        padding: calc(16px * var(--tps-gcm-density));
      }

      .modal.mod-tps-gcm h2 {
        font-size: calc(16px * var(--tps-gcm-text-scale));
        font-weight: 700;
        color: var(--text-normal);
        margin-bottom: calc(12px * var(--tps-gcm-density));
      }

      .modal.mod-tps-gcm .setting-item {
        border: none;
        padding: calc(12px * var(--tps-gcm-density)) 0;
      }

      .modal.mod-tps-gcm .setting-item-name {
        font-size: calc(13px * var(--tps-gcm-text-scale));
        font-weight: 600;
        color: var(--text-normal);
      }

      .modal.mod-tps-gcm .setting-item-description {
        font-size: calc(12px * var(--tps-gcm-text-scale));
        color: var(--text-muted);
      }

      .modal.mod-tps-gcm button {
        font-size: calc(13px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        font-weight: 600;
        padding: calc(8px * var(--tps-gcm-control-scale)) calc(16px * var(--tps-gcm-control-scale));
        color: var(--text-normal);
      }

      .modal.mod-tps-gcm button.mod-cta {
        color: var(--text-on-accent);
        font-weight: 700;
      }

      .modal.mod-tps-gcm input,
      .modal.mod-tps-gcm select,
      .modal.mod-tps-gcm textarea {
        font-size: calc(13px * var(--tps-gcm-text-scale) * var(--tps-gcm-control-scale));
        font-weight: 500;
        color: var(--text-normal);
        padding: calc(8px * var(--tps-gcm-control-scale)) calc(10px * var(--tps-gcm-control-scale));
        background-color: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: calc(6px * var(--tps-gcm-radius-scale));
      }

      .modal.mod-tps-gcm input::placeholder {
        color: var(--text-muted);
      }

      body.is-mobile .modal:is(.mod-tps-gcm, .tps-keyboard-aware-modal),
      body.is-phone .modal:is(.mod-tps-gcm, .tps-keyboard-aware-modal) {
        position: fixed;
        left: calc(var(--tps-visible-viewport-left) + 12px);
        top: calc(var(--tps-visible-viewport-top) + 12px);
        width: calc(var(--tps-visible-viewport-width) - 24px);
        max-width: calc(var(--tps-visible-viewport-width) - 24px);
        max-height: calc(var(--tps-visible-viewport-height) - 24px);
        margin: 0;
        transform: none;
      }

      body.is-mobile .modal:is(.mod-tps-gcm, .tps-keyboard-aware-modal) .modal-content,
      body.is-phone .modal:is(.mod-tps-gcm, .tps-keyboard-aware-modal) .modal-content {
        max-height: calc(var(--tps-visible-viewport-height) - 48px);
        overscroll-behavior: contain;
        scroll-padding-bottom: max(16px, env(safe-area-inset-bottom));
      }

      body.is-mobile .modal:is(.mod-tps-gcm, .tps-keyboard-aware-modal) input,
      body.is-mobile .modal:is(.mod-tps-gcm, .tps-keyboard-aware-modal) textarea,
      body.is-mobile .modal:is(.mod-tps-gcm, .tps-keyboard-aware-modal) select,
      body.is-phone .modal:is(.mod-tps-gcm, .tps-keyboard-aware-modal) input,
      body.is-phone .modal:is(.mod-tps-gcm, .tps-keyboard-aware-modal) textarea,
      body.is-phone .modal:is(.mod-tps-gcm, .tps-keyboard-aware-modal) select {
        font-size: max(16px, calc(13px * var(--tps-gcm-text-scale) * var(--tps-gcm-control-scale)));
      }
      
      /* Recurrence preview section */
      .tps-gcm-recurrence-preview {
        margin-top: 12px;
        padding: 8px;
        background: var(--background-primary);
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
      }
      
      .tps-gcm-recurrence-preview-title {
        font-size: calc(11px * var(--tps-gcm-text-scale));
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-muted);
        margin-bottom: 6px;
      }
      
      .tps-gcm-recurrence-preview-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      
      .tps-gcm-recurrence-preview-item {
        font-size: calc(12px * var(--tps-gcm-text-scale));
        color: var(--text-normal);
        padding: 2px 0;
      }
      

      .tps-gcm-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        vertical-align: middle;
        min-height: calc(24px * var(--tps-gcm-density) * var(--tps-gcm-button-scale));
        height: auto;
        font-size: calc(11px * var(--tps-gcm-text-scale));
        padding: calc(2px * var(--tps-gcm-density)) calc(8px * var(--tps-gcm-density));
        border-radius: calc(4px * var(--tps-gcm-radius-scale));
        background: var(--background-modifier-hover);
        color: var(--text-muted);
        text-transform: uppercase;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        line-height: 1.1;
        white-space: nowrap;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
        letter-spacing: 0.02em;
      }
      
      .tps-gcm-badge:hover {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
      }

      .tps-gcm-badge-tag,
      .tps-gcm-badge-tag-more,
      .tps-gcm-badge-add-tag {
        border-radius: 999px;
      }

      .tps-gcm-badge-tag-more {
        font-size: calc(9px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        padding: calc(1px * var(--tps-gcm-control-scale)) calc(6px * var(--tps-gcm-control-scale));
      }

      /* Collapsed header: make tag pills smaller */
      .tps-global-context-menu--collapsed .tps-gcm-badge-tag,
      .tps-global-context-menu--collapsed .tps-gcm-badge-tag-more,
      .tps-global-context-menu--collapsed .tps-gcm-badge-add-tag {
        font-size: calc(8px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        padding: calc(1px * var(--tps-gcm-density)) calc(4px * var(--tps-gcm-control-scale));
      }

      .tps-global-context-menu--collapsed .tps-gcm-badge-tag-remove {
        font-size: calc(9px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        margin-right: 2px;
      }

      .tps-gcm-badge-tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: calc(9px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        padding: calc(1px * var(--tps-gcm-control-scale)) calc(6px * var(--tps-gcm-control-scale));
      }

      .tps-gcm-badge-tag-text {
        display: inline;
      }

      .tps-gcm-badge-tag-remove {
        border: none !important;
        background: transparent !important;
        box-shadow: none !important;
        outline: none !important;
        color: #ff5a5a !important;
        opacity: 0.7;
        cursor: pointer;
        font-size: calc(10px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        line-height: 1;
        padding: 0;
        margin-right: 3px;
        font-weight: 700;
        appearance: none;
        -webkit-appearance: none;
      }

      .tps-gcm-badge-tag-remove:hover {
        background: transparent !important;
        opacity: 1;
      }

      .tps-gcm-badge-add-tag {
        background: var(--interactive-accent) !important;
        color: var(--text-on-accent) !important;
        border: none !important;
        font-size: calc(9px * var(--tps-gcm-text-scale) * var(--tps-gcm-button-scale));
        font-weight: 700;
        min-width: calc(14px * var(--tps-gcm-button-scale));
        padding: calc(1px * var(--tps-gcm-control-scale)) calc(5px * var(--tps-gcm-control-scale));
        text-align: center;
      }

      .tps-gcm-badge-add-tag:hover {
        background: var(--interactive-accent-hover) !important;
        transform: scale(1.05);
      }

      .tps-gcm-badge-add-tag:active {
        transform: scale(0.95);
      }

      /* Seamless integration for Reading Mode Collapsed State */
      .tps-global-context-menu--reading.tps-global-context-menu--collapsed {
        margin-bottom: 12px;
        min-width: 0;
        width: min(var(--tps-inline-bar-width), var(--tps-gcm-pane-width, var(--tps-inline-bar-width)));
        background-color: rgba(15, 20, 26, 0.18);
      }

      .tps-global-context-menu--reading.tps-global-context-menu--collapsed .tps-global-context-header {
        padding: 0 !important;
        color: var(--text-muted) !important;
        font-size: 0.9em !important;
        justify-content: flex-start !important; /* Align badges to left */
        gap: 8px;
      }

      /* Reset the right container to flow naturally */
      .tps-global-context-menu--reading.tps-global-context-menu--collapsed .tps-gcm-header-right {
        margin-right: 0 !important;
      }

      /* Prevent spreading in Reading Mode */
      .tps-global-context-menu--reading.tps-global-context-menu--collapsed .tps-gcm-header-left {
        flex: 0 0 auto !important;
      }

      /* ===== MOBILE-SPECIFIC COMPACT STYLING ===== */
      /* Keyboard hiding only for non-persistent overlays */
      .is-mobile.tps-context-hidden-for-keyboard .tps-global-context-menu:not(.tps-global-context-menu--persistent),
      .is-phone.tps-context-hidden-for-keyboard .tps-global-context-menu:not(.tps-global-context-menu--persistent) {
        display: none !important;
      }

      /* Subitems Panel Styles */
      .tps-gcm-subitems-panel {
        position: relative !important; /* Force containing block */
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        z-index: 100001;
        overflow: hidden; 
        display: flex;
        flex-direction: column;
        transition: all 0.2s ease;
      }

      .tps-gcm-subitems-panel--collapsed {
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
        height: auto !important;
        min-height: 0 !important;
        overflow: visible !important;
        padding: 0 !important;
        pointer-events: none;
      }

      .tps-gcm-subitems-panel--collapsed > * {
        display: none !important;
      }
      
      .tps-gcm-subitems-panel--collapsed .tps-gcm-collapse-overlay-btn-v2 {
        display: none !important;
      }

      .tps-gcm-subitems-panel--collapsed > .tps-gcm-expand-handle {
        display: flex !important;
        pointer-events: auto;
      }

      .tps-gcm-collapse-overlay-btn-v2 {
        position: absolute !important;
        top: 4px !important;
        left: 50% !important;
        right: auto !important;
        transform: translateX(-50%) !important;
        width: 32px !important;
        height: 20px !important;
        background: var(--background-secondary-alt); 
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px !important; /* Squircle */
        display: flex !important;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        color: var(--text-muted);
        opacity: 0; /* Hidden until hover */
        transition: opacity 0.2s, background-color 0.2s;
        z-index: 99999 !important;
      }

      /* Show handle when hovering panel or the handle itself */
      .tps-gcm-subitems-panel:hover .tps-gcm-collapse-overlay-btn-v2,
      .tps-gcm-collapse-overlay-btn-v2:hover {
        opacity: 1 !important;
      }

      .tps-gcm-collapse-overlay-btn-v2:hover {
        background-color: var(--background-modifier-hover);
        color: var(--text-normal);
      }

      .tps-gcm-expand-handle {
        display: none; /* Hidden when not collapsed */
        justify-content: center;
        align-items: center;
        gap: 6px;
        min-width: 32px;
        height: 22px;
        padding: 0 8px;
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px; /* Squircle matching collapse */
        margin: 0 auto;
        cursor: pointer;
        color: var(--text-muted);
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        z-index: 100002;
      }
      .tps-gcm-expand-handle:hover {
        color: var(--text-normal);
        background: var(--background-modifier-hover);
      }

      .tps-gcm-subitems-panel--has-note-subitems.tps-gcm-subitems-panel--collapsed > .tps-gcm-expand-handle {
        color: var(--text-accent);
        border-color: color-mix(in srgb, var(--interactive-accent) 70%, var(--background-modifier-border));
        background: color-mix(in srgb, var(--interactive-accent) 18%, var(--background-secondary));
      }

      .tps-gcm-expand-count {
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
        color: var(--text-muted);
      }

      .tps-gcm-expand-handle:hover .tps-gcm-expand-count {
        color: var(--text-normal);
      }

      .tps-gcm-subitems-panel--live {
        position: fixed !important; 
        /* Left/Bottom set by JS */
      }

      .tps-gcm-subitems-panel--hidden {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      /* Parent Navigation Button - Prominent Style */
      .tps-gcm-parent-nav-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background-color: var(--interactive-accent);
        color: var(--text-on-accent);
        border: 1px solid var(--interactive-accent);
        border-radius: 999px;
        font-size: calc(12px * var(--tps-gcm-text-scale));
        font-weight: 600;
        cursor: pointer;
        transition: transform 0.1s ease, background-color 0.1s, box-shadow 0.1s;
        margin-left: 8px; /* Spacing from title/other elements */
      }
      .tps-gcm-parent-nav-button:hover {
        background-color: var(--interactive-accent-hover);
        transform: translateY(-1px);
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        color: var(--text-on-accent);
      }
      .tps-gcm-parent-nav-button svg {
        width: 14px;
        height: 14px;
        stroke-width: 2.5px;
      }

      .tps-gcm-top-parent-nav {
        margin: calc(4px * var(--tps-gcm-density)) 0 calc(8px * var(--tps-gcm-density));
        display: flex;
        gap: calc(8px * var(--tps-gcm-density));
        flex-wrap: wrap;
        justify-content: flex-start;
        user-select: none;
      }
      .tps-gcm-linked-context-panel {
        width: min(860px, 100%);
        margin: 14px 0;
        padding: 0;
        border: 0;
        background: transparent;
      }
      .tps-gcm-linked-context-heading {
        margin: 0 0 10px;
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        letter-spacing: 0.02em;
      }
      .tps-gcm-linked-context-card {
        margin-top: 8px;
        padding: 10px 12px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: var(--background-primary);
        opacity: 0.62;
        cursor: pointer;
        transition: opacity 120ms ease, border-color 120ms ease, background-color 120ms ease;
      }
      .tps-gcm-linked-context-card:hover,
      .tps-gcm-linked-context-card:focus-visible,
      .tps-gcm-linked-context-card:focus-within {
        opacity: 1;
        border-color: var(--interactive-accent);
        background: color-mix(in srgb, var(--background-primary) 92%, var(--interactive-accent));
        outline: none;
      }
      .tps-gcm-linked-context-meta {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 6px;
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
      }
      .tps-gcm-linked-context-source { color: var(--text-normal); font-weight: 600; }
      .tps-gcm-linked-context-kind { text-transform: uppercase; letter-spacing: 0.04em; }
      .tps-gcm-linked-context-body { pointer-events: none; }
      .tps-gcm-linked-context-body input[type="checkbox"] { pointer-events: auto; cursor: pointer; }
      .tps-gcm-linked-context-card--line .tps-gcm-linked-context-body {
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: normal;
        line-height: 1.5;
      }
      .tps-gcm-linked-context-card--line .tps-gcm-linked-context-body ul,
      .tps-gcm-linked-context-card--line .tps-gcm-linked-context-body ol {
        margin: 0;
        padding-inline-start: 1.75em;
      }
      .tps-gcm-linked-context-card--line .tps-gcm-linked-context-body li { margin: 0; }
      .tps-gcm-linked-context-body > :first-child { margin-top: 0; }
      .tps-gcm-linked-context-body > :last-child { margin-bottom: 0; }
      .tps-gcm-linked-context-task { pointer-events: auto; }
      .tps-gcm-linked-context-task.is-long-pressing {
        background: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
        border-radius: 6px;
      }
      @media (max-width: 700px), (pointer: coarse) {
        .tps-gcm-linked-context-panel {
          width: 100%;
          max-width: 100%;
          margin: 12px 0 24px;
        }
        .tps-gcm-linked-context-heading {
          margin-bottom: 8px;
          padding-inline: 2px;
          font-size: var(--font-ui-medium);
        }
        .tps-gcm-linked-context-card {
          margin-top: 7px;
          padding: 10px;
          border-radius: 12px;
          opacity: 0.82;
          overflow: hidden;
          -webkit-tap-highlight-color: transparent;
        }
        .tps-gcm-linked-context-meta {
          align-items: baseline;
          flex-wrap: wrap;
          gap: 3px 10px;
          margin-bottom: 7px;
        }
        .tps-gcm-linked-context-source {
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tps-gcm-linked-context-kind { margin-inline-start: auto; }
        .tps-gcm-linked-context-body {
          font-size: var(--font-ui-medium);
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .tps-gcm-linked-context-body ul,
        .tps-gcm-linked-context-body ol { padding-inline-start: 1.45em; }
        .tps-gcm-linked-context-body input[type="checkbox"] {
          width: 22px;
          height: 22px;
          margin-inline-end: 7px;
        }
        .tps-gcm-linked-context-task {
          min-height: 36px;
          padding-block: 4px;
          touch-action: pan-y;
        }
      }
      .tps-gcm-parent-nav-button--top {
        margin-left: 0 !important;
      }
      .tps-gcm-parent-nav-button--bottom {
        margin-left: 0 !important;
        min-height: calc(36px * var(--tps-gcm-button-scale) * var(--tps-gcm-density));
        height: calc(36px * var(--tps-gcm-button-scale) * var(--tps-gcm-density));
        padding: 0 calc(10px * var(--tps-gcm-density));
        border-radius: calc(10px * var(--tps-gcm-radius-scale));
        background: var(--background-modifier-form-field);
        border-color: var(--background-modifier-border);
        color: var(--text-muted);
        box-shadow: none;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .tps-gcm-parent-nav-button--bottom:hover {
        background: color-mix(in srgb, var(--background-modifier-hover), var(--background-primary));
        border-color: var(--interactive-accent);
        color: var(--text-normal);
      }
      .tps-gcm-parent-nav-button.is-running-time {
        border-color: var(--interactive-accent);
        color: var(--text-normal);
        background: color-mix(in srgb, var(--interactive-accent) 18%, var(--background-modifier-form-field));
        font-variant-numeric: tabular-nums;
      }
      .tps-gcm-top-properties-panel {
        flex: 0 0 100%;
        width: min(860px, 100%);
        min-height: calc(92px * var(--tps-gcm-density));
        margin-top: calc(18px * var(--tps-gcm-density));
        margin-bottom: calc(13px * var(--tps-gcm-density));
        display: flex;
        flex-direction: column;
        gap: calc(8px * var(--tps-gcm-density));
        color: var(--text-normal);
        contain: layout style;
        position: relative;
      }
      .tps-gcm-top-properties-placeholder {
        flex: 0 0 100%;
        width: min(860px, 100%);
        margin-top: calc(18px * var(--tps-gcm-density));
        margin-bottom: calc(13px * var(--tps-gcm-density));
        pointer-events: none;
        opacity: 0;
      }
      .tps-gcm-top-properties-page-break {
        width: 100%;
        height: 1px;
        margin-top: calc(8px * var(--tps-gcm-density));
        background: linear-gradient(
          90deg,
          transparent,
          var(--background-modifier-border),
          transparent
        );
        opacity: 0.9;
        pointer-events: none;
      }
      .tps-gcm-top-properties-panel--collapsed .tps-gcm-top-properties-page-break {
        margin-top: 0;
      }
      .tps-gcm-top-properties-heading {
        appearance: none;
        border: 0;
        box-shadow: none !important;
        background: transparent !important;
        padding: 2px 5px;
        margin: 0;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        width: fit-content;
        color: var(--text-normal);
        font-size: calc(13px * var(--tps-gcm-density));
        font-weight: 700;
        line-height: 1.25;
        cursor: pointer;
        border-radius: 6px;
      }
      .tps-gcm-top-properties-add-button {
        appearance: none;
        position: absolute;
        top: 0;
        right: 0;
        width: 24px;
        height: 24px;
        min-width: 24px;
        min-height: 24px;
        padding: 0;
        margin: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 6px;
        box-shadow: none !important;
        background: transparent !important;
        color: var(--text-muted);
        opacity: 0.78;
        cursor: pointer;
      }
      .tps-gcm-top-properties-add-button:hover,
      .tps-gcm-top-properties-add-button:focus-visible {
        background: color-mix(in srgb, var(--background-modifier-hover) 60%, transparent) !important;
        color: var(--text-normal);
        opacity: 1;
        outline: none;
      }
      .tps-gcm-top-properties-add-button svg {
        width: 13px;
        height: 13px;
        stroke-width: 2.4px;
      }
      .tps-gcm-top-properties-heading:hover,
      .tps-gcm-top-properties-heading:focus-visible {
        background: color-mix(in srgb, var(--background-modifier-hover) 55%, transparent) !important;
        color: var(--text-normal);
        outline: none;
      }
      .tps-gcm-top-properties-heading-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--text-accent);
        opacity: 0.9;
      }
      .tps-gcm-top-properties-heading-icon svg {
        width: 11px;
        height: 11px;
        stroke-width: 2.5px;
      }
      .tps-gcm-top-properties-list {
        display: flex;
        flex-direction: column;
        gap: calc(2px * var(--tps-gcm-density));
      }
      .tps-gcm-top-properties-panel--collapsed {
        gap: 0;
        min-height: calc(36px * var(--tps-gcm-density));
        margin-bottom: calc(4px * var(--tps-gcm-density));
      }
      .tps-gcm-top-property-row {
        display: grid;
        grid-template-columns: 19px minmax(88px, 120px) minmax(0, 1fr);
        align-items: start;
        gap: calc(7px * var(--tps-gcm-density));
        min-height: calc(27px * var(--tps-gcm-density));
        padding: 3px 5px;
        margin: 0 -5px;
        border-radius: 6px;
      }
      .tps-gcm-top-property-row:hover {
        background: color-mix(in srgb, var(--background-modifier-hover) 34%, transparent);
      }
      .tps-gcm-top-property-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
        opacity: 0.86;
        padding-top: 4px;
      }
      .tps-gcm-top-property-icon svg {
        width: 14px;
        height: 14px;
        stroke-width: 2;
      }
      .tps-gcm-top-property-label {
        color: var(--text-muted);
        font-size: calc(11px * var(--tps-gcm-density));
        font-weight: 600;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 22px;
      }
      .tps-gcm-top-property-value {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: calc(5px * var(--tps-gcm-density));
        min-width: 0;
        min-height: 22px;
        border-radius: 6px;
        padding: 2px 3px;
        margin: -2px -3px;
      }
      .tps-gcm-top-property-value--clickable {
        cursor: text;
      }
      .tps-gcm-top-property-value--clickable:hover,
      .tps-gcm-top-property-value--clickable:focus-visible {
        background: color-mix(in srgb, var(--background-modifier-hover) 55%, transparent);
        outline: none;
      }
      .tps-gcm-top-property-value .tps-gcm-chip {
        margin: 0;
        min-height: 22px;
        padding-top: 3px;
        padding-bottom: 3px;
        border-radius: 999px;
        box-shadow: none;
        font-size: calc(10.5px * var(--tps-gcm-density));
      }
      .tps-gcm-top-property-value .tps-gcm-chip--link-value {
        min-height: 18px;
        padding: 1px 5px;
        gap: 3px;
        border-radius: 5px;
        border-color: transparent;
        background: transparent;
        color: var(--text-accent);
      }
      .tps-gcm-top-property-value .tps-gcm-chip--link-value:hover,
      .tps-gcm-top-property-value .tps-gcm-chip--link-value:focus-within {
        background: color-mix(in srgb, var(--background-modifier-hover) 60%, transparent);
      }
      .tps-gcm-top-property-value .tps-gcm-chip--link-value .tps-gcm-chip-icon {
        color: var(--text-muted);
        opacity: 0.75;
      }
      .tps-gcm-top-property-value .tps-gcm-chip--link-value .tps-gcm-chip-label {
        color: var(--text-accent);
        font-size: calc(10.5px * var(--tps-gcm-density));
        font-weight: 500;
        text-decoration: none;
        line-height: 16px;
      }
      .tps-gcm-top-property-value .tps-gcm-chip--link-value:hover .tps-gcm-chip-label,
      .tps-gcm-top-property-value .tps-gcm-chip--link-value .tps-gcm-chip-label:hover {
        text-decoration: underline;
      }
      .tps-gcm-top-property-value .tps-gcm-chip--link-value .tps-gcm-link-chip-remove {
        width: 14px;
        height: 14px;
        min-width: 14px;
        padding: 0;
        margin-left: 1px;
        border-radius: 4px;
        opacity: 0;
        color: var(--text-muted);
        background: transparent;
        border: 0;
        box-shadow: none;
      }
      .tps-gcm-top-property-value .tps-gcm-chip--link-value:hover .tps-gcm-link-chip-remove,
      .tps-gcm-top-property-value .tps-gcm-chip--link-value:focus-within .tps-gcm-link-chip-remove {
        opacity: 0.9;
      }
      .tps-gcm-top-property-value .tps-gcm-chip--link-value .tps-gcm-link-chip-remove:hover {
        background: var(--background-modifier-hover);
        color: var(--text-normal);
      }
      .tps-gcm-top-property-value .tps-gcm-chip--link-value .tps-gcm-link-chip-remove svg {
        width: 10px;
        height: 10px;
      }
      .tps-gcm-top-property-value .tps-gcm-chip-icon svg {
        width: 11px;
        height: 11px;
      }
      .tps-gcm-top-property-text,
      .tps-gcm-top-property-empty {
        min-width: 0;
        overflow-wrap: anywhere;
        font-size: calc(11px * var(--tps-gcm-density));
        line-height: 22px;
      }
      .tps-gcm-health-metric {
        --tps-gcm-health-progress: 0%;
        --tps-gcm-health-color: var(--interactive-accent);
        align-items: center;
        display: inline-flex;
        gap: 7px;
        min-width: 0;
      }
      .tps-gcm-health-metric-ring {
        align-items: center;
        aspect-ratio: 1;
        background:
          radial-gradient(circle at center, var(--background-primary) 56%, transparent 58%),
          conic-gradient(var(--tps-gcm-health-color) var(--tps-gcm-health-progress), var(--background-modifier-border) 0);
        border-radius: 50%;
        display: inline-flex;
        height: 30px;
        justify-content: center;
        min-width: 30px;
      }
      .tps-gcm-health-metric-percent {
        color: var(--tps-gcm-health-color);
        font-size: calc(8.5px * var(--tps-gcm-density));
        font-weight: 700;
        line-height: 1;
      }
      .tps-gcm-health-metric-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tps-gcm-health-metric-value {
        color: var(--text-normal);
        font-size: calc(11px * var(--tps-gcm-density));
        font-weight: 650;
        line-height: 22px;
      }
      .tps-gcm-health-metric-goal {
        color: var(--text-muted);
        font-size: calc(10px * var(--tps-gcm-density));
        line-height: 22px;
      }
      .tps-gcm-top-property-empty {
        color: var(--text-muted);
        opacity: 0.75;
      }
      @media (max-width: 700px) {
        .tps-gcm-top-property-row {
          grid-template-columns: 18px minmax(66px, 32%) minmax(0, 1fr);
        }
      }
      .tps-gcm-stacked-properties-active .metadata-container {
        display: none !important;
      }
      .tps-gcm-native-properties-active .metadata-container {
        display: block !important;
        max-width: min(620px, 100%);
        min-height: calc(92px * var(--tps-gcm-density));
        margin: 16px 0 27px;
        padding: 0;
        border: 0;
        background: transparent;
        contain: layout style;
      }
      .tps-gcm-native-properties-active .metadata-container .metadata-properties-heading,
      .tps-gcm-native-properties-active .metadata-container .metadata-properties-title {
        margin: 0 0 11px;
        color: var(--text-normal);
        font-size: 0.84em;
        font-weight: 700;
        line-height: 1.25;
      }
      .tps-gcm-native-properties-active .metadata-container .metadata-properties,
      .tps-gcm-native-properties-active .metadata-properties {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .tps-gcm-native-properties-active .metadata-container .metadata-property,
      .tps-gcm-native-properties-active .metadata-container .metadata-property-container,
      .tps-gcm-native-properties-active .metadata-property,
      .tps-gcm-native-properties-active .metadata-property-container {
        display: grid;
        grid-template-columns: 21px minmax(96px, 136px) minmax(0, 1fr);
        align-items: center;
        gap: 8px;
        min-height: 27px;
        padding: 0;
        border: 0 !important;
        border-radius: 0;
        background: transparent !important;
        box-shadow: none !important;
      }
      .tps-gcm-native-properties-active .metadata-container .metadata-property-icon,
      .tps-gcm-native-properties-active .metadata-property-icon {
        grid-column: 1;
        width: 18px;
        min-width: 18px;
        color: var(--text-muted);
        opacity: 0.9;
      }
      .tps-gcm-native-properties-active .metadata-container .metadata-property-icon svg,
      .tps-gcm-native-properties-active .metadata-property-icon svg {
        width: 15px;
        height: 15px;
      }
      .tps-gcm-native-properties-active .metadata-container .metadata-property-key,
      .tps-gcm-native-properties-active .metadata-container .metadata-property-key-input,
      .tps-gcm-native-properties-active .metadata-property-key,
      .tps-gcm-native-properties-active .metadata-property-key-input {
        grid-column: 2;
        min-width: 0;
        color: var(--text-muted);
        font-size: 0.74em;
        font-weight: 650;
        line-height: 1.25;
        text-transform: capitalize;
      }
      .tps-gcm-native-properties-active .metadata-container .metadata-property-value,
      .tps-gcm-native-properties-active .metadata-container .metadata-property-value-input,
      .tps-gcm-native-properties-active .metadata-property-value,
      .tps-gcm-native-properties-active .metadata-property-value-input {
        grid-column: 3;
        min-width: 0;
        justify-content: flex-start;
        color: var(--text-normal);
        font-size: 0.74em;
        font-weight: 550;
        line-height: 1.35;
      }
      .tps-gcm-native-properties-active .metadata-container input,
      .tps-gcm-native-properties-active .metadata-container textarea,
      .tps-gcm-native-properties-active .metadata-container .metadata-input,
      .tps-gcm-native-properties-active .metadata-container .metadata-property-value-input,
      .tps-gcm-native-properties-active .metadata-properties input,
      .tps-gcm-native-properties-active .metadata-properties textarea,
      .tps-gcm-native-properties-active .metadata-properties .metadata-input,
      .tps-gcm-native-properties-active .metadata-properties .metadata-property-value-input {
        min-height: 22px;
        border: 0 !important;
        border-radius: 999px;
        background: transparent !important;
        box-shadow: none !important;
      }
      .tps-gcm-native-properties-active .metadata-container .metadata-property:focus-within,
      .tps-gcm-native-properties-active .metadata-container .metadata-property-container:focus-within,
      .tps-gcm-native-properties-active .metadata-property:focus-within,
      .tps-gcm-native-properties-active .metadata-property-container:focus-within {
        border: 0 !important;
        box-shadow: none !important;
        background: transparent !important;
      }
      .tps-gcm-native-properties-active .metadata-container .multi-select-pill,
      .tps-gcm-native-properties-active .metadata-container .metadata-link,
      .tps-gcm-native-properties-active .metadata-container .metadata-property-value .clickable-icon,
      .tps-gcm-native-properties-active .metadata-container .metadata-property-value button,
      .tps-gcm-native-properties-active .metadata-properties .multi-select-pill,
      .tps-gcm-native-properties-active .metadata-properties .metadata-link,
      .tps-gcm-native-properties-active .metadata-properties .metadata-property-value .clickable-icon,
      .tps-gcm-native-properties-active .metadata-properties .metadata-property-value button {
        min-height: 21px;
        border-radius: 999px;
      }
      .tps-gcm-native-properties-active .metadata-container .metadata-property-value .multi-select-pill,
      .tps-gcm-native-properties-active .metadata-container .metadata-property-value .metadata-link,
      .tps-gcm-native-properties-active .metadata-properties .metadata-property-value .multi-select-pill,
      .tps-gcm-native-properties-active .metadata-properties .metadata-property-value .metadata-link {
        padding: 2px 8px;
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
      }
      .tps-gcm-native-properties-active .metadata-container .metadata-add-button {
        margin-top: 8px;
        color: var(--text-muted);
      }
      .tps-gcm-native-property-hidden {
        display: none !important;
      }
      .tps-gcm-native-preview-properties-active .metadata-container,
      .tps-gcm-native-preview-properties-active .metadata-properties {
        display: block !important;
        border: 0 !important;
        background: transparent !important;
      }
      .tps-gcm-native-preview-properties-active .metadata-container {
        margin: 0 !important;
        padding: 0 !important;
      }
      .tps-gcm-native-preview-properties-active .metadata-properties {
        display: flex !important;
        flex-direction: column;
        gap: 6px;
      }
      .tps-gcm-native-preview-properties-active .metadata-property,
      .tps-gcm-native-preview-properties-active .metadata-property-container {
        display: grid;
        grid-template-columns: 22px minmax(92px, 128px) minmax(0, 1fr);
        align-items: center;
        gap: 8px;
        min-height: 27px;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }
      .tps-gcm-native-preview-properties-active .metadata-property-icon {
        grid-column: 1;
        width: 18px;
        min-width: 18px;
        color: var(--text-muted);
        opacity: 0.9;
      }
      .tps-gcm-native-preview-properties-active .metadata-property-icon svg {
        width: 15px;
        height: 15px;
      }
      .tps-gcm-native-preview-properties-active .metadata-property-key,
      .tps-gcm-native-preview-properties-active .metadata-property-key-input {
        grid-column: 2;
        min-width: 0;
        color: var(--text-muted);
        font-size: 0.74em;
        font-weight: 650;
        line-height: 1.25;
        text-transform: capitalize;
      }
      .tps-gcm-native-preview-properties-active .metadata-property-value,
      .tps-gcm-native-preview-properties-active .metadata-property-value-input {
        grid-column: 3;
        min-width: 0;
        justify-content: flex-start;
        color: var(--text-normal);
        font-size: 0.74em;
        font-weight: 550;
        line-height: 1.35;
      }
      .tps-gcm-native-preview-properties-active input,
      .tps-gcm-native-preview-properties-active textarea,
      .tps-gcm-native-preview-properties-active .metadata-input,
      .tps-gcm-native-preview-properties-active .metadata-property-value-input {
        min-height: 22px;
        border: 0 !important;
        border-radius: 999px;
        background: transparent !important;
        box-shadow: none !important;
      }
      .tps-gcm-native-preview-properties-active .metadata-property:focus-within,
      .tps-gcm-native-preview-properties-active .metadata-property-container:focus-within {
        border: 0 !important;
        box-shadow: none !important;
        background: transparent !important;
      }
      .tps-gcm-native-preview-properties-active .multi-select-pill,
      .tps-gcm-native-preview-properties-active .metadata-link,
      .tps-gcm-native-preview-properties-active .metadata-property-value .clickable-icon,
      .tps-gcm-native-preview-properties-active .metadata-property-value button {
        min-height: 21px;
        border-radius: 999px;
      }
      .tps-gcm-native-preview-properties-active .metadata-property-value .multi-select-pill,
      .tps-gcm-native-preview-properties-active .metadata-property-value .metadata-link {
        padding: 2px 8px;
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
      }
      .tps-gcm-native-preview-properties-active .metadata-add-button {
        display: none !important;
      }
      .tps-gcm-bases-preview-metadata-host {
        display: block !important;
        border: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
        background: transparent !important;
      }
      .tps-gcm-bases-preview-title {
        margin: 0 0 8px;
        color: var(--text-normal);
        font-size: 20px;
        font-weight: 700;
        line-height: 1.25;
      }
      .bases-preview.tps-gcm-bases-preview-properties-active,
      .bases-hover-popover.tps-gcm-bases-preview-properties-active,
      .bases-table-cell-popover.tps-gcm-bases-preview-properties-active {
        color: var(--text-normal);
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        box-shadow: var(--shadow-s);
        overflow: hidden;
      }
      .hover-popover .tps-gcm-bases-preview-properties,
      .popover .tps-gcm-bases-preview-properties,
      .markdown-hover-popover .tps-gcm-bases-preview-properties,
      .bases-preview .tps-gcm-bases-preview-properties,
      .bases-hover-popover .tps-gcm-bases-preview-properties,
      .bases-table-cell-popover .tps-gcm-bases-preview-properties {
        width: 100%;
        margin-top: 10px;
        margin-bottom: 12px;
        padding: 0 10px;
        box-sizing: border-box;
      }
      .hover-popover .tps-gcm-bases-preview-properties .tps-gcm-top-properties-heading,
      .popover .tps-gcm-bases-preview-properties .tps-gcm-top-properties-heading,
      .markdown-hover-popover .tps-gcm-bases-preview-properties .tps-gcm-top-properties-heading,
      .bases-preview .tps-gcm-bases-preview-properties .tps-gcm-top-properties-heading,
      .bases-hover-popover .tps-gcm-bases-preview-properties .tps-gcm-top-properties-heading,
      .bases-table-cell-popover .tps-gcm-bases-preview-properties .tps-gcm-top-properties-heading {
        font-size: 16px;
      }
      .hover-popover .tps-gcm-bases-preview-properties .tps-gcm-top-property-row,
      .popover .tps-gcm-bases-preview-properties .tps-gcm-top-property-row,
      .markdown-hover-popover .tps-gcm-bases-preview-properties .tps-gcm-top-property-row,
      .bases-preview .tps-gcm-bases-preview-properties .tps-gcm-top-property-row,
      .bases-hover-popover .tps-gcm-bases-preview-properties .tps-gcm-top-property-row,
      .bases-table-cell-popover .tps-gcm-bases-preview-properties .tps-gcm-top-property-row {
        grid-template-columns: 24px minmax(90px, 135px) minmax(0, 1fr);
      }
      .bases-preview .tps-gcm-bases-preview-properties .tps-gcm-top-property-value,
      .bases-hover-popover .tps-gcm-bases-preview-properties .tps-gcm-top-property-value,
      .bases-table-cell-popover .tps-gcm-bases-preview-properties .tps-gcm-top-property-value {
        min-width: 0;
      }

      /* Plus Buttons - Neutral Style */
      .tps-gcm-subitems-header-btn {
        color: var(--text-muted);
        background: transparent;
      }
      .tps-gcm-subitems-header-btn:hover {
        color: var(--text-normal);
        background: var(--background-modifier-hover);
      }

      /* Direction sections */
      .tps-gcm-bl-direction {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .tps-gcm-bl-direction + .tps-gcm-bl-direction {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px dashed var(--background-modifier-border);
      }

      .tps-gcm-bl-direction-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 0;
      }

      .tps-gcm-bl-section-header {
        cursor: pointer;
        user-select: none;
        border-radius: 4px;
        padding: 3px 4px;
        margin: 0 -4px;
        transition: background-color 0.1s;
      }
      .tps-gcm-bl-section-header:hover {
        background: color-mix(in srgb, var(--background-modifier-hover) 60%, transparent);
      }

      .tps-gcm-bl-direction-title {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-faint);
      }

      .tps-gcm-bl-direction-count {
        font-size: 10px;
        font-weight: 600;
        color: var(--text-muted);
      }

      /* Group card */
      .tps-gcm-bl-group {
        display: flex;
        flex-direction: column;
        border-radius: 6px;
        background: color-mix(in srgb, var(--background-secondary) 50%, transparent);
        border: 1px solid color-mix(in srgb, var(--background-modifier-border) 60%, transparent);
        overflow: hidden;
      }

      .tps-gcm-bl-group-header {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 3px 6px;
        min-width: 0;
      }

      .tps-gcm-bl-chevron {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        flex: 0 0 16px;
        color: var(--text-muted);
        cursor: pointer;
      }

      .tps-gcm-bl-chevron svg {
        width: 14px;
        height: 14px;
      }

      .tps-gcm-bl-group-title {
        color: var(--text-muted);
        font-size: 10px;
        font-weight: 600;
        line-height: 1.3;
        cursor: pointer;
        padding: 0;
        margin: 0;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1 1 auto;
        text-decoration: none;
      }

      .tps-gcm-bl-group-title:hover {
        color: var(--text-accent);
        text-decoration: underline;
      }

      .tps-gcm-bl-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 700;
        color: var(--text-accent);
        background: color-mix(in srgb, var(--interactive-accent) 16%, transparent);
        flex: 0 0 auto;
      }

      .tps-gcm-bl-open-btn {
        appearance: none;
        -webkit-appearance: none;
        border: 0;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        padding: 2px;
        border-radius: 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
      }

      .tps-gcm-bl-open-btn svg {
        width: 14px;
        height: 14px;
      }

      .tps-gcm-bl-open-btn:hover {
        color: var(--text-accent);
        background: var(--background-modifier-hover);
      }

      /* Occurrences list */
      .tps-gcm-bl-occurrences {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 0 6px 6px 6px;
      }

      .tps-gcm-bl-occurrence {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px 6px;
        border-radius: 5px;
        background: color-mix(in srgb, var(--background-primary) 80%, transparent);
      }

      .tps-gcm-bl-occurrence-meta {
        font-size: 9px;
        color: var(--text-faint);
        line-height: 1.2;
      }

      .tps-gcm-bl-occurrence-preview {
        font-size: var(--font-ui-small);
        color: var(--text-normal);
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .tps-gcm-bl-occurrence-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
      }

      .tps-gcm-bl-action {
        border: 1px solid var(--background-modifier-border);
        border-radius: 999px;
        background: var(--background-modifier-form-field);
        color: var(--text-normal);
        font-size: 10px;
        line-height: 1.25;
        font-weight: 600;
        padding: 2px 7px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }

      .tps-gcm-bl-action:hover {
        border-color: var(--interactive-accent);
        background: color-mix(in srgb, var(--background-modifier-hover), var(--background-primary));
      }

      /* Frontmatter-key sections (direction-level) */
      .tps-gcm-bl-fm-section {
        padding: 4px 6px 4px 6px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .tps-gcm-bl-fm-section-key {
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-faint);
        padding: 0 2px;
      }

      .tps-gcm-bl-fm-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .tps-gcm-bl-fm-chip {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-modifier-form-field);
        font-size: var(--font-ui-small);
        color: var(--text-muted);
        cursor: pointer;
        text-decoration: none;
        transition: border-color 80ms, color 80ms;
        max-width: 160px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tps-gcm-bl-fm-chip:hover {
        border-color: var(--interactive-accent);
        color: var(--text-accent);
      }

      /* Highlighted link / mention text in preview */
      .tps-gcm-bl-highlight {
        background: color-mix(in srgb, var(--text-accent) 18%, transparent);
        color: var(--text-accent);
        border-radius: 2px;
        padding: 0 1px;
      }

      /* Children / Attachments file list */
      .tps-gcm-bl-file-list {
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding: 0 4px 4px;
      }

      .tps-gcm-bl-file-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 6px;
        border-radius: 4px;
      }

      .tps-gcm-bl-file-row:hover {
        background: var(--background-modifier-hover);
      }

      .tps-gcm-bl-file-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 14px;
        color: var(--text-muted);
      }

      .tps-gcm-bl-file-icon svg {
        width: 14px;
        height: 14px;
      }

      .tps-gcm-bl-file-name {
        appearance: none;
        -webkit-appearance: none;
        border: 0;
        background: transparent;
        color: var(--text-normal);
        font-size: var(--font-ui-small);
        cursor: pointer;
        padding: 0;
        margin: 0;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: left;
        line-height: 1.4;
      }

      .tps-gcm-bl-file-name:hover {
        color: var(--text-accent);
      }

      .tps-gcm-inline-field-pill {
        display: inline-flex;
        align-items: center;
        max-width: min(240px, 40vw);
        min-height: 1.45em;
        margin: 0 0.2em;
        padding: 0 0.45em;
        border: 1px solid color-mix(in srgb, var(--background-modifier-border) 82%, var(--text-muted));
        border-radius: 999px;
        background: color-mix(in srgb, var(--background-secondary) 76%, var(--interactive-accent) 8%);
        color: var(--text-muted);
        font-size: 0.72em;
        font-weight: 650;
        line-height: 1.35;
        vertical-align: 0.08em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
      }

      .tps-gcm-inline-field-pill-group {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.2em;
        margin-left: 0.35em;
        vertical-align: 0.08em;
      }

      .tps-gcm-inline-field-pill-group .tps-gcm-inline-field-pill {
        margin: 0;
      }

      .tps-gcm-inline-field-pill--scheduled,
      .tps-gcm-inline-field-pill--start,
      .tps-gcm-inline-field-pill--due,
      .tps-gcm-inline-field-pill--schedule-group {
        border-color: color-mix(in srgb, var(--text-accent) 42%, var(--background-modifier-border));
        background: color-mix(in srgb, var(--background-secondary) 78%, var(--text-accent) 10%);
        color: color-mix(in srgb, var(--text-accent) 72%, var(--text-normal));
      }

      .tps-gcm-inline-field-pill:hover {
        border-color: color-mix(in srgb, var(--interactive-accent) 70%, var(--background-modifier-border));
        background: color-mix(in srgb, var(--background-secondary) 66%, var(--interactive-accent) 16%);
        color: var(--text-normal);
      }

      .tps-gcm-inline-field-pill--time-estimate {
        border-color: color-mix(in srgb, var(--color-yellow) 45%, var(--background-modifier-border));
        background: color-mix(in srgb, var(--background-secondary) 76%, var(--color-yellow) 12%);
        color: color-mix(in srgb, var(--color-yellow) 65%, var(--text-normal));
      }

      .markdown-source-view.mod-cm6 .tps-gcm-inline-field-pill {
        cursor: pointer;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line .tps-gcm-live-inline-property-chip {
        display: inline-flex;
        align-items: baseline;
        gap: 0.18em;
        max-width: min(260px, 42vw);
        min-height: 1.5em;
        margin-inline: 0.14em;
        padding: 0.06em 0.5em 0.08em;
        border: 1px solid color-mix(in srgb, var(--background-modifier-border) 78%, var(--text-muted));
        border-radius: 6px;
        background: color-mix(in srgb, var(--background-secondary) 82%, var(--interactive-accent) 8%);
        color: color-mix(in srgb, var(--text-muted) 72%, var(--text-normal));
        font-size: 0.78em;
        font-weight: 650;
        line-height: 1.35;
        white-space: nowrap;
        vertical-align: 0.07em;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line .tps-gcm-live-inline-property-chip:hover {
        border-color: color-mix(in srgb, var(--interactive-accent) 62%, var(--background-modifier-border));
        background: color-mix(in srgb, var(--background-secondary) 72%, var(--interactive-accent) 14%);
        color: var(--text-normal);
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line .tps-gcm-live-inline-property-chip-key {
        color: color-mix(in srgb, currentColor 68%, var(--text-muted));
        font-weight: 700;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line .tps-gcm-live-inline-property-chip-separator {
        color: var(--text-faint);
        font-weight: 600;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line .tps-gcm-live-inline-property-chip-value {
        color: var(--text-normal);
        font-weight: 650;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line .tps-gcm-live-inline-property-chip--empty {
        border-style: dashed;
        color: var(--text-faint);
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line .tps-gcm-live-inline-property-chip--scheduled,
      .markdown-source-view.mod-cm6.is-live-preview .cm-line .tps-gcm-live-inline-property-chip--start,
      .markdown-source-view.mod-cm6.is-live-preview .cm-line .tps-gcm-live-inline-property-chip--due {
        border-color: color-mix(in srgb, var(--text-accent) 42%, var(--background-modifier-border));
        background: color-mix(in srgb, var(--background-secondary) 78%, var(--text-accent) 10%);
        color: color-mix(in srgb, var(--text-accent) 72%, var(--text-normal));
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line .tps-gcm-live-inline-property-chip--time-estimate {
        border-color: color-mix(in srgb, var(--color-yellow) 45%, var(--background-modifier-border));
        background: color-mix(in srgb, var(--background-secondary) 76%, var(--color-yellow) 12%);
        color: color-mix(in srgb, var(--color-yellow) 65%, var(--text-normal));
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line .tps-gcm-live-inline-property-chip--time-estimate .tps-gcm-live-inline-property-chip-value {
        color: color-mix(in srgb, var(--color-yellow) 45%, var(--text-normal));
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line .dataview.inline-field,
      .markdown-source-view.mod-cm6.is-live-preview .cm-line .dataview.inline-field-key,
      .markdown-source-view.mod-cm6.is-live-preview .cm-line .dataview.inline-field-value,
      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .dataview.inline-field,
      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .dataview.inline-field-key,
      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .dataview.inline-field-value {
        border-radius: 999px;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line .dataview.inline-field,
      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .dataview.inline-field {
        display: inline-flex;
        align-items: baseline;
        gap: 0.18em;
        max-width: min(280px, 44vw);
        min-height: 1.5em;
        margin-inline: 0.14em;
        padding: 0.06em 0.5em 0.08em;
        border: 1px solid color-mix(in srgb, var(--background-modifier-border) 78%, var(--text-muted));
        border-radius: 6px;
        background: color-mix(in srgb, var(--background-secondary) 82%, var(--interactive-accent) 8%);
        color: color-mix(in srgb, var(--text-muted) 72%, var(--text-normal));
        font-size: 0.78em;
        font-weight: 650;
        line-height: 1.35;
        text-decoration: none !important;
        vertical-align: 0.07em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line .dataview.inline-field-key,
      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .dataview.inline-field-key {
        color: color-mix(in srgb, currentColor 68%, var(--text-muted));
        font-weight: 700;
        text-decoration: none !important;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line .dataview.inline-field-value,
      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .dataview.inline-field-value {
        color: var(--text-normal);
        font-weight: 650;
        text-decoration: none !important;
      }

      .tps-gcm-hidden-inline-property,
      .markdown-rendered .tps-gcm-hidden-inline-property-rendered,
      .markdown-preview-view .tps-gcm-hidden-inline-property-rendered,
      .markdown-reading-view .tps-gcm-hidden-inline-property-rendered,
      .markdown-preview-view sup:has(a[href^="#fn-tps-inline"]),
      .markdown-reading-view sup:has(a[href^="#fn-tps-inline"]),
      .markdown-preview-view li[id^="fn-tps-inline"],
      .markdown-reading-view li[id^="fn-tps-inline"] {
        display: none !important;
      }

      .markdown-source-view.mod-cm6.is-live-preview .cm-line.tps-gcm-hidden-inline-metadata-line {
        display: none !important;
      }

      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .tps-gcm-rendered-inline-property-chip.dataview.inline-field {
        display: inline-flex;
      }

      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .tps-gcm-health-food-log-line {
        max-width: 100%;
        overflow: hidden;
        white-space: nowrap;
      }

      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .tps-gcm-health-food-label {
        display: inline-block;
        max-width: calc(100% - min(13rem, 44vw) - 0.5rem);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: 0.07em;
        white-space: nowrap;
      }

      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .tps-gcm-health-food-chip-bucket {
        display: inline-flex;
        align-items: baseline;
        gap: 0.18em;
        max-width: min(13rem, 44vw);
        min-width: 0;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
        white-space: nowrap;
        vertical-align: 0.07em;
      }

      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .tps-gcm-health-food-chip-bucket::-webkit-scrollbar {
        display: none;
      }

      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .tps-gcm-health-food-chip-bucket .tps-gcm-rendered-inline-property-chip {
        flex: 0 0 auto;
        margin-inline: 0;
        max-width: 5.8rem;
        padding: 0.04em 0.42em 0.06em;
      }

      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .tps-gcm-rendered-inline-property-chip--scheduled,
      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .tps-gcm-rendered-inline-property-chip--start,
      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .tps-gcm-rendered-inline-property-chip--due {
        border-color: color-mix(in srgb, var(--text-accent) 42%, var(--background-modifier-border));
        background: color-mix(in srgb, var(--background-secondary) 78%, var(--text-accent) 10%);
        color: color-mix(in srgb, var(--text-accent) 72%, var(--text-normal));
      }

      :is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered) .tps-gcm-rendered-inline-property-chip--time-estimate {
        border-color: color-mix(in srgb, var(--color-yellow) 45%, var(--background-modifier-border));
        background: color-mix(in srgb, var(--background-secondary) 76%, var(--color-yellow) 12%);
        color: color-mix(in srgb, var(--color-yellow) 65%, var(--text-normal));
      }

      .tps-gcm-base-link-preview {
        display: flex;
        flex-direction: column;
        gap: 0;
        overflow: auto;
        scrollbar-width: none;
        border: 1px solid var(--background-modifier-border-hover, var(--background-modifier-border));
        border-radius: 8px;
        background: var(--background-primary);
        box-shadow: 0 16px 36px rgba(0, 0, 0, 0.4);
        padding: 0;
        color: var(--text-normal);
        font-size: 0.88em;
      }

      .tps-gcm-base-link-preview::-webkit-scrollbar,
      .tps-gcm-base-link-preview *::-webkit-scrollbar {
        width: 0 !important;
        height: 0 !important;
      }

      .tps-gcm-base-link-preview * {
        scrollbar-width: none;
      }

      .tps-gcm-base-link-preview-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        flex: 0 0 auto;
        padding: 10px 14px 8px;
        border-bottom: 1px solid var(--background-modifier-border);
      }

      .tps-gcm-base-link-preview-header-main {
        display: flex;
        align-items: flex-start;
        gap: 9px;
        min-width: 0;
      }

      .tps-gcm-base-link-preview-file-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 24px;
        width: 24px;
        height: 24px;
        margin-top: 1px;
        color: var(--text-accent);
      }

      .tps-gcm-base-link-preview-file-icon svg {
        width: 22px;
        height: 22px;
        stroke-width: 2.2px;
      }

      .tps-gcm-base-link-preview-title-wrap {
        min-width: 0;
      }

      .tps-gcm-base-link-preview-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: calc(18px * var(--tps-gcm-text-scale));
        font-weight: 700;
      }

      .tps-gcm-base-link-preview-path {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--text-muted);
        font-size: calc(11px * var(--tps-gcm-text-scale));
        line-height: 1.4;
      }

      .tps-gcm-base-link-preview-open {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 28px;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-secondary);
        color: var(--text-muted);
        cursor: pointer;
      }

      .tps-gcm-base-link-preview-open:hover {
        background: var(--background-modifier-hover);
        color: var(--text-normal);
      }

      .tps-gcm-base-link-preview-open svg {
        width: 15px;
        height: 15px;
      }

      .tps-gcm-base-link-preview-properties {
        flex: 0 0 auto;
        width: auto;
        max-height: none;
        overflow: visible;
        margin: 10px 14px 8px;
        padding: 0;
      }

      .tps-gcm-base-link-preview-properties .tps-gcm-top-properties-panel {
        width: 100%;
        margin-top: 0;
        margin-bottom: 0;
        gap: 5px;
      }

      .tps-gcm-base-link-preview-properties .tps-gcm-top-properties-list {
        gap: 0;
      }

      .tps-gcm-base-link-preview-properties .tps-gcm-top-property-row {
        grid-template-columns: 22px minmax(84px, 128px) minmax(0, 1fr);
        min-height: 28px;
        padding-top: 2px;
        padding-bottom: 2px;
      }

      .tps-gcm-base-link-preview-properties .tps-gcm-top-property-label,
      .tps-gcm-base-link-preview-properties .tps-gcm-top-property-text,
      .tps-gcm-base-link-preview-properties .tps-gcm-top-property-empty {
        line-height: 24px;
      }

      .tps-gcm-base-link-preview-properties .tps-gcm-chip {
        min-height: 24px;
      }

      .tps-gcm-base-link-preview-properties .tps-gcm-top-properties-page-break {
        display: none;
      }

      .tps-gcm-base-link-preview-body {
        flex: 0 0 auto;
        min-height: 0;
        overflow: visible;
        padding: 0 14px 12px;
        background: var(--background-primary);
      }

      .tps-gcm-base-link-preview-rendered-body {
        max-width: none;
        min-height: 96px;
        margin: 0;
        padding: 8px 0 4px;
        border-radius: 0;
        outline: none;
        cursor: text;
      }

      .tps-gcm-base-link-preview-body.is-editing .tps-gcm-base-link-preview-rendered-body {
        min-height: 72px;
        padding: 8px 0 10px;
        border-bottom: 1px solid var(--background-modifier-border);
      }

      .tps-gcm-base-link-preview-rendered-body:focus {
        box-shadow: none;
      }

      .tps-gcm-base-link-preview-source-editor {
        display: block;
        width: 100%;
        min-height: 92px;
        resize: vertical;
        margin: 10px 0 8px;
        padding: 8px 10px;
        border: 1px solid var(--background-modifier-border-hover, var(--background-modifier-border));
        border-radius: 6px;
        outline: none;
        background: var(--background-primary);
        color: var(--text-normal);
        font: inherit;
        line-height: var(--line-height-normal);
        box-shadow: 0 0 0 1px var(--interactive-accent);
        scrollbar-width: none;
      }

      .tps-gcm-base-link-preview-source-editor::-webkit-scrollbar {
        width: 0 !important;
        height: 0 !important;
      }

      .tps-gcm-base-link-preview-status {
        flex: 0 0 auto;
        min-height: 14px;
        padding: 0 14px 8px;
        color: var(--text-muted);
        font-size: calc(10px * var(--tps-gcm-text-scale));
        text-align: right;
      }

      .status-bar-item.tps-gcm-time-tracker-status-item {
        display: flex;
        align-items: center;
        padding: 0 4px;
        color: var(--text-muted);
      }

      .tps-gcm-time-tracker-status {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        max-width: min(360px, 36vw);
        min-width: 0;
      }

      .tps-gcm-time-tracker-status button {
        appearance: none;
        -webkit-appearance: none;
        border: 0;
        box-shadow: none;
        background: transparent;
        color: inherit;
        font: inherit;
        line-height: 1;
        height: 22px;
        min-height: 22px;
        padding: 0 4px;
        margin: 0;
      }

      .tps-gcm-time-tracker-main,
      .tps-gcm-time-tracker-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        cursor: pointer;
      }

      .tps-gcm-time-tracker-main {
        gap: 4px;
        min-width: 0;
        max-width: min(280px, 30vw);
      }

      .tps-gcm-time-tracker-action {
        width: 22px;
        flex: 0 0 22px;
      }

      .tps-gcm-time-tracker-main:hover,
      .tps-gcm-time-tracker-action:hover {
        background: var(--background-modifier-hover);
        color: var(--text-normal);
      }

      .tps-gcm-time-tracker-icon,
      .tps-gcm-time-tracker-action svg {
        width: 13px;
        height: 13px;
        flex: 0 0 13px;
      }

      .tps-gcm-time-tracker-icon svg {
        width: 13px;
        height: 13px;
      }

      .tps-gcm-time-tracker-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      .tps-gcm-time-tracker-status-item.is-paused .tps-gcm-time-tracker-main {
        color: var(--text-faint);
      }

      body.is-mobile .tps-gcm-time-tracker-mobile-dock,
      body.is-phone .tps-gcm-time-tracker-mobile-dock {
        position: relative;
        z-index: 5;
        box-sizing: border-box;
        flex: 0 0 auto;
        width: 100%;
        padding: 4px max(8px, env(safe-area-inset-right)) 4px max(8px, env(safe-area-inset-left));
        border-bottom: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
      }

      body.is-mobile .tps-gcm-time-tracker-mobile-dock .tps-gcm-time-tracker-status,
      body.is-phone .tps-gcm-time-tracker-mobile-dock .tps-gcm-time-tracker-status {
        display: flex;
        width: 100%;
        max-width: none;
        gap: 4px;
      }

      body.is-mobile .tps-gcm-time-tracker-mobile-dock .tps-gcm-time-tracker-status button,
      body.is-phone .tps-gcm-time-tracker-mobile-dock .tps-gcm-time-tracker-status button {
        min-height: 40px;
        height: 40px;
        border-radius: 8px;
      }

      body.is-mobile .tps-gcm-time-tracker-mobile-dock .tps-gcm-time-tracker-main,
      body.is-phone .tps-gcm-time-tracker-mobile-dock .tps-gcm-time-tracker-main {
        flex: 1 1 auto;
        justify-content: flex-start;
        max-width: none;
        padding: 0 10px;
        background: var(--background-secondary);
      }

      body.is-mobile .tps-gcm-time-tracker-mobile-dock .tps-gcm-time-tracker-action,
      body.is-phone .tps-gcm-time-tracker-mobile-dock .tps-gcm-time-tracker-action {
        flex: 0 0 40px;
        width: 40px;
        padding: 0;
        background: var(--background-secondary);
      }

      body.is-mobile .tps-gcm-time-tracker-mobile-dock .tps-gcm-time-tracker-icon,
      body.is-mobile .tps-gcm-time-tracker-mobile-dock .tps-gcm-time-tracker-action svg,
      body.is-phone .tps-gcm-time-tracker-mobile-dock .tps-gcm-time-tracker-icon,
      body.is-phone .tps-gcm-time-tracker-mobile-dock .tps-gcm-time-tracker-action svg {
        width: 18px;
        height: 18px;
        flex-basis: 18px;
      }

      /* Mobile gesture passthrough: the bottom nav/action shells span the viewport
         for positioning, so only their visible controls should intercept touches. */
      body.is-mobile .tps-daily-note-nav--mobile-bottom,
      body.is-phone .tps-daily-note-nav--mobile-bottom,
      body.is-mobile .tps-global-context-menu--persistent,
      body.is-phone .tps-global-context-menu--persistent,
      body.is-mobile .tps-global-context-menu--persistent .tps-gcm-panel,
      body.is-phone .tps-global-context-menu--persistent .tps-gcm-panel,
      body.is-mobile .tps-global-context-menu--persistent .tps-gcm-unified-row,
      body.is-phone .tps-global-context-menu--persistent .tps-gcm-unified-row,
      body.is-mobile .tps-global-context-menu--persistent .tps-gcm-action-bar,
      body.is-phone .tps-global-context-menu--persistent .tps-gcm-action-bar,
      body.is-mobile .tps-global-context-menu--persistent .tps-gcm-action-group,
      body.is-phone .tps-global-context-menu--persistent .tps-gcm-action-group,
      body.is-mobile .tps-global-context-menu--persistent .tps-gcm-bottom-parent-nav,
      body.is-phone .tps-global-context-menu--persistent .tps-gcm-bottom-parent-nav {
        pointer-events: none !important;
        touch-action: auto !important;
      }

      body.is-mobile .tps-daily-note-nav--mobile-bottom .tps-daily-nav-controls,
      body.is-phone .tps-daily-note-nav--mobile-bottom .tps-daily-nav-controls,
      body.is-mobile .tps-daily-note-nav--mobile-bottom button,
      body.is-phone .tps-daily-note-nav--mobile-bottom button,
      body.is-mobile .tps-scheduled-daily-note-link--mobile-bottom,
      body.is-phone .tps-scheduled-daily-note-link--mobile-bottom,
      body.is-mobile .tps-global-context-menu--persistent button,
      body.is-phone .tps-global-context-menu--persistent button,
      body.is-mobile .tps-global-context-menu--persistent .tps-gcm-action-bar .tps-gcm-chip,
      body.is-phone .tps-global-context-menu--persistent .tps-gcm-action-bar .tps-gcm-chip {
        pointer-events: auto !important;
        touch-action: auto !important;
      }

      body.is-mobile .tps-global-context-menu--persistent .tps-gcm-context-strip,
      body.is-phone .tps-global-context-menu--persistent .tps-gcm-context-strip,
      body.is-mobile .tps-global-context-menu--persistent .tps-gcm-context-strip .tps-gcm-chip,
      body.is-phone .tps-global-context-menu--persistent .tps-gcm-context-strip .tps-gcm-chip {
        pointer-events: auto !important;
        touch-action: pan-x !important;
      }

      /* Mobile native fold controls need a real touch target. Some themes keep
         the visible chevron around 15px wide and the CM fold wrapper at 0px,
         which makes heading/list collapse taps unreliable on phones. */
      body.is-mobile,
      body.is-phone {
        --folding-offset: 32px;
      }

      body.is-mobile .markdown-source-view.mod-cm6 .cm-fold-indicator,
      body.is-phone .markdown-source-view.mod-cm6 .cm-fold-indicator {
        min-width: 28px !important;
        width: 28px !important;
        margin-left: -28px !important;
        pointer-events: auto !important;
        touch-action: manipulation !important;
        z-index: 5 !important;
      }

      body.is-mobile .markdown-source-view.mod-cm6 .collapse-indicator,
      body.is-phone .markdown-source-view.mod-cm6 .collapse-indicator,
      body.is-mobile .markdown-preview-view .collapse-indicator,
      body.is-phone .markdown-preview-view .collapse-indicator,
      body.is-mobile .markdown-rendered .collapse-indicator,
      body.is-phone .markdown-rendered .collapse-indicator,
      body.is-mobile .markdown-reading-view .collapse-indicator,
      body.is-phone .markdown-reading-view .collapse-indicator {
        min-width: 28px !important;
        width: 28px !important;
        min-height: 28px !important;
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
        touch-action: manipulation !important;
        z-index: 6 !important;
      }

      .tps-home-view {
        padding: 0;
        overflow: auto;
        background: var(--background-primary);
      }

      .workspace-leaf-content[data-type="tps-home"] > .view-header {
        display: none;
      }

      .workspace-leaf-content[data-type="tps-home"] > .view-content {
        height: 100%;
        margin: 0;
        padding: 0;
        min-height: 0;
      }

      .tps-home-root {
        --tps-home-base-host-max-height: min(70vh, 680px);
        box-sizing: border-box;
        width: min(1120px, 100%);
        margin: 0 auto;
        padding: 0 18px 72px;
        color: var(--text-normal);
      }

      .tps-home-root--editing .tps-home-panel {
        outline: 1px solid color-mix(in srgb, var(--interactive-accent) 52%, transparent);
        outline-offset: -1px;
      }

      .tps-home-root--editing .tps-home-panel > :not(.tps-home-panel-heading):not(.tps-home-component-controls):not(.tps-home-resize-handle) {
        pointer-events: none;
        user-select: none;
      }

      .tps-home-header {
        position: sticky;
        top: 0;
        z-index: 20;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 0 0 14px;
        padding: 6px 0 12px;
        border-bottom: 1px solid color-mix(in srgb, var(--background-modifier-border) 70%, transparent);
        background: var(--background-primary);
        backdrop-filter: blur(12px);
        isolation: isolate;
      }

      .tps-home-header::before {
        content: "";
        position: absolute;
        inset: 0 -18px;
        z-index: -1;
        background: var(--background-primary);
        border-bottom: 1px solid color-mix(in srgb, var(--background-modifier-border) 70%, transparent);
      }

      .tps-home-title {
        display: flex;
        align-items: baseline;
        gap: 10px;
        min-width: 0;
      }

      .tps-home-title > span {
        font-size: 24px;
        font-weight: 750;
        line-height: 1.15;
      }

      .tps-home-title > small,
      .tps-home-panel-heading > small {
        color: var(--text-muted);
        font-size: 12px;
        font-weight: 600;
      }

      .tps-home-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .tps-home-icon-button,
      .tps-home-primary-button,
      .tps-home-secondary-button {
        appearance: none;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-secondary);
        color: var(--text-normal);
        min-height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        cursor: pointer;
      }

      .tps-home-icon-button {
        width: 34px;
        padding: 0;
      }

      .tps-home-add-component-button {
        width: auto;
        min-width: max-content;
        padding: 0 10px;
        border-color: color-mix(in srgb, var(--interactive-accent) 58%, var(--background-modifier-border));
        color: var(--text-accent);
        font-size: var(--font-ui-smaller);
        font-weight: 700;
      }

      .tps-home-primary-button {
        padding: 0 12px;
        font-weight: 650;
      }

      .tps-home-secondary-button {
        min-height: 30px;
        padding: 0 10px;
        font-size: 12px;
        font-weight: 650;
      }

      .tps-home-icon-button:hover,
      .tps-home-primary-button:hover,
      .tps-home-secondary-button:hover,
      .tps-home-row:hover {
        background: var(--background-modifier-hover);
      }

      .tps-home-active-timer-button {
        border-color: color-mix(in srgb, var(--interactive-accent) 64%, var(--background-modifier-border));
        color: var(--interactive-accent);
        background: color-mix(in srgb, var(--interactive-accent) 12%, var(--background-secondary));
      }

      .tps-home-active-timer-button:hover {
        background: color-mix(in srgb, var(--interactive-accent) 18%, var(--background-modifier-hover));
      }

      .tps-home-capture {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: stretch;
        padding: 11px;
      }

      .tps-home-capture-editor-shell {
        position: relative;
        min-width: 0;
      }

      .tps-home-capture-editor-shell::before {
        content: "•";
        position: absolute;
        z-index: 1;
        top: 9px;
        left: 12px;
        color: var(--text-muted);
        font-size: 1.15em;
        line-height: 1.35;
        pointer-events: none;
      }

      .tps-home-capture-editor {
        box-sizing: border-box;
        width: 100%;
        min-height: calc(var(--tps-home-capture-editor-rows, 3) * 1.45em + 20px);
        max-height: 220px;
        overflow: auto;
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
        color: var(--text-normal);
        padding: 9px 10px 9px 30px;
        font: inherit;
        line-height: 1.35;
        white-space: pre-wrap;
        outline: none;
      }

      .tps-home-capture-editor:empty::before {
        content: attr(data-placeholder);
        color: var(--text-muted);
        pointer-events: none;
      }

      .tps-home-capture-editor:focus {
        border-color: var(--interactive-accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--interactive-accent) 18%, transparent);
      }

      .tps-home-capture-tag-suggest {
        position: absolute;
        z-index: 50;
        left: 0;
        right: 0;
        top: calc(100% + 4px);
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 180px;
        overflow: auto;
        padding: 4px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-primary);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      }

      .tps-home-capture-tag-suggest-item {
        display: flex;
        flex-direction: column;
        gap: 1px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: var(--text-normal);
        text-align: left;
        padding: 5px 7px;
        font-size: var(--font-ui-small);
      }

      .tps-home-capture-tag-suggest-item:hover,
      .tps-home-capture-tag-suggest-item.is-selected {
        background: var(--background-modifier-hover);
      }

      .tps-home-capture-suggest-path {
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tps-home-capture-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: stretch;
      }

      .tps-home-capture-shortcut {
        color: var(--text-faint);
        font-size: var(--font-ui-smaller);
        text-align: center;
      }

      .tps-home-capture-actions button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .tps-home-trigger-modal blockquote {
        max-height: 180px;
        overflow: auto;
        margin: 12px 0;
        color: var(--text-muted);
        white-space: pre-wrap;
      }

      .tps-home-trigger-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .tps-home-trigger-actions button {
        min-height: 40px;
      }

      .tps-home-trigger-actions button:last-child {
        grid-column: 1 / -1;
      }

      .tps-home-native-capture {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 10px;
        align-items: stretch;
        padding: 11px;
        border-bottom: 1px solid var(--background-modifier-border);
      }

      .tps-home-native-capture-editor {
        min-width: 0;
        min-height: 132px;
        overflow: hidden;
        border: 1px solid var(--background-modifier-border);
        border-radius: var(--radius-s);
        background: var(--background-primary);
        cursor: text;
      }

      .tps-home-native-capture-textarea {
        display: block;
        width: 100%;
        height: auto;
        min-height: 44px;
        margin: 0;
        padding: 7px 9px;
        resize: none;
        overflow-x: hidden;
        overflow-y: hidden;
        border: 0;
        border-radius: inherit;
        outline: none;
        background: transparent;
        color: var(--text-normal);
        font: inherit;
        line-height: 1.4;
        box-shadow: none;
        box-sizing: border-box;
        touch-action: manipulation;
      }

      .tps-home-native-capture-textarea:focus {
        box-shadow: inset 0 0 0 1px var(--interactive-accent);
      }

      .tps-home-native-capture-editor,
      .tps-home-embedded-markdown-view .view-content,
      .tps-home-embedded-markdown-view .markdown-source-view,
      .tps-home-embedded-markdown-view .cm-editor,
      .tps-home-embedded-markdown-view .cm-scroller,
      .tps-home-embedded-markdown-view .cm-content,
      .tps-home-embedded-markdown-view .cm-contentContainer {
        pointer-events: auto;
        touch-action: manipulation;
      }

      .tps-home-native-capture > .tps-home-capture-actions {
        width: 100%;
      }

      .tps-home-native-capture > .tps-home-capture-actions button {
        width: 100%;
        min-height: 42px;
      }

      .tps-home-embedded-markdown-view,
      .tps-home-embedded-markdown-view .view-content,
      .tps-home-embedded-markdown-view .markdown-source-view {
        height: 100%;
        min-height: 130px;
      }

      .tps-home-embedded-markdown-view .view-header,
      .tps-home-embedded-markdown-view .view-footer,
      .tps-home-embedded-markdown-view .inline-title,
      .tps-home-embedded-markdown-view .metadata-container {
        display: none;
      }

      .tps-home-embedded-markdown-view .view-content {
        padding: 0;
      }

      .tps-home-embedded-markdown-view .cm-editor,
      .tps-home-embedded-markdown-view .cm-scroller {
        min-height: 130px;
      }

      .tps-home-embedded-markdown-view .cm-sizer,
      .tps-home-embedded-markdown-view .cm-contentContainer,
      .tps-home-embedded-markdown-view .cm-content {
        min-height: 100%;
        box-sizing: border-box;
      }

      .tps-home-embedded-markdown-view .cm-contentContainer {
        padding-block: 8px;
      }

      .tps-home-embedded-markdown-view .tps-home-capture-hidden-source-line {
        display: none !important;
        min-height: 0 !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      .tps-home-daily-note-load-line {
        cursor: text;
        border-radius: var(--radius-s);
      }

      .tps-home-daily-note-load-line:hover {
        background: var(--background-modifier-hover);
      }

      .tps-home-component-quick-capture {
        display: flex;
        flex-direction: column;
        height: var(--tps-home-panel-height, var(--tps-home-base-host-max-height));
        max-height: var(--tps-home-panel-height, var(--tps-home-base-host-max-height));
        min-height: min(420px, var(--tps-home-base-host-max-height));
      }

      .tps-home-component-quick-capture.tps-home-panel--custom-preview-height:not(.tps-home-panel--custom-height) {
        height: auto;
        max-height: none;
      }

      .tps-home-component-quick-capture .tps-home-capture {
        flex: 0 0 auto;
        border-bottom: 1px solid var(--background-modifier-border);
      }

      .tps-home-capture-draft-launcher {
        align-items: center;
        border-bottom: 1px solid var(--background-modifier-border);
        display: flex;
        gap: 12px;
        justify-content: space-between;
        padding: 12px;
      }

      .tps-home-capture-draft-copy {
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        line-height: 1.35;
        max-width: 52ch;
      }

      .tps-home-capture-draft-launcher button {
        align-items: center;
        display: inline-flex;
        flex: 0 0 auto;
        gap: 7px;
        min-height: 38px;
      }

      body.is-mobile .tps-home-capture-draft-launcher,
      body.is-phone .tps-home-capture-draft-launcher {
        align-items: stretch;
        flex-direction: column;
      }

      .tps-home-capture--modal {
        grid-template-columns: minmax(0, 1fr);
        padding: 0;
      }

      .tps-home-capture--modal .tps-home-capture-actions {
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
      }

      .tps-home-capture--modal .tps-home-capture-shortcut {
        margin-left: auto;
      }

      .tps-home-capture-live-preview {
        display: grid;
        grid-template-columns: 72px minmax(0, 1fr);
        align-items: start;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-secondary);
      }

      .tps-home-capture-live-preview.is-empty {
        display: none;
      }

      .tps-home-capture-live-preview-label {
        padding-top: 2px;
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        font-weight: 650;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .tps-home-capture-live-preview-body {
        min-width: 0;
        color: var(--text-normal);
        line-height: 1.5;
      }

      .tps-home-capture-live-preview-body > :first-child {
        margin-top: 0;
      }

      .tps-home-capture-live-preview-body > :last-child {
        margin-bottom: 0;
      }

      .tps-home-capture-live-preview-body ul {
        margin: 0;
        padding-inline-start: 1.4em;
      }

      .tps-home-capture-live-preview-body li {
        padding-inline-start: 0.2em;
      }

      .tps-home-capture-live-preview-body li::marker {
        color: var(--text-muted);
        font-size: 1.05em;
      }

      .tps-home-capture-live-preview-body .tag {
        border: 1px solid color-mix(in srgb, var(--interactive-accent) 34%, transparent);
        border-radius: 999px;
        padding: 1px 6px;
        background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
        color: var(--interactive-accent);
        font-size: 0.92em;
        text-decoration: none;
      }

      .tps-home-capture-live-preview-body em {
        color: color-mix(in srgb, var(--text-normal) 86%, var(--interactive-accent));
      }

      .tps-home-capture-live-preview-body strong {
        color: var(--text-normal);
        font-weight: 700;
      }

      .tps-home-capture-live-preview-body .internal-link,
      .tps-home-capture-live-preview-body .external-link {
        color: var(--link-color);
        text-decoration-line: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: 2px;
      }

      .tps-home-capture-live-preview-body code {
        border: 1px solid var(--background-modifier-border);
        border-radius: 4px;
        padding: 1px 4px;
        background: var(--background-primary);
        color: var(--text-accent);
      }

      .tps-home-capture-modal {
        height: min(var(--tps-gcm-modal-max-height), calc(100vh - 32px));
      }

      .tps-home-capture-modal .modal-content {
        height: 100%;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .tps-home-capture-modal-layout {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
        flex: 1 1 auto;
      }

      .tps-home-capture-preview {
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex: 1 1 auto;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-secondary);
      }

      .tps-home-capture-preview-header {
        flex: 0 0 auto;
        padding: 8px 10px;
        border-bottom: 1px solid var(--background-modifier-border);
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        font-weight: 600;
      }

      .tps-home-capture-preview-body {
        flex: 1 1 auto;
        min-height: 120px;
        overflow: auto;
        padding: 10px 14px;
        -webkit-overflow-scrolling: touch;
      }

      .tps-home-capture-preview--home {
        flex: 1 1 auto;
        min-height: 0;
        border: 0;
        border-radius: 0;
        background: var(--background-primary);
      }

      .tps-home-panel--custom-preview-height .tps-home-capture-preview--home {
        flex: 0 0 var(--tps-home-capture-preview-height);
        height: var(--tps-home-capture-preview-height);
      }

      .tps-home-capture-preview--home .tps-home-capture-preview-body {
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
        touch-action: pan-y;
        -webkit-overflow-scrolling: touch;
        scrollbar-gutter: stable;
        scrollbar-width: thin;
      }

      .tps-home-capture-preview-loading,
      .tps-home-capture-preview-error {
        color: var(--text-muted);
        font-size: var(--font-ui-small);
      }

      .tps-home-capture-preview-body .tps-home-workout-log-item {
        list-style: none;
        margin: 7px 0;
        padding: 0;
      }

      .tps-home-capture-preview-body .tps-home-workout-log-item::marker {
        content: "";
      }

      .tps-home-workout-card {
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr) 30px;
        align-items: center;
        gap: 9px;
        width: min(100%, 520px);
        padding: 8px 9px;
        border: 1px solid color-mix(in srgb, var(--interactive-accent) 24%, var(--background-modifier-border));
        border-radius: 7px;
        background: color-mix(in srgb, var(--background-secondary-alt) 86%, var(--interactive-accent) 14%);
      }

      .tps-home-workout-card.is-abandoned {
        border-color: var(--background-modifier-border);
        background: var(--background-secondary);
        opacity: 0.72;
      }

      .tps-home-workout-card.is-abandoned .tps-home-workout-card-icon {
        background: var(--background-modifier-hover);
        color: var(--text-muted);
      }

      .tps-home-workout-card-meta > .tps-home-workout-card-status {
        color: var(--text-muted);
        border-style: dashed;
      }

      .tps-home-workout-card-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border-radius: 6px;
        background: color-mix(in srgb, var(--interactive-accent) 20%, transparent);
        color: var(--interactive-accent);
      }

      .tps-home-workout-card-icon svg {
        width: 16px;
        height: 16px;
      }

      .tps-home-workout-card-main {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .tps-home-workout-card-title {
        all: unset;
        display: block;
        min-width: 0;
        color: var(--text-normal);
        font-size: 13px;
        font-weight: 750;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
      }

      .tps-home-workout-card-title:hover {
        color: var(--text-accent);
      }

      .tps-home-workout-card-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        min-width: 0;
      }

      .tps-home-workout-card-meta > span {
        min-width: 0;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 2px 6px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 999px;
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 650;
        line-height: 1.2;
      }

      .tps-home-workout-card-open {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border-radius: 6px;
      }

      .tps-home-workout-card-open svg {
        width: 15px;
        height: 15px;
      }

      .tps-home-command {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 11px;
      }

      .tps-home-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        align-items: start;
      }

      .tps-home-panel {
        position: relative;
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: var(--tps-home-panel-min-height, auto);
        height: var(--tps-home-panel-height, auto);
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: var(--background-secondary);
        overflow: hidden;
      }

      .tps-home-panel--wide {
        grid-column: 1 / -1;
      }

      .tps-home-panel-heading {
        min-height: 38px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 11px;
        border-bottom: 1px solid var(--background-modifier-border);
        font-size: 13px;
        font-weight: 750;
      }

      .tps-home-panel-heading > small {
        margin-left: auto;
      }

      .tps-home-panel-file {
        overflow: hidden;
        max-width: min(48%, 320px);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tps-home-panel-action {
        appearance: none;
        margin-left: auto;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--interactive-normal);
        color: var(--text-normal);
        min-height: 28px;
        padding: 0 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: var(--font-ui-small);
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
        white-space: nowrap;
      }

      .tps-home-panel-action:hover,
      .tps-home-panel-action:focus-visible {
        background: var(--interactive-hover);
        outline: none;
      }

      .tps-home-panel-action-icon,
      .tps-home-panel-action-icon svg {
        width: 14px;
        height: 14px;
        flex: 0 0 14px;
      }

      .tps-home-component-controls {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        border-bottom: 1px solid var(--background-modifier-border);
        background: var(--background-primary-alt);
      }

      .tps-home-component-base-button {
        height: auto;
        max-width: 100%;
        min-width: 0;
        white-space: normal;
      }

      .tps-home-component-controls button:focus-visible {
        border-color: var(--interactive-accent);
        outline: 2px solid color-mix(in srgb, var(--interactive-accent) 68%, transparent);
        outline-offset: 1px;
      }

      .tps-home-calendar-today-button {
        appearance: none;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-primary);
        color: var(--text-normal);
        min-height: 26px;
        padding: 0 9px;
        font-size: 11px;
        font-weight: 750;
        cursor: pointer;
      }

      .tps-home-calendar-today-button:hover {
        background: var(--background-modifier-hover);
      }

      .tps-home-calendar-today-button.is-selected-date-today,
      .tps-home-calendar-today-button.is-selected-date-today:hover {
        border-color: var(--interactive-accent);
        background: var(--interactive-accent);
        color: var(--text-on-accent);
      }

      .tps-home-component-controls .tps-home-icon-button {
        width: 26px;
        min-height: 26px;
        opacity: 0.75;
      }

      .tps-home-component-controls .tps-home-icon-button:hover {
        opacity: 1;
      }

      .tps-home-resize-handle {
        color: var(--text-muted);
        background: color-mix(in srgb, var(--background-primary-alt) 86%, transparent);
        border: 1px solid var(--background-modifier-border);
        display: flex;
        align-items: center;
        justify-content: center;
        touch-action: none;
        z-index: 3;
      }

      .tps-home-resize-handle:hover,
      .tps-home-resize-handle:focus-visible {
        color: var(--text-normal);
        border-color: var(--interactive-accent);
        background: var(--background-modifier-hover);
        outline: none;
      }

      .tps-home-resize-handle svg {
        width: 14px;
        height: 14px;
      }

      .tps-home-resize-handle--corner {
        flex: 0 0 18px;
        min-height: 18px;
        cursor: ns-resize;
        border-width: 1px 0 0;
        border-radius: 0;
      }

      .tps-home-resize-handle--horizontal {
        flex: 0 0 18px;
        min-height: 18px;
        cursor: ns-resize;
        border-width: 1px 0;
        border-radius: 0;
      }

      .tps-home-panel-icon,
      .tps-home-panel-icon svg,
      .tps-home-icon-button svg,
      .tps-home-primary-button svg,
      .tps-home-secondary-button svg {
        width: 15px;
        height: 15px;
        flex: 0 0 15px;
      }

      .tps-home-list {
        display: flex;
        flex-direction: column;
      }

      .tps-home-base-host,
      .tps-home-calendar-base-host {
        display: block;
        width: 100%;
        flex: 1 1 auto;
        min-height: 0;
        height: auto;
        max-height: var(--tps-home-base-host-max-height);
        overflow: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        scrollbar-gutter: stable;
        scrollbar-width: thin;
        touch-action: pan-x pan-y;
        background: var(--background-primary);
      }

      .tps-home-base-viewport {
        position: relative;
        isolation: isolate;
        contain: layout paint;
        overflow: auto !important;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-x pan-y;
      }

      .tps-home-scroll-host {
        cursor: auto;
        overflow: auto;
        overscroll-behavior: contain;
      }

      .tps-home-base-host {
        min-height: 220px;
      }

      .tps-home-component-food-tracker .tps-home-base-host {
        min-height: min(230px, var(--tps-home-base-host-max-height));
        overflow: auto;
        cursor: auto;
      }

      .tps-home-component-food-tracker .tps-log-base-table {
        --tps-log-base-table-width: 100%;
        width: 100% !important;
        min-width: 0 !important;
        max-width: 100% !important;
        table-layout: fixed;
      }

      .tps-home-component-food-tracker .tps-log-base-table th,
      .tps-home-component-food-tracker .tps-log-base-table td {
        width: auto !important;
        min-width: 0 !important;
        padding-left: 4px;
        padding-right: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tps-home-component-food-tracker .tps-log-base-table th:first-child,
      .tps-home-component-food-tracker .tps-log-base-table td:first-child {
        width: 52% !important;
      }

      .tps-home-component-food-tracker .tps-log-base-table col:first-child {
        width: 52% !important;
      }

      .tps-home-component-food-tracker .tps-log-base-table th:not(:first-child),
      .tps-home-component-food-tracker .tps-log-base-table td:not(:first-child),
      .tps-home-component-food-tracker .tps-log-base-table col:not(:first-child) {
        width: 12% !important;
        text-align: right;
      }

      .tps-home-component-food-tracker .tps-log-base-column-resize {
        display: none;
      }

      .tps-home-component-workout-tracker .bases-header,
      .tps-home-component-workout-tracker .bases-toolbar,
      .tps-home-component-workout-tracker .bases-view-header,
      .tps-home-component-workout-tracker .base-view-header,
      .tps-home-component-workout-tracker .view-header {
        display: none !important;
      }

      .tps-home-component-workout-tracker .tps-home-base-host.is-tps-home-workout-empty {
        display: none;
      }

      .tps-home-workout-empty {
        min-height: 180px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 24px;
        text-align: center;
        background: var(--background-primary);
      }

      .tps-home-workout-empty-icon {
        width: 34px;
        height: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        color: var(--text-muted);
        background: var(--background-secondary);
      }

      .tps-home-workout-empty-icon svg {
        width: 17px;
        height: 17px;
      }

      .tps-home-workout-empty-title {
        color: var(--text-normal);
        font-size: var(--font-ui-small);
        font-weight: 750;
      }

      .tps-home-workout-empty-copy {
        max-width: 280px;
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        line-height: 1.4;
      }

      .tps-home-base-host .tps-log-base {
        height: auto;
        max-height: var(--tps-home-base-host-max-height);
      }

      .tps-home-base-host .tps-log-base-table-scroll {
        flex: 0 1 auto;
        max-height: var(--tps-home-base-host-max-height);
      }

      .tps-home-component-food-tracker .tps-log-base {
        min-height: 0;
      }

      .tps-home-component-food-tracker .tps-log-base-table-scroll {
        max-height: var(--tps-home-base-host-max-height);
        overflow: auto !important;
        -webkit-overflow-scrolling: touch;
      }

      .tps-home-calendar-base-host {
        min-height: min(520px, var(--tps-home-base-host-max-height));
      }

      .tps-home-panel--custom-height .tps-home-base-host,
      .tps-home-panel--custom-height .tps-home-calendar-base-host {
        flex: 1 1 0;
        height: 0;
        min-height: 0;
        max-height: none;
      }

      .tps-home-panel--custom-height .tps-home-base-host .tps-log-base {
        height: 100%;
        max-height: none;
      }

      .tps-home-panel--custom-height .tps-home-base-host .tps-log-base-table-scroll {
        flex: 1 1 auto;
        max-height: none;
      }

      .tps-home-base-viewport .tps-log-base,
      .tps-home-base-viewport .tps-log-base-table-scroll {
        height: auto;
        max-height: none;
      }

.tps-home-base-viewport .tps-log-base-table-scroll {
  overflow: visible !important;
}

.tps-home-component-food-tracker .tps-home-base-viewport .tps-log-base-table-scroll {
  max-height: none;
  overflow: visible !important;
  -webkit-overflow-scrolling: auto;
}

      .tps-home-panel--custom-height .tps-home-command {
        flex: 1 1 auto;
      }

      .tps-home-base-host > .internal-embed,
      .tps-home-base-host > .markdown-embed,
      .tps-home-base-host .markdown-embed-content,
      .tps-home-base-host .markdown-preview-view,
      .tps-home-base-host .markdown-preview-sizer,
      .tps-home-base-host .markdown-preview-section,
      .tps-home-calendar-base-host > .internal-embed,
      .tps-home-calendar-base-host > .markdown-embed,
      .tps-home-calendar-base-host .markdown-embed-content,
      .tps-home-calendar-base-host .markdown-preview-view,
      .tps-home-calendar-base-host .markdown-preview-sizer,
      .tps-home-calendar-base-host .markdown-preview-section {
        box-sizing: border-box;
        width: 100% !important;
        max-width: 100% !important;
        min-height: 0 !important;
        margin: 0 !important;
        overflow: visible !important;
      }

      .tps-home-calendar-base-host .bases-calendar-scroll--embedded,
      .tps-home-calendar-base-host .bases-calendar-container--embedded,
      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded {
        width: 100% !important;
        max-width: 100% !important;
      }

      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded {
        --tps-embed-axis-width: 64px;
      }

      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded .fc .fc-scrollgrid,
      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded .fc .fc-scrollgrid table {
        width: 100% !important;
        table-layout: fixed !important;
      }

      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded .fc .fc-scrollgrid > colgroup > col:first-child,
      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded .fc .fc-scrollgrid table > colgroup > col:first-child,
      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded .fc .fc-scrollgrid tr > :first-child {
        width: var(--tps-embed-axis-width) !important;
        min-width: var(--tps-embed-axis-width) !important;
        max-width: var(--tps-embed-axis-width) !important;
        box-sizing: border-box !important;
      }

      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded .fc .fc-timegrid-slot-label-cushion {
        display: block !important;
        padding-inline: 8px !important;
        text-align: end !important;
      }

      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded .fc .fc-timegrid-axis,
      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded .fc col.fc-timegrid-axis-col,
      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded .fc col.fc-scrollgrid-shrink,
      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded .fc .fc-scrollgrid-shrink,
      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded .fc th.fc-timegrid-axis,
      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded .fc td.fc-timegrid-axis,
      .tps-home-calendar-base-host .bases-calendar-wrapper.bases-calendar-embedded .fc .fc-timegrid-slot-label {
        width: var(--tps-embed-axis-width) !important;
        min-width: var(--tps-embed-axis-width) !important;
        max-width: var(--tps-embed-axis-width) !important;
        overflow: hidden !important;
      }

      .tps-home-base-host .markdown-embed-title,
      .tps-home-base-host .markdown-embed-link,
      .tps-home-calendar-base-host .markdown-embed-title,
      .tps-home-calendar-base-host .markdown-embed-link {
        display: none !important;
      }

      .tps-home-base-host .bases-header,
      .tps-home-base-host .bases-toolbar,
      .tps-home-calendar-base-host .bases-header,
      .tps-home-calendar-base-host .bases-toolbar {
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
      }

      .tps-home-component-food-tracker .tps-health-food-log-base {
        gap: 8px;
        min-height: 0;
        height: auto;
        padding: 9px;
        overflow: visible;
        background: var(--background-primary);
      }

      .tps-home-component-food-tracker .bases-header,
      .tps-home-component-food-tracker .bases-toolbar,
      .tps-home-component-food-tracker .bases-view-header,
      .tps-home-component-food-tracker .base-view-header,
      .tps-home-component-food-tracker .view-header {
        display: none !important;
      }

      .tps-home-component-food-tracker .tps-health-food-log-toolbar {
        display: none !important;
      }

      .tps-home-component-food-tracker .tps-health-food-log-summary {
        display: none !important;
        align-items: center;
        justify-content: flex-start;
        gap: 8px 10px;
        flex-wrap: wrap;
        margin: 0;
        padding: 8px 10px;
        border-radius: 6px;
        background: color-mix(in srgb, var(--background-secondary) 74%, var(--background-primary));
      }

      .tps-home-component-food-tracker .tps-health-food-log-summary-count {
        flex: 0 0 auto;
        min-width: 0;
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        font-weight: 750;
        line-height: 1.2;
      }

      .tps-home-component-food-tracker .tps-health-food-log-summary-macros,
      .tps-home-component-food-tracker .tps-health-food-log-day-macros,
      .tps-home-component-food-tracker .tps-health-food-log-entry-macros {
        gap: 5px;
      }

      .tps-home-component-food-tracker .tps-health-macro-pill {
        min-height: 22px;
        padding: 1px 7px;
        font-size: 12px;
        line-height: 18px;
      }

      .tps-home-component-food-tracker .tps-health-food-log-day {
        border-radius: 6px;
        background: var(--background-primary);
      }

      .tps-home-component-food-tracker .tps-health-food-log-day-header {
        gap: 8px;
        padding: 8px 10px;
        background: color-mix(in srgb, var(--background-secondary) 68%, var(--background-primary));
      }

      .tps-home-component-food-tracker .tps-health-food-log-day-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        line-height: 1.2;
      }

      .tps-home-component-food-tracker .tps-health-food-log-day-meta {
        min-width: 0;
        gap: 6px;
        flex: 1 1 auto;
        justify-content: flex-end;
      }

      .tps-home-component-food-tracker .tps-health-food-log-day-meta > span {
        display: none;
      }

      .tps-home-component-food-tracker .tps-health-food-log-entry {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
          "main actions"
          "macros actions";
        align-items: center;
        gap: 5px 10px;
        min-height: 0;
        padding: 9px 10px;
      }

      .tps-home-component-food-tracker .tps-health-food-log-entry-main {
        grid-area: main;
        min-width: 0;
        flex-basis: auto;
      }

      .tps-home-component-food-tracker .tps-health-food-log-entry-title {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 7px;
        align-items: center;
      }

      .tps-home-component-food-tracker .tps-health-food-log-entry-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        line-height: 1.25;
      }

      .tps-home-component-food-tracker .tps-health-food-log-entry-serving {
        max-width: 108px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 1px 7px;
        font-size: 11px;
      }

      .tps-home-component-food-tracker .tps-health-food-log-entry-source {
        display: none;
      }

      .tps-home-component-food-tracker .tps-health-food-log-entry-macros {
        grid-area: macros;
        justify-content: flex-start;
        min-width: 0;
      }

      .tps-home-component-food-tracker .tps-health-food-log-entry-actions {
        grid-area: actions;
        display: grid;
        grid-template-columns: repeat(2, 44px);
        gap: 5px;
        justify-content: end;
      }

      .tps-home-component-food-tracker .tps-health-food-log-entry-action {
        min-height: 26px;
        height: 26px;
        padding: 0 6px;
        border-radius: 5px;
        font-size: 11px;
        font-weight: 650;
        line-height: 1;
      }

      .tps-home-row {
        min-height: 45px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 11px;
        border-bottom: 1px solid color-mix(in srgb, var(--background-modifier-border) 70%, transparent);
        cursor: pointer;
      }

      .tps-home-food-row {
        min-height: 48px;
      }

      .tps-home-row:last-child {
        border-bottom: 0;
      }

      .tps-home-task-row {
        align-items: flex-start;
        padding-top: 9px;
        padding-bottom: 9px;
      }

      .tps-home-task-checkbox {
        width: 16px;
        min-width: 16px;
        height: 16px;
        margin: 3px 4px 0 1px;
        padding: 0;
        accent-color: var(--checkbox-color, var(--interactive-accent));
        cursor: pointer;
      }

      .tps-home-task-checkbox:focus-visible {
        outline: 2px solid var(--background-modifier-border-focus);
        outline-offset: 2px;
      }

      .tps-home-row-main {
        min-width: 0;
        flex: 1 1 auto;
      }

      .tps-home-row-action {
        flex: 0 0 28px;
        width: 28px;
        height: 26px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid color-mix(in srgb, var(--background-modifier-border) 70%, transparent);
        border-radius: 6px;
        padding: 0;
        color: var(--text-muted);
        background: var(--background-primary);
        cursor: pointer;
      }

      .tps-home-row-action:hover {
        color: var(--text-normal);
        background: var(--background-modifier-hover);
      }

      .tps-home-row-action svg {
        width: 15px;
        height: 15px;
      }

      .tps-home-row-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        font-weight: 650;
      }

      .tps-home-row-detail,
      .tps-home-empty {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--text-muted);
        font-size: 11px;
        line-height: 1.45;
      }

      .tps-home-empty {
        padding: 14px 11px;
      }

      .tps-home-row-time {
        flex: 0 0 auto;
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 700;
      }

      .tps-home-food-summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        padding: 11px;
        border-bottom: 1px solid var(--background-modifier-border);
      }

      .tps-home-food-metric {
        min-width: 0;
        border: 1px solid color-mix(in srgb, var(--background-modifier-border) 70%, transparent);
        border-radius: 6px;
        padding: 7px 8px;
        background: var(--background-primary);
      }

      .tps-home-food-metric > span {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
        font-weight: 750;
      }

      .tps-home-food-metric > small {
        color: var(--text-muted);
        font-size: 10px;
        font-weight: 650;
        text-transform: uppercase;
      }

      .tps-home-inline-actions {
        display: flex;
        gap: 8px;
        padding: 9px 11px;
        border-bottom: 1px solid var(--background-modifier-border);
      }

      .tps-home-food-row-metrics {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 650;
      }

      body.is-mobile .tps-home-root,
      body.is-phone .tps-home-root {
        --tps-home-base-host-max-height: 68vh;
        padding: 0 12px 72px;
      }

      body.is-mobile .tps-home-component-controls,
      body.is-phone .tps-home-component-controls {
        flex-wrap: wrap;
        gap: 6px;
        padding: 8px;
      }

      body.is-mobile .tps-home-component-base-button,
      body.is-phone .tps-home-component-base-button {
        flex: 1 1 100%;
        min-width: 0;
        min-height: 40px;
        height: auto;
        justify-content: flex-start;
        padding: 6px 10px;
        text-align: left;
      }

      body.is-mobile .tps-home-component-controls .tps-home-icon-button,
      body.is-phone .tps-home-component-controls .tps-home-icon-button {
        flex: 0 0 40px;
        width: 40px;
        min-height: 40px;
        opacity: 1;
      }

      body.is-mobile .tps-home-header,
      body.is-phone .tps-home-header {
        align-items: flex-start;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 7px 10px;
        margin: 0 0 12px;
        padding: 8px 0 10px;
      }

      body.is-mobile .tps-home-header::before,
      body.is-phone .tps-home-header::before {
        inset: 0 -12px;
      }

      body.is-mobile .tps-home-actions,
      body.is-phone .tps-home-actions {
        position: static;
        flex: 1 1 100%;
        max-width: 100%;
        min-width: 0;
        overflow-x: auto;
        padding: 2px 0 0;
        border: 0;
        background: transparent;
        box-shadow: none;
        transform: none;
        opacity: 1;
        scrollbar-width: none;
      }

      body.is-mobile .tps-home-actions::-webkit-scrollbar,
      body.is-phone .tps-home-actions::-webkit-scrollbar {
        display: none;
      }

      body.is-mobile .tps-home-actions .tps-home-icon-button,
      body.is-phone .tps-home-actions .tps-home-icon-button {
        border-radius: 999px;
        background: var(--background-primary);
      }

      body.is-mobile .tps-home-actions .tps-home-calendar-today-button,
      body.is-phone .tps-home-actions .tps-home-calendar-today-button {
        min-height: 32px;
        border-radius: 999px;
        padding: 0 13px;
      }

      body.is-mobile .tps-home-grid,
      body.is-phone .tps-home-grid {
        grid-template-columns: 1fr;
      }

      body.is-mobile .tps-home-calendar-base-host,
      body.is-phone .tps-home-calendar-base-host {
        min-height: min(520px, var(--tps-home-base-host-max-height));
      }

      body.is-mobile .tps-home-component-food-tracker .tps-home-base-host,
      body.is-phone .tps-home-component-food-tracker .tps-home-base-host {
        min-height: min(320px, var(--tps-home-base-host-max-height));
        overflow: auto;
      }

      body.is-mobile .tps-home-capture,
      body.is-phone .tps-home-capture {
        grid-template-columns: 1fr;
      }

      body.is-mobile .tps-home-native-capture,
      body.is-phone .tps-home-native-capture {
        gap: 7px;
        padding: 8px;
      }

      body.is-mobile .tps-home-native-capture-editor,
      body.is-phone .tps-home-native-capture-editor {
        min-height: 76px;
        height: 76px;
        max-height: 96px;
      }

      body.is-mobile .tps-home-native-capture-textarea,
      body.is-phone .tps-home-native-capture-textarea {
        font-size: 16px;
        min-height: calc(1.4em + 12px);
        padding: 6px 8px;
        line-height: 1.4;
        overflow: clip;
      }

      body.is-mobile .tps-home-native-capture-editor--mobile,
      body.is-phone .tps-home-native-capture-editor--mobile {
        display: block;
        min-height: 0;
        height: auto;
        max-height: none;
        padding: 0;
        overflow: clip;
      }

      body.is-mobile .tps-home-embedded-markdown-view,
      body.is-phone .tps-home-embedded-markdown-view,
      body.is-mobile .tps-home-embedded-markdown-view .view-content,
      body.is-phone .tps-home-embedded-markdown-view .view-content,
      body.is-mobile .tps-home-embedded-markdown-view .markdown-source-view,
      body.is-phone .tps-home-embedded-markdown-view .markdown-source-view,
      body.is-mobile .tps-home-embedded-markdown-view .cm-editor,
      body.is-phone .tps-home-embedded-markdown-view .cm-editor,
      body.is-mobile .tps-home-embedded-markdown-view .cm-scroller,
      body.is-phone .tps-home-embedded-markdown-view .cm-scroller {
        min-height: 74px;
        height: 100%;
      }

      body.is-mobile .tps-home-embedded-markdown-view .cm-contentContainer,
      body.is-phone .tps-home-embedded-markdown-view .cm-contentContainer {
        padding-block: 3px;
      }

      body.is-mobile .tps-home-native-capture > .tps-home-capture-actions,
      body.is-phone .tps-home-native-capture > .tps-home-capture-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px;
      }

      body.is-mobile .tps-home-native-capture > .tps-home-capture-actions button,
      body.is-phone .tps-home-native-capture > .tps-home-capture-actions button {
        min-height: 40px;
        padding: 6px 8px;
      }

      body.is-mobile .tps-home-native-capture .tps-home-capture-shortcut,
      body.is-phone .tps-home-native-capture .tps-home-capture-shortcut {
        display: none;
      }

      body.is-mobile .tps-home-trigger-actions,
      body.is-phone .tps-home-trigger-actions {
        grid-template-columns: 1fr;
      }

      body.is-mobile .tps-home-trigger-actions button:last-child,
      body.is-phone .tps-home-trigger-actions button:last-child {
        grid-column: auto;
      }

      body.is-mobile .tps-home-capture-live-preview,
      body.is-phone .tps-home-capture-live-preview {
        grid-template-columns: 1fr;
        gap: 5px;
      }

      body.is-mobile .tps-home-capture--modal .tps-home-capture-actions,
      body.is-phone .tps-home-capture--modal .tps-home-capture-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      body.is-mobile .tps-home-capture--modal .tps-home-capture-shortcut,
      body.is-phone .tps-home-capture--modal .tps-home-capture-shortcut {
        grid-column: 1 / -1;
        margin-left: 0;
      }

      body.is-mobile .tps-home-food-summary,
      body.is-phone .tps-home-food-summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      body.is-mobile .tps-home-component-food-tracker .tps-health-food-log-entry,
      body.is-phone .tps-home-component-food-tracker .tps-health-food-log-entry {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas:
          "main"
          "macros"
          "actions";
      }

      body.is-mobile .tps-home-component-food-tracker .tps-health-food-log-entry-actions,
      body.is-phone .tps-home-component-food-tracker .tps-health-food-log-entry-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-start;
      }

      body.is-mobile .tps-home-component-food-tracker .tps-health-food-log-entry-action,
      body.is-phone .tps-home-component-food-tracker .tps-health-food-log-entry-action {
        min-width: 58px;
      }

      body.tps-gcm-hide-completed-checkboxes .markdown-preview-view li.task-list-item.tps-gcm-mapped-completed-task,
      body.tps-gcm-hide-completed-checkboxes .markdown-rendered li.task-list-item.tps-gcm-mapped-completed-task,
      body.tps-gcm-hide-completed-checkboxes .markdown-reading-view li.task-list-item.tps-gcm-mapped-completed-task {
        display: none !important;
      }

      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-preview-view li.task-list-item[data-task],
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-preview-view li.task-list-item,
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-rendered li.task-list-item[data-task],
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-rendered li.task-list-item,
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-reading-view li.task-list-item[data-task],
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-reading-view li.task-list-item {
        display: none !important;
      }

      body.tps-gcm-hide-completed-checkboxes .markdown-preview-view.tps-gcm-task-hiding-excluded li.task-list-item.tps-gcm-mapped-completed-task,
      body.tps-gcm-hide-completed-checkboxes .markdown-rendered.tps-gcm-task-hiding-excluded li.task-list-item.tps-gcm-mapped-completed-task,
      body.tps-gcm-hide-completed-checkboxes .markdown-reading-view.tps-gcm-task-hiding-excluded li.task-list-item.tps-gcm-mapped-completed-task,
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-preview-view.tps-gcm-task-hiding-excluded li.task-list-item[data-task],
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-preview-view.tps-gcm-task-hiding-excluded li.task-list-item,
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-rendered.tps-gcm-task-hiding-excluded li.task-list-item[data-task],
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-rendered.tps-gcm-task-hiding-excluded li.task-list-item,
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-reading-view.tps-gcm-task-hiding-excluded li.task-list-item[data-task],
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-reading-view.tps-gcm-task-hiding-excluded li.task-list-item {
        display: list-item !important;
      }

      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-preview-view.tps-gcm-completed-checkboxes-revealed li.task-list-item[data-task],
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-preview-view.tps-gcm-completed-checkboxes-revealed li.task-list-item,
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-rendered.tps-gcm-completed-checkboxes-revealed li.task-list-item[data-task],
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-rendered.tps-gcm-completed-checkboxes-revealed li.task-list-item,
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-reading-view.tps-gcm-completed-checkboxes-revealed li.task-list-item[data-task],
      body.tps-gcm-hide-all-task-lines-reading-mode .markdown-reading-view.tps-gcm-completed-checkboxes-revealed li.task-list-item {
        display: list-item !important;
      }

      body.tps-gcm-hide-completed-checkboxes .markdown-preview-view.tps-gcm-completed-checkboxes-revealed li.task-list-item.tps-gcm-mapped-completed-task,
      body.tps-gcm-hide-completed-checkboxes .markdown-rendered.tps-gcm-completed-checkboxes-revealed li.task-list-item.tps-gcm-mapped-completed-task,
      body.tps-gcm-hide-completed-checkboxes .markdown-reading-view.tps-gcm-completed-checkboxes-revealed li.task-list-item.tps-gcm-mapped-completed-task {
        display: list-item !important;
      }

      body.tps-gcm-hide-completed-checkboxes .markdown-source-view.mod-cm6:not(.is-source-mode) .cm-line.tps-gcm-hidden-completed-checkbox-line {
        min-height: 0 !important;
        height: 0 !important;
        max-height: 0 !important;
        padding-top: 0 !important;
        padding-bottom: 0 !important;
        margin-top: 0 !important;
        margin-bottom: 0 !important;
        overflow: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      .markdown-source-view.mod-cm6:not(.is-source-mode) .cm-line.tps-gcm-hidden-completed-checkbox-line {
        min-height: 0 !important;
        height: 0 !important;
        max-height: 0 !important;
        padding-top: 0 !important;
        padding-bottom: 0 !important;
        margin-top: 0 !important;
        margin-bottom: 0 !important;
        overflow: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      body.tps-gcm-hide-completed-checkboxes .markdown-source-view.mod-cm6:not(.is-source-mode).tps-gcm-completed-checkboxes-revealed .cm-line.tps-gcm-hidden-completed-checkbox-line {
        min-height: revert !important;
        height: revert !important;
        max-height: revert !important;
        padding-top: revert !important;
        padding-bottom: revert !important;
        margin-top: revert !important;
        margin-bottom: revert !important;
        overflow: revert !important;
        opacity: revert !important;
        pointer-events: revert !important;
      }

      .markdown-source-view.mod-cm6.is-live-preview {
        position: relative;
      }

      .markdown-source-view.mod-cm6.is-live-preview.tps-gcm-completed-checkboxes-has-reveal .inline-title,
      .markdown-source-view.mod-cm6.is-live-preview.tps-gcm-completed-checkboxes-has-reveal .cm-line.inline-title {
        box-sizing: border-box;
        padding-right: 128px;
      }

      .markdown-preview-view.tps-gcm-completed-checkboxes-has-reveal .inline-title,
      .markdown-rendered.tps-gcm-completed-checkboxes-has-reveal .inline-title,
      .markdown-preview-view.tps-gcm-completed-checkboxes-has-reveal h1:first-child,
      .markdown-rendered.tps-gcm-completed-checkboxes-has-reveal h1:first-child {
        box-sizing: border-box;
        padding-right: 128px;
      }

      .markdown-source-view.mod-cm6.is-live-preview > .tps-gcm-completed-checkbox-reveal {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        position: absolute;
        top: 14px;
        right: max(12px, calc((100% - var(--file-line-width, 700px)) / 2));
        z-index: 80;
        width: auto;
        min-width: max-content;
        min-height: 24px;
        margin: 0;
        padding: 0;
        pointer-events: none;
      }

      .markdown-preview-view .tps-gcm-completed-checkbox-reveal,
      .markdown-rendered .tps-gcm-completed-checkbox-reveal,
      .markdown-reading-view .tps-gcm-completed-checkbox-reveal {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        position: sticky;
        top: 8px;
        z-index: 80;
        width: 100%;
        min-height: 24px;
        margin: 0 0 8px;
        padding: 0 4px;
        pointer-events: none;
      }

      .markdown-source-view.mod-cm6.is-live-preview .tps-gcm-completed-checkbox-reveal button,
      .markdown-preview-view .tps-gcm-completed-checkbox-reveal button,
      .markdown-rendered .tps-gcm-completed-checkbox-reveal button,
      .markdown-reading-view .tps-gcm-completed-checkbox-reveal button {
        appearance: none;
        border: 1px solid var(--background-modifier-border);
        border-radius: 999px;
        background: var(--background-secondary);
        color: var(--text-muted);
        box-shadow: none;
        cursor: pointer;
        font-size: 11px;
        font-weight: 650;
        line-height: 18px;
        padding: 1px 9px;
        pointer-events: auto;
      }

      body.is-mobile .markdown-source-view.mod-cm6.is-live-preview > .tps-gcm-completed-checkbox-reveal,
      body.is-phone .markdown-source-view.mod-cm6.is-live-preview > .tps-gcm-completed-checkbox-reveal,
      body.is-mobile .markdown-preview-view .tps-gcm-completed-checkbox-reveal,
      body.is-phone .markdown-preview-view .tps-gcm-completed-checkbox-reveal,
      body.is-mobile .markdown-rendered .tps-gcm-completed-checkbox-reveal,
      body.is-phone .markdown-rendered .tps-gcm-completed-checkbox-reveal,
      body.is-mobile .markdown-reading-view .tps-gcm-completed-checkbox-reveal,
      body.is-phone .markdown-reading-view .tps-gcm-completed-checkbox-reveal {
        position: fixed;
        top: auto;
        left: max(12px, env(safe-area-inset-left, 0px));
        right: max(12px, env(safe-area-inset-right, 0px));
        bottom: calc(188px + env(safe-area-inset-bottom, 0px));
        z-index: 1000;
        width: auto;
        min-width: 0;
        min-height: 44px;
        margin: 0;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      }

      body.is-mobile .markdown-source-view.mod-cm6.is-live-preview .tps-gcm-completed-checkbox-reveal button,
      body.is-phone .markdown-source-view.mod-cm6.is-live-preview .tps-gcm-completed-checkbox-reveal button,
      body.is-mobile .markdown-preview-view .tps-gcm-completed-checkbox-reveal button,
      body.is-phone .markdown-preview-view .tps-gcm-completed-checkbox-reveal button,
      body.is-mobile .markdown-rendered .tps-gcm-completed-checkbox-reveal button,
      body.is-phone .markdown-rendered .tps-gcm-completed-checkbox-reveal button,
      body.is-mobile .markdown-reading-view .tps-gcm-completed-checkbox-reveal button,
      body.is-phone .markdown-reading-view .tps-gcm-completed-checkbox-reveal button {
        min-height: 44px;
        padding: 8px 18px;
        font-size: 14px;
        line-height: 20px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
        pointer-events: auto !important;
        touch-action: manipulation !important;
      }

      .markdown-source-view.mod-cm6.is-live-preview .tps-gcm-completed-checkbox-reveal button:hover,
      .markdown-source-view.mod-cm6.is-live-preview .tps-gcm-completed-checkbox-reveal button:focus-visible,
      .markdown-preview-view .tps-gcm-completed-checkbox-reveal button:hover,
      .markdown-preview-view .tps-gcm-completed-checkbox-reveal button:focus-visible,
      .markdown-rendered .tps-gcm-completed-checkbox-reveal button:hover,
      .markdown-rendered .tps-gcm-completed-checkbox-reveal button:focus-visible,
      .markdown-reading-view .tps-gcm-completed-checkbox-reveal button:hover,
      .markdown-reading-view .tps-gcm-completed-checkbox-reveal button:focus-visible {
        border-color: var(--interactive-accent);
        background: color-mix(in srgb, var(--interactive-accent) 16%, var(--background-secondary));
        color: var(--text-normal);
        outline: none;
      }

      .tps-task-line-drag-ghost {
        position: fixed;
        z-index: 100000;
        max-width: 320px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        pointer-events: none;
        border: 1px solid var(--interactive-accent);
        border-radius: 6px;
        background: var(--background-secondary);
        color: var(--text-normal);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        font-size: 12px;
        font-weight: 650;
        line-height: 1.2;
        padding: 6px 8px;
      }

      .tps-gcm-heading-link-suggest {
        position: fixed;
        z-index: 100001;
        width: min(420px, calc(100vw - 24px));
        max-height: 280px;
        overflow-y: auto;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        background: var(--background-primary);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
        padding: 4px;
      }

      .tps-gcm-heading-link-suggest-item {
        border-radius: 4px;
        padding: 7px 8px;
        cursor: pointer;
      }

      .tps-gcm-heading-link-suggest-item.is-selected,
      .tps-gcm-heading-link-suggest-item:hover {
        background: var(--background-modifier-hover);
      }

      .tps-gcm-heading-link-suggest-title {
        color: var(--text-normal);
        font-size: 13px;
        font-weight: 650;
        line-height: 18px;
      }

      .tps-gcm-heading-link-suggest-detail {
        color: var(--text-muted);
        font-size: 11px;
        line-height: 15px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tps-gcm-task-editor-card {
        position: fixed;
        z-index: 100002;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-height: min(460px, calc(100vh - 24px));
        overflow: auto;
        padding: 14px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 14px;
        background: var(--background-primary);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.38);
        color: var(--text-normal);
        overscroll-behavior: contain;
      }

      .tps-gcm-task-editor-card.is-child-modal-open {
        visibility: hidden;
        pointer-events: none;
      }

      .tps-gcm-task-editor-header,
      .tps-gcm-task-editor-header-main,
      .tps-gcm-task-editor-actions {
        display: flex;
        align-items: center;
      }

      .tps-gcm-task-editor-header {
        justify-content: space-between;
        gap: 10px;
      }

      .tps-gcm-task-editor-header-main {
        min-width: 0;
        gap: 10px;
      }

      .tps-gcm-task-editor-icon {
        display: flex;
        flex: 0 0 auto;
        color: var(--interactive-accent);
      }

      .tps-gcm-task-editor-icon svg,
      .tps-gcm-task-editor-close svg {
        width: 18px;
        height: 18px;
      }

      .tps-gcm-task-editor-heading {
        min-width: 0;
      }

      .tps-gcm-task-editor-title {
        font-size: var(--font-ui-medium);
        font-weight: 650;
        line-height: 1.25;
      }

      .tps-gcm-task-editor-source {
        overflow: hidden;
        margin-top: 2px;
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tps-gcm-task-editor-row {
        display: flex;
        gap: 10px;
        align-items: start;
      }

      input.task-list-item-checkbox.tps-gcm-task-editor-checkbox {
        flex: 0 0 auto;
        width: var(--checkbox-size);
        height: var(--checkbox-size);
        min-width: var(--checkbox-size);
        margin: 0.72em 0 0;
        touch-action: manipulation;
        user-select: none;
        -webkit-user-select: none;
      }

      input.task-list-item-checkbox.tps-gcm-task-editor-checkbox.is-long-pressing {
        outline: 2px solid var(--interactive-accent);
        outline-offset: 3px;
        transform: scale(0.96);
      }

      .tps-gcm-task-editor-input {
        box-sizing: border-box;
        flex: 1 1 auto;
        width: 100%;
        min-height: 104px;
        max-height: 240px;
        resize: vertical;
        padding: 10px 12px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 9px;
        background: var(--background-primary-alt);
        color: var(--text-normal);
        font: inherit;
        line-height: 1.45;
      }

      .tps-gcm-task-editor-input:focus {
        border-color: var(--interactive-accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--interactive-accent) 24%, transparent);
        outline: none;
      }

      .tps-gcm-task-editor-properties {
        display: flex;
        flex: 0 1 auto;
        flex-direction: column;
        gap: 7px;
        min-height: 0;
        max-height: min(240px, 32vh);
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 10px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 10px;
        background: var(--background-secondary-alt);
        scrollbar-gutter: stable;
      }

      .tps-gcm-task-editor-properties-title {
        position: sticky;
        top: -10px;
        z-index: 1;
        margin: -10px -10px 1px;
        padding: 9px 10px 7px;
        border-bottom: 1px solid var(--background-modifier-border-hover);
        background: var(--background-secondary-alt);
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        font-weight: 650;
        letter-spacing: 0.02em;
        line-height: 1.25;
        text-transform: uppercase;
      }

      .tps-gcm-task-editor-property {
        display: grid;
        grid-template-columns: minmax(92px, 0.7fr) minmax(0, 1.3fr);
        gap: 10px;
        align-items: center;
        min-width: 0;
      }

      .tps-gcm-task-editor-property-label {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
        color: var(--text-normal);
        font-size: var(--font-ui-small);
        font-weight: 550;
        line-height: 1.25;
      }

      .tps-gcm-task-editor-property-name,
      .tps-gcm-task-editor-property-key {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tps-gcm-task-editor-property-key {
        color: var(--text-faint);
        font-size: var(--font-ui-smaller);
        font-weight: 400;
      }

      .tps-gcm-task-editor-property-control {
        display: flex;
        align-items: center;
        min-width: 0;
      }

      .tps-gcm-task-editor-property-input,
      .tps-gcm-task-editor-property-button {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        min-height: 34px;
        margin: 0;
        border: 1px solid var(--background-modifier-border);
        border-radius: 7px;
        background: var(--background-primary);
        color: var(--text-normal);
        font: inherit;
      }

      .tps-gcm-task-editor-property-input {
        padding: 6px 8px;
      }

      .tps-gcm-task-editor-property-button {
        display: block;
        overflow: hidden;
        padding: 6px 9px;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tps-gcm-task-editor-property-input:focus,
      .tps-gcm-task-editor-property-button:focus-visible {
        border-color: var(--interactive-accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--interactive-accent) 24%, transparent);
        outline: none;
      }

      .tps-gcm-task-editor-property-input[aria-invalid="true"] {
        border-color: var(--text-error);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--text-error) 20%, transparent);
      }

      input[type="checkbox"].tps-gcm-task-editor-property-checkbox {
        flex: 0 0 auto;
        width: var(--checkbox-size);
        height: var(--checkbox-size);
        min-width: var(--checkbox-size);
        margin: 0;
        touch-action: manipulation;
      }

      .tps-gcm-task-editor-hint {
        margin-top: -5px;
        color: var(--text-faint);
        font-size: var(--font-ui-smaller);
      }

      .tps-gcm-task-editor-actions {
        gap: 8px;
      }

      .tps-gcm-task-editor-action-spacer {
        flex: 1 1 auto;
      }

      @media (max-width: 600px) {
        .tps-gcm-task-editor-card {
          right: auto !important;
          bottom: auto !important;
          border-radius: 16px;
        }

        .tps-gcm-task-editor-input {
          min-height: 76px;
          max-height: min(180px, 30dvh);
        }

        .tps-gcm-task-editor-properties {
          max-height: min(240px, 32dvh);
          padding: 9px;
          scrollbar-gutter: auto;
        }

        .tps-gcm-task-editor-properties-title {
          top: -9px;
          margin: -9px -9px 1px;
          padding-right: 9px;
          padding-left: 9px;
        }

        .tps-gcm-task-editor-property {
          grid-template-columns: minmax(0, 1fr);
          gap: 5px;
          padding-bottom: 3px;
        }

        .tps-gcm-task-editor-property-label {
          flex-direction: row;
          gap: 6px;
          align-items: baseline;
        }

        .tps-gcm-task-editor-property-input,
        .tps-gcm-task-editor-property-button {
          min-height: 40px;
          font-size: 16px;
        }

        input[type="checkbox"].tps-gcm-task-editor-property-checkbox {
          width: max(var(--checkbox-size), 22px);
          height: max(var(--checkbox-size), 22px);
          min-width: max(var(--checkbox-size), 22px);
        }

        .tps-gcm-task-editor-actions {
          position: sticky;
          bottom: -14px;
          z-index: 1;
          margin: 0 -14px -14px;
          padding: 10px 14px max(14px, env(safe-area-inset-bottom));
          background: var(--background-primary);
        }

        .tps-gcm-task-editor-actions button {
          min-height: 40px;
        }
      }

      .tps-home-panel-heading {
        gap: 8px;
      }

      .tps-home-panel-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        min-width: 0;
        margin-left: auto;
      }

      .tps-home-configured-action {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 34px;
        max-width: min(240px, 38vw);
        padding: 5px 10px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 10px;
        background: color-mix(in srgb, var(--background-secondary) 84%, var(--interactive-accent) 16%);
        color: var(--text-normal);
        font-weight: 650;
        line-height: 1.15;
      }

      .tps-home-configured-action:hover:not(:disabled) {
        border-color: color-mix(in srgb, var(--interactive-accent) 55%, var(--background-modifier-border));
        background: color-mix(in srgb, var(--background-secondary) 72%, var(--interactive-accent) 28%);
      }

      .tps-home-configured-action:disabled {
        opacity: 0.42;
        cursor: not-allowed;
      }

      .tps-home-configured-action.is-editing {
        border-style: dashed;
        cursor: pointer;
      }

      .tps-home-panel-action-icon,
      .tps-home-panel-action-icon svg {
        width: 16px;
        height: 16px;
        flex: 0 0 auto;
      }

      .tps-home-panel-action-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tps-home-action-add-button {
        flex: 0 0 auto;
        width: 34px;
        height: 34px;
        border-style: dashed;
      }

      .tps-home-context-capture-modal .modal-content {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .tps-home-context-capture-modal h2 {
        margin: 0;
        font-family: var(--font-interface-theme);
        letter-spacing: -0.02em;
      }

      .tps-home-context-capture-target {
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tps-home-context-capture-section {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        gap: 10px;
      }

      .tps-home-context-capture-section label {
        color: var(--text-muted);
        font-size: var(--font-ui-small);
        font-weight: var(--font-medium);
      }

      .tps-home-context-capture-section select {
        width: 100%;
        min-width: 0;
      }

      .tps-home-context-capture-input-shell {
        width: 100%;
        padding: 0;
        border: 1px solid var(--background-modifier-border);
        border-radius: 12px;
        background:
          linear-gradient(135deg, color-mix(in srgb, var(--background-primary) 92%, var(--interactive-accent) 8%), var(--background-primary));
        overflow: visible;
        cursor: text;
      }

      .tps-home-context-capture-input {
        display: block;
        width: 100%;
        min-height: calc(1.45em + 20px);
        max-height: none;
        margin: 0;
        padding: 10px 12px;
        border: 0 !important;
        border-radius: inherit;
        box-shadow: none !important;
        background: transparent !important;
        color: var(--text-normal);
        font-family: var(--font-text-theme);
        font-size: 16px;
        line-height: 1.45;
        resize: none;
        overflow-y: hidden !important;
        overscroll-behavior: none;
        box-sizing: border-box;
      }

      .tps-home-context-capture-input:focus {
        outline: 2px solid color-mix(in srgb, var(--interactive-accent) 70%, transparent);
        outline-offset: -2px;
      }

      .tps-home-context-capture-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }

      .tps-home-context-capture-actions button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-height: 38px;
      }

      @media (max-width: 600px) {
        .tps-home-panel-actions {
          gap: 4px;
        }

        .tps-home-configured-action {
          max-width: min(170px, 48vw);
          min-height: 36px;
          padding: 6px 9px;
        }

        .tps-home-context-capture-modal {
          width: calc(100vw - 16px) !important;
          max-width: none !important;
        }

        .tps-home-context-capture-modal .modal-content {
          padding-bottom: max(12px, env(safe-area-inset-bottom));
        }

        .tps-home-context-capture-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .tps-home-context-capture-section {
          grid-template-columns: 1fr;
          gap: 6px;
        }

        .tps-home-context-capture-actions button:last-child {
          grid-column: 1 / -1;
        }
      }

    `;
