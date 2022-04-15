import fs from "fs/promises";
import config from "./config.js";

const filePath = "cache.json";

let loaded = false;

interface MECSCache {
  lastPagingCursor: string | null;
}

const cacheObject: MECSCache = {
  lastPagingCursor: null,
};

export async function getCache() {
  if (!loaded && config.flags.loadCache === true) {
    try {
      const file = await fs.readFile(filePath, { encoding: "utf-8" });
      const parsed = JSON.parse(file) as MECSCache;
      for (const key in parsed) {
        const item = parsed[key as keyof typeof parsed];
        cacheObject[key as keyof typeof parsed] = item;
      }
    } catch (error) {
      console.error(
        "Failed to load cache file! This may occur on first start."
      );
      console.error(error);
    }
  }
  console.log(cacheObject);
  return cacheObject;
}

export async function setPagingCursor(lastPagingCursor?: string) {
  if (typeof lastPagingCursor === "string") {
    cacheObject.lastPagingCursor = lastPagingCursor;
  } else {
    cacheObject.lastPagingCursor = null;
  }
  await setCache();
}

export async function setCache() {
  return fs.writeFile(filePath, JSON.stringify(cacheObject));
}
