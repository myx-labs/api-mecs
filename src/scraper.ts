import { docs, auth, docs_v1 } from "@googleapis/docs";
import { http } from "./http.js";

import { search } from "fast-fuzzy";

import config from "./config.js";
import { getCookie } from "./cookies.js";
import { RobloxAPI_ErrorResponse } from "./types.js";
import { TTLCache } from "./ttlCache.js";
const groups = config.groups;

// Short-lived cache for POST lookups (e.g. username → id). These mappings are
// stable, so a 5-minute TTL safely de-duplicates repeated lookups without the
// listener leak / unbounded growth of got's built-in cache.
const postCache = new TTLCache<unknown>({ max: 500, defaultTtlMs: 5 * 60_000 });

const cache_blacklist = {
  users: null as blacklisted_id[] | null,
  groups: null as blacklisted_id[] | null,
};

declare global {
  interface Array<T> {
    inArray(comparer: Function): boolean;
    pushIfNotExist(element: T, comparer: Function): void;
  }
}

Array.prototype.inArray = function (comparer) {
  for (let i = 0; i < this.length; i++) {
    if (comparer(this[i])) return true;
  }
  return false;
};

Array.prototype.pushIfNotExist = function (element, comparer) {
  if (!this.inArray(comparer)) {
    this.push(element);
  }
};

const doc_auth = config.credentials.google
  ? new auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/documents.readonly"],
      credentials: config.credentials.google,
    })
  : null;

interface blacklisted_id {
  id: number;
  name?: string;
  reason?: string;
}

function getRobloxErrorMessage(json: unknown) {
  if (typeof json !== "object" || json === null || !("errors" in json)) {
    return undefined;
  }

  const errors = (json as RobloxAPI_ErrorResponse).errors;
  const messages = errors
    ?.map((error) => {
      const code =
        typeof error.code === "number" || typeof error.code === "string"
          ? `code ${error.code}`
          : undefined;
      const message =
        typeof error.message === "string" ? error.message : undefined;
      return [code, message].filter(Boolean).join(": ");
    })
    .filter((message) => message.length > 0);

  return messages && messages.length > 0 ? messages.join("; ") : undefined;
}

async function getRobloxURL(url: string, cookieRequired: boolean = false) {
  const headers = {
    "content-type": "application/json;charset=UTF-8",
    cookie: undefined as string | undefined,
  };
  if (cookieRequired) {
    const cookie = await getCookie();
    if (cookie !== null) {
      const ROBLOSECURITY = cookie.cookie;
      headers.cookie = `.ROBLOSECURITY=${ROBLOSECURITY};`;
    }
  }
  const response = await http.get<unknown>(url, {
    headers: headers,
    responseType: "json",
  });
  if (response.statusCode >= 200 && response.statusCode < 300) {
    return response.body;
  }

  const robloxError = getRobloxErrorMessage(response.body);
  throw new Error(
    `Roblox GET failed with HTTP ${response.statusCode}${
      response.statusMessage ? ` ${response.statusMessage}` : ""
    }${robloxError ? `: ${robloxError}` : ""}`
  );
}

async function postRobloxURL(
  url: string,
  body: any,
  cookieRequired: boolean = false
) {
  const cacheKey = `${cookieRequired ? "auth" : "anon"}:${url}:${JSON.stringify(
    body
  )}`;
  const cached = postCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const headers = {
    "content-type": "application/json;charset=UTF-8",
    cookie: undefined as string | undefined,
  };
  if (cookieRequired) {
    const cookie = await getCookie();
    if (cookie !== null) {
      const ROBLOSECURITY = cookie.cookie;
      headers.cookie = `.ROBLOSECURITY=${ROBLOSECURITY};`;
    }
  }
  const response = await http.post<unknown>(url, {
    headers: headers,
    json: body,
    responseType: "json",
  });
  if (response.statusCode >= 200 && response.statusCode < 300) {
    postCache.set(cacheKey, response.body);
    return response.body;
  }

  const robloxError = getRobloxErrorMessage(response.body);
  throw new Error(
    `Roblox POST failed with HTTP ${response.statusCode}${
      response.statusMessage ? ` ${response.statusMessage}` : ""
    }${robloxError ? `: ${robloxError}` : ""}`
  );
}

export function processReasonString(reason: string | undefined, name?: string) {
  const cleanup = (string: string) => {
    string = string.trim();
    string = string.replace("/", " / ");
    string = string.trim();
    string = string.replace(/(^\/+)|(\/+$)/g, "");
    string = string.trim();
    string = string.replace(/\s{2,}/g, " ");
    string = string.trim();
    return string;
  };

  if (typeof reason !== "undefined") {
    const names: string[] = [];

    if (name) {
      names.push(name);
    }

    reason = cleanup(reason);

    const reasons = reason
      .split(" / ")
      .map(cleanup)
      .filter((reason) =>
        !reason.toLowerCase().match("alt")
          ? search(reason, names).length === 0
          : true
      );

    if (reasons.length === 0 || reason.length === 0 || reason === null) {
      reason = undefined;
    } else {
      reason = reasons.join(" / ");
      reason = reason.charAt(0).toUpperCase() + reason.slice(1);
    }
  }

  return reason;
}

