import type { ApiRoute } from "./router";
import { photoRoutes } from "./features/photos/routes";
import { tagSearchRoutes } from "./features/tag-search";

/**
 * The feature modules deliberately own their route implementations; this is
 * the single registry that makes them reachable from the hosted Worker.
 */
export const featureRoutes: readonly ApiRoute[] = [...photoRoutes, ...tagSearchRoutes];
