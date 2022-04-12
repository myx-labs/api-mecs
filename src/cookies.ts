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
  csrf: string;
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
      const cookie = {
        cookie: item.cookie,
        audit: item.audit ? true : false,
        rank: item.rank ? true : false,
        csrf: await getCSRFToken(item.cookie),
      };
      //   console.log(cookie);
      cache.push(cookie);
    }
    console.log(`${cache.length} cookies loaded!`);
  } catch (error) {
    console.error(error);
    throw new Error("Unable to load cookies.");
  }
}

export async function getCookie(audit = false, rank = false) {
  if (cache.length === 0) {
    await loadCookies();
  }
  const validCookies = cache.filter(
    audit && rank
      ? (item) => item.audit && item.rank
      : audit
      ? (item) => item.audit === true
      : rank
      ? (item) => item.rank === true
      : (item) => true
  );
  if (validCookies.length > 0) {
    const selectedIndex = Math.floor(Math.random() * validCookies.length);
    const selectedCookie = validCookies[selectedIndex];
    console.log(`Using cookie ${selectedCookie.cookie}`);
    return selectedCookie;
  } else {
    throw new Error("No valid cookies found for given requirements!");
  }
}
