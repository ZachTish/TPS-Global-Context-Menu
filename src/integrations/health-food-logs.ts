/** Health owns food-log calculations; this adapter is called only by existing
 * creation and property-render boundaries. No listeners, I/O or saved settings.
 */
interface FoodLogOwner {
  version: number;
  calculatedProperties(frontmatter: Record<string, unknown>): string[];
  prepareCreation(kind: string, properties: Record<string, unknown>): {properties: Record<string, unknown>; body: string} | null;
}
function owner(plugin: any): FoodLogOwner | undefined {
  const api = plugin.app?.plugins?.getPlugin?.('tps-health')?.api?.foodLogs;
  return api?.version === 1 ? api : undefined;
}
export function calculatedFoodLogProperties(plugin: any, frontmatter: Record<string, unknown>): string[] {
  return owner(plugin)?.calculatedProperties(frontmatter) || [];
}
export function prepareHealthFoodLog(plugin: any, kind: string, properties: Record<string, unknown>) {
  return owner(plugin)?.prepareCreation(kind, properties) || null;
}
