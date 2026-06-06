import got from "got";

interface CSRFCacheItem {
  cookie: string;
  csrf: string;
}

const cache: CSRFCacheItem[] = [];

export default async function getCSRFToken(cookie: string, force = false) {
  const cacheHit = cache.find((item) => item.cookie === cookie);
  if (typeof cacheHit === "undefined" || force === true) {
    const response = await got.post(`https://auth.roblox.com/v2/logout`, {
      throwHttpErrors: false,
      headers: {
        "content-type": "application/json;charset=UTF-8",
        cookie: `.ROBLOSECURITY=${cookie};`,
      },
      timeout: { request: 10000 },
    });
    // console.log(response.headers);
    const ROBLOX_X_CSRF_TOKEN = response.headers["x-csrf-token"] as string;
    if (ROBLOX_X_CSRF_TOKEN) {
      if (cacheHit) {
        cacheHit.csrf = ROBLOX_X_CSRF_TOKEN;
      } else {
        cache.push({ cookie: cookie, csrf: ROBLOX_X_CSRF_TOKEN });
      }
      return ROBLOX_X_CSRF_TOKEN;
    } else {
      throw new Error(
        `Failed to obtain CSRF token: Roblox returned ${response.statusCode}`
      );
    }
  }
  return cacheHit.csrf;
}
