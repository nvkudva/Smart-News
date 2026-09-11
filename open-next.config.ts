import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

/**
 * Prerendered pages need somewhere to live, and with no incremental cache
 * configured OpenNext simply drops them — which is why the fourteen category
 * shells built and then 404ed.
 *
 * Static assets rather than R2 or KV, because the point of a shell is to cost
 * nothing: asset requests are free and are not counted against the daily Worker
 * limit, whereas a page read out of R2 still costs the invocation that reads
 * it. The trade is that this cache is read-only, so nothing may revalidate —
 * which is exactly right here. The shells hold no data; every story on them
 * arrives from /api/*, validated against the cycle stamp.
 */
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  // Without this the cache is never consulted and the prerendered pages are
  // built and then dropped, which is the 404 the category route documented.
  // The entries themselves are written into the assets by `deploy`/`upload`,
  // not by `build`, so an inspection of .open-next after a bare build is empty.
  enableCacheInterception: true,
});
