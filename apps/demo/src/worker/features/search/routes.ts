import { apiError, defineApiRoute, json, type ApiRequestContext } from "../../router";
import { paginationSchema, searchRequestSchema } from "../../validation";
import { TagWordValidationError } from "../tags/normalization";
import { getRelatedPhotos } from "./related";
import { searchPhotoLibrary } from "./search";

export const searchRoutes = [
  defineApiRoute("GET", "/api/v1/search", handleSearch),
  defineApiRoute("GET", "/api/v1/photos/:photoId/related", handleRelatedPhotos),
] as const;

async function handleSearch(request: Request, context: ApiRequestContext): Promise<Response> {
  const url = new URL(request.url);
  const parsed = searchRequestSchema.safeParse({
    version: "v1",
    query: url.searchParams.get("query") ?? "",
    ...(url.searchParams.has("cursor") ? { cursor: url.searchParams.get("cursor") } : {}),
    ...(url.searchParams.has("limit") ? { limit: url.searchParams.get("limit") } : {}),
  });
  if (!parsed.success) {
    return apiError(
      context.providers.ids.generate(),
      400,
      "invalid_search_request",
      "Provide a valid bounded search query, cursor, and limit.",
    );
  }
  try {
    return json(await searchPhotoLibrary(parsed.data, context.providers));
  } catch (error) {
    if (error instanceof TagWordValidationError || error instanceof RangeError) {
      return apiError(
        context.providers.ids.generate(),
        400,
        "invalid_search_request",
        error.message,
      );
    }
    throw error;
  }
}

async function handleRelatedPhotos(request: Request, context: ApiRequestContext): Promise<Response> {
  const url = new URL(request.url);
  const parsed = paginationSchema.safeParse({
    version: "v1",
    ...(url.searchParams.has("cursor") ? { cursor: url.searchParams.get("cursor") } : {}),
    ...(url.searchParams.has("limit") ? { limit: url.searchParams.get("limit") } : {}),
  });
  if (!parsed.success) {
    return apiError(
      context.providers.ids.generate(),
      400,
      "invalid_related_photos_request",
      "Provide a valid bounded cursor and limit.",
    );
  }
  try {
    const result = await getRelatedPhotos(
      context.params.photoId ?? "",
      parsed.data,
      context.providers,
    );
    if (result === "not_found") {
      return apiError(context.providers.ids.generate(), 404, "not_found", "Photo not found.");
    }
    return json(result);
  } catch (error) {
    if (error instanceof RangeError) {
      return apiError(
        context.providers.ids.generate(),
        400,
        "invalid_related_photos_request",
        error.message,
      );
    }
    throw error;
  }
}
