import type { PlatformProviders } from "../providers";
import { searchRoutes } from "./search/routes";
import { createTagQueueHandlers, humanTagRoutes } from "./tags";

/** Collections consumed by the integration issue; central dispatch remains untouched here. */
export const tagSearchRoutes = [...humanTagRoutes, ...searchRoutes] as const;

export function createTagSearchQueueHandlers(providers: PlatformProviders) {
  return createTagQueueHandlers(providers);
}
