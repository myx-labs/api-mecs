import got from "got";
import config from "./config.js";
const ROBLOSECURITY = config.credentials.roblox;

let cachedCSRFToken: string = null;

async function validateCSRFtoken(ROBLOX_X_CSRF_TOKEN: string) {
  const response = await got.post(`https://auth.roblox.com/`, {
    throwHttpErrors: false,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      cookie: `.ROBLOSECURITY=${ROBLOSECURITY};`,
      "X-CSRF-TOKEN": ROBLOX_X_CSRF_TOKEN,
    },
  });
  if (response.statusCode === 200) {
    console.log(`Token ${ROBLOX_X_CSRF_TOKEN} validated!`);
    return true;
  }
  return false;
}

export default async function getCSRFToken(force = false) {
  if (cachedCSRFToken == null || force == true) {
    const response = await got.post(`https://auth.roblox.com/`, {
      throwHttpErrors: false,
      headers: {
        "content-type": "application/json;charset=UTF-8",
        cookie: `.ROBLOSECURITY=${ROBLOSECURITY};`,
      },
    });
    // console.log(response.headers);
    const ROBLOX_X_CSRF_TOKEN = response.headers["x-csrf-token"] as string;
    if (ROBLOX_X_CSRF_TOKEN) {
      await validateCSRFtoken(ROBLOX_X_CSRF_TOKEN);
      cachedCSRFToken = ROBLOX_X_CSRF_TOKEN;
      return cachedCSRFToken;
    } else {
      throw new Error("Failed to obtain CSRF token");
    }
  }
  return cachedCSRFToken;
}
