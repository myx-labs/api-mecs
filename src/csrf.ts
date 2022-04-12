import got from "got";

interface CSRFCacheItem {
  cookie: string;
  csrf: string;
}

const cache: CSRFCacheItem[] = [];

async function validateCSRFtoken(cookie: string, ROBLOX_X_CSRF_TOKEN: string) {
  const response = await got.post(`https://auth.roblox.com/`, {
    throwHttpErrors: false,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      cookie: `.ROBLOSECURITY=${cookie};`,
      "X-CSRF-TOKEN": ROBLOX_X_CSRF_TOKEN,
    },
  });
  if (response.statusCode === 200) {
    // console.log(`Token ${ROBLOX_X_CSRF_TOKEN} validated for cookie ${cookie}!`);
    return true;
  }
  return false;
}

export default async function getCSRFToken(cookie: string, force = false) {
  const cacheHit = cache.find((item) => item.cookie === cookie);
  if (typeof cacheHit === "undefined" || force === true) {
    const response = await got.post(`https://auth.roblox.com/`, {
      throwHttpErrors: false,
      headers: {
        "content-type": "application/json;charset=UTF-8",
        cookie: `.ROBLOSECURITY=${cookie};`,
      },
    });
    // console.log(response.headers);
    const ROBLOX_X_CSRF_TOKEN = response.headers["x-csrf-token"] as string;
    if (ROBLOX_X_CSRF_TOKEN) {
      await validateCSRFtoken(cookie, ROBLOX_X_CSRF_TOKEN);
      cache.push({ cookie: cookie, csrf: ROBLOX_X_CSRF_TOKEN });
      return ROBLOX_X_CSRF_TOKEN;
    } else {
      throw new Error("Failed to obtain CSRF token");
    }
  }
  return cacheHit.csrf;
}
