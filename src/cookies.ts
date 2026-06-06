import fs from "fs/promises";
import getCSRFToken from "./csrf.js";

interface CookieItemJSON {
  cookie: string;
  audit?: boolean;
  rank?: boolean;
}

interface CookieItem {
  cookie: string;
  audit: boolean;
  rank: boolean;
  csrf: string | null;
}

const cache: CookieItem[] = [];

export async function loadCookies() {
  try {
    console.log("Loading cookies...");
    const fileString = await fs.readFile("cookies.json", {
      encoding: "utf-8",
    });
    const data = JSON.parse(fileString) as CookieItemJSON[];
    if (data.length === 0) {
      throw new Error("No cookies");
    }
    for (const item of data) {
      if (typeof item.cookie !== "string" || item.cookie.trim().length === 0) {
        console.warn("Skipping cookie entry with an empty cookie value.");
        continue;
      }

      let csrf: string | null = null;
      const rank = item.rank ? true : false;
      if (rank) {
        try {
          csrf = await getCSRFToken(item.cookie);
        } catch (error) {
          console.warn("Skipping rank cookie because CSRF fetch failed:");
          console.warn(error);
          continue;
        }
      }

      const cookie = {
        cookie: item.cookie,
        audit: item.audit ? true : false,
        rank,
        csrf,
      };
      // console.log(cookie);
      cache.push(cookie);
    }
    if (cache.length === 0) {
      throw new Error("No valid cookies loaded");
    }
    console.log(`${cache.length} cookies loaded!`);
  } catch (error) {
    console.error(error);
    throw new Error(
      `Unable to load cookies from cookies.json: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export async function getCookie(audit = false, rank = false) {
  if (cache.length === 0) {
    await loadCookies();
  }
  const validCookies = cache.filter(
    audit && rank
      ? (item) => item.audit && item.rank && typeof item.csrf === "string"
      : audit
      ? (item) => item.audit === true
      : rank
      ? (item) => item.rank === true && typeof item.csrf === "string"
      : (item) => true
  );
  if (validCookies.length > 0) {
    const selectedIndex = Math.floor(Math.random() * validCookies.length);
    const selectedCookie = validCookies[selectedIndex];
    // console.log(`Using cookie ${selectedCookie.cookie}`);
    return selectedCookie;
  } else {
    throw new Error("No valid cookies found for given requirements!");
  }
}

export async function updateCookieCSRF(cookie: string, csrf?: string) {
  const index = cache.findIndex((c) => c.cookie === cookie);
  if (index !== -1) {
    const c = cache[index];
    const newCSRF = csrf || (await getCSRFToken(cookie, true));
    console.log(`Changing CSRF from ${c.csrf} to ${newCSRF}`);
    cache[index].csrf = newCSRF;
    return newCSRF;
  } else {
    throw new Error("Unable to find cookie");
  }
}
