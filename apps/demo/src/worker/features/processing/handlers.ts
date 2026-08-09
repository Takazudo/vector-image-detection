import type { QueueMessageHandlers } from "../../contracts/queue";
import type { PlatformProviders } from "../../providers";
import { handleRepairMessage } from "../maintenance/repair";
import { purgePhoto } from "../maintenance/purge";
import { createEnrichmentHandlers } from "./enrichment";
import { createEnrichmentProviders, type EnrichmentProviders } from "./providers";

export function createPhotoQueueHandlers(
  platform: PlatformProviders,
  enrichment: EnrichmentProviders = createEnrichmentProviders(platform),
): QueueMessageHandlers {
  const processing = createEnrichmentHandlers({ platform, enrichment });
  return {
    enrich: processing.enrich,
    reindex: processing.reindex,
    repair: (message) => handleRepairMessage(platform, enrichment, message),
    purge: (message) => purgePhoto(platform, enrichment, message),
  };
}