function extractIDsFromDocument(res: docs_v1.Schema$Document, regex: RegExp) {
  const idArray: blacklisted_id[] = [];
  res.body?.content?.forEach((value) => {
    const paragraph = value.paragraph;
    if (paragraph) {
      const elements = paragraph.elements;
      if (elements) {
        // console.dir(elements, { depth: null });
        elements.forEach((value) => {
          const textRun = value.textRun;
          if (textRun) {
            const textStyle = textRun.textStyle;
            if (textStyle) {
              const link = textStyle.link;
              if (link) {
                const url = link.url;
                if (url) {
                  const match = url.match(regex);
                  if (match !== null) {
                    if (match.length === 2) {
                      const id = parseInt(match[1]);
                      if (id) {
                        if (id !== groups[0].id) {
                          // no accidental blacklisting the whole group
                          if (textStyle.strikethrough !== true) {
                            let reason: string | null = null;
                            try {
                              const reasonElement = elements.find(
                                (element) =>
                                  element.startIndex === value.endIndex
                              );
                              if (reasonElement) {
                                const regex2 = /\(([^)]+)\)/;
                                const content = reasonElement.textRun?.content;
                                if (
                                  content !== null &&
                                  typeof content !== "undefined"
                                ) {
                                  const contentMatch = content.match(regex2);
                                  if (contentMatch !== null) {
                                    reason =
                                      processReasonString(contentMatch[1]) ||
                                      null;
                                  }
                                }
                              }
                            } catch (error) {
                              console.error("Failed to extract reason from blacklist entry:", error);
                            }

                            idArray.pushIfNotExist(
                              { id: id, reason: reason || undefined },
                              (element: blacklisted_id) => {
                                return element.id === id;
                              }
                            );
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        });
      }
    }
  });
  return idArray;
}

interface ExternalResponse {
  updated: string;
  types: string[];
  name: string;
  id?: string;
  type: "user" | "group";
}

async function getIDs(type: string, includeNames = false) {
  const config = groups[0].blacklists;
  const external = config.external;
  if (external) {
    const data = await fetch(external);
    const json = (await data.json()) as ExternalResponse[];
    return json
      .filter(
        (item) => item.type === (type === "users" ? "user" : "group") && item.id
      )
      .map((value) => {
        return {
          id: parseInt(value.id as string),
          name: value.name,
          reason: value.types.join(", "),
        };
      });
    // return data;
  }
  let documentId = null;
  let regex: RegExp | null = null;
  if (type === "users") {
    documentId = config.docs[type];
    regex = /\/users\/(\d+)/;
  } else if (type === "groups") {
    documentId = config.docs[type];
    regex = /\/groups\/(\d+)/;
  }
  if (documentId != null && regex != null) {
    if (!doc_auth) {
      console.warn("Google credentials not available, skipping doc-based blacklist fetch.");
      return [];
    }
    const doc_obj = docs({ version: "v1", auth: doc_auth });
    const res = await doc_obj.documents.get({
      documentId: documentId,
    });
    const document = res.data;
    const ids = extractIDsFromDocument(document, regex);

    if (includeNames) {
      try {
        if (type === "groups") {
          const groupData = await getRobloxURL(
            `https://groups.roblox.com/v2/groups?groupIds=${ids
              .map((id) => id.id)
              .join(",")}`
          );
          const data =
            typeof groupData === "object" &&
            groupData !== null &&
            "data" in groupData &&
            Array.isArray(groupData.data)
              ? groupData.data
              : [];
          const newIds = ids.map((id) => ({
            ...id,
            name: data.find((value) => value.id === id.id)?.name || undefined,
          }));
          return newIds;
        } else if (type === "users") {
          const userData = await postRobloxURL(
            `https://users.roblox.com/v1/users`,
            { userIds: ids.map((id) => id.id), excludeBannedUsers: false }
          );
          const data =
            typeof userData === "object" &&
            userData !== null &&
            "data" in userData &&
            Array.isArray(userData.data)
              ? userData.data
              : [];
          const newIds = ids.map((id) => {
            const user = data.find((value) => value.id === id.id);
            if (user) {
              const name = user.name as string;
              return {
                ...id,
                reason: id.reason
                  ? processReasonString(id.reason, name)
                  : undefined,
                name: user.name || undefined,
              };
            }
            return id;
          });
          return newIds;
        }
      } catch {
        console.error(
          "Unable to get names for blacklist, falling back to regular list"
        );
      }
    }
    return ids;
  }
  throw new Error("Unable to get IDs");
}

async function getBlacklist(type: string, force = false, includeNames = false) {
  if (type === "users" || type === "groups") {
    if (cache_blacklist[type] === null || force === true) {
      try {
        const id_array = await getIDs(type, includeNames);
        cache_blacklist[type] = id_array;
        return id_array;
      } catch (error) {
        console.warn(`Failed to fetch ${type} blacklist:`, error);
        return cache_blacklist[type] ?? [];
      }
    } else {
      return cache_blacklist[type];
    }
  } else {
    throw new Error("Invalid input");
  }
}

export async function getBlacklistedGroupIDs(
  force = false,
  includeNames = false
) {
  return getBlacklist("groups", force, includeNames);
}

export async function getBlacklistedUserIDs(
  force = false,
  includeNames = false
) {
  return getBlacklist("users", force, includeNames);
}

export async function preloadBlacklists() {
  await Promise.allSettled([
    getBlacklist("users", true),
    getBlacklist("groups", true),
  ]);
}

export function isBlacklistAvailable(): boolean {
  return cache_blacklist.users !== null || cache_blacklist.groups !== null;
}

const BLACKLIST_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
setInterval(async () => {
  try {
    await preloadBlacklists();
  } catch (error) {
    console.error("Failed to refresh blacklist cache:", error);
  }
}, BLACKLIST_REFRESH_INTERVAL);
