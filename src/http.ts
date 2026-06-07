// Centralized HTTP client.
//
// Every outbound request flows through this single configured `got` instance so
// that connection pooling, timeouts, and retry/backoff are consistent and live
// on agents we own (rather than Node's shared global agent). Keeping all traffic
// here also means the listener-leak fix (no shared got `cache`) can never be
// silently reintroduced at a scattered call site.

import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { setMaxListeners } from "node:events";
import got from "got";

const AGENT_OPTIONS = {
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: 60_000, // socket inactivity timeout for pooled keep-alive sockets
};

const httpAgent = new HttpAgent(AGENT_OPTIONS);
const httpsAgent = new HttpsAgent(AGENT_OPTIONS);

// Keep-alive agents legitimately attach per-socket listeners; with up to
// maxSockets + maxFreeSockets sockets this can exceed Node's default ceiling of
// 10 and emit a spurious MaxListenersExceededWarning. Raise the limit on *our*
// agents only (not the global default) so a real leak elsewhere still warns.
setMaxListeners(128, httpAgent, httpsAgent);

export const http = got.extend({
  agent: { http: httpAgent, https: httpsAgent },
  // Preserve existing call-site behavior: callers inspect `response.statusCode`
  // and branch on it rather than catching thrown HTTP errors.
  throwHttpErrors: false,
  timeout: { connect: 5_000, request: 10_000 },
  retry: {
    // got's defaults already retry idempotent methods (GET/PUT/HEAD/DELETE/
    // OPTIONS/TRACE — never POST/PATCH) on 408/413/429/500/502/503/504/521/522/
    // 524 with exponential backoff + jitter, and honor `Retry-After` on 429.
    // We only bound those defaults; mutations (rank PATCH, CSRF logout POST,
    // username-lookup POST) are intentionally left un-retried.
    limit: 3,
    backoffLimit: 20_000,
    maxRetryAfter: 30_000,
  },
});
