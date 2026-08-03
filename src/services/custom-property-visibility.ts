import type { CustomProperty } from "../types";

export type CustomPropertySurface = "any" | "inline" | "context";
export type CustomPropertyVisibilityMode = NonNullable<
  CustomProperty["showWhen"]
>;

export interface CustomPropertyVisibilityUpdateOptions {
  readonly properties: readonly CustomProperty[];
  readonly index: number;
  readonly patch: Partial<CustomProperty>;
  readonly commit: (properties: CustomProperty[]) => void;
  readonly refresh: () => void;
  readonly persist: () => Promise<void>;
  readonly onRefreshError?: (error: unknown) => void;
}

export interface CustomPropertyPreviewReuseOptions {
  readonly hasExistingPanel: boolean;
  readonly isCurrentSignature: boolean;
  readonly isCurrentPath: boolean;
  readonly force: boolean;
}

/** A forced visibility refresh always rebuilds, even when note data is unchanged. */
export function shouldReuseCustomPropertyPreviewPanel(
  options: CustomPropertyPreviewReuseOptions,
): boolean {
  return options.hasExistingPanel
    && !options.force
    && (options.isCurrentSignature || options.isCurrentPath);
}

export function getCustomPropertySurfaceVisibilityMode(
  property: CustomProperty,
  surface: CustomPropertySurface,
): CustomPropertyVisibilityMode {
  if (property.hidden === true) return "never";
  if (surface === "inline") {
    if (property.showInCollapsed === false) return "never";
    return property.inlineShowWhen || property.showWhen || "always";
  }
  if (surface === "context") {
    if (property.showInContextMenu === false) return "never";
    return property.contextMenuShowWhen || property.showWhen || "always";
  }
  return property.showWhen || "always";
}

/**
 * Maps a surface-owned visibility choice back to the matching Settings field.
 * Legacy participation toggles are enabled so choosing "Always show" cannot
 * remain silently defeated by an older `showIn*` value.
 */
export function createCustomPropertySurfaceVisibilityPatch(
  surface: CustomPropertySurface,
  mode: CustomPropertyVisibilityMode,
): Partial<CustomProperty> {
  if (surface === "inline") {
    return {
      hidden: false,
      showInCollapsed: true,
      inlineShowWhen: mode,
    };
  }
  if (surface === "context") {
    return {
      hidden: false,
      showInContextMenu: true,
      contextMenuShowWhen: mode,
    };
  }
  return {
    hidden: mode === "never",
    showWhen: mode,
  };
}

/**
 * Commits the new effective rule and repaints synchronously, then persists it.
 * A stale mounted surface must never prevent the setting from being saved.
 */
export async function applyCustomPropertyVisibilityUpdate(
  options: CustomPropertyVisibilityUpdateOptions,
): Promise<boolean> {
  if (options.index < 0 || options.index >= options.properties.length) {
    return false;
  }
  const properties = [...options.properties];
  properties[options.index] = {
    ...properties[options.index],
    ...options.patch,
  };
  options.commit(properties);
  try {
    options.refresh();
  } catch (error) {
    try {
      options.onRefreshError?.(error);
    } catch {
      // Diagnostics must not block persistence either.
    }
  }
  await options.persist();
  return true;
}

/** Refresh each mounted view once even when it is tracked by multiple surfaces. */
export function refreshMountedCustomPropertyPresentationViews<T>(
  sources: readonly Iterable<T>[],
  refresh: (view: T, options: { force: true }) => void,
  onError?: (view: T, error: unknown) => void,
): void {
  const mountedViews = new Set<T>();
  for (const source of sources) {
    for (const view of source) mountedViews.add(view);
  }
  for (const view of mountedViews) {
    try {
      refresh(view, { force: true });
    } catch (error) {
      try {
        onError?.(view, error);
      } catch {
        // Continue refreshing the remaining mounted views.
      }
    }
  }
}
