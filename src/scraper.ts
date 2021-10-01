import { docs, auth, docs_v1 } from "@googleapis/docs";

import config from "./config.js";
const groups = config.groups;

const cache_blacklist = {
  users: null as number[],
  groups: null as number[],
};

declare global {
  interface Array<T> {
    inArray(comparer: Function): boolean;
    pushIfNotExist(element: any, comparer: Function): void;
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

const doc_auth = new auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/documents.readonly"],
  credentials: config.credentials.google,
});

function extractIDsFromDocument(res: docs_v1.Schema$Document, regex: RegExp) {
  const idArray: number[] = [];
  res.body.content.forEach((value) => {
    const paragraph = value.paragraph;
    if (paragraph) {
      const elements = paragraph.elements;
      if (elements) {
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
                            idArray.pushIfNotExist(id, (element: any) => {
                              return element === id;
                            });
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

async function getIDs(type: string) {
  let documentId = null;
  let regex: RegExp = null;
  if (type === "users") {
    documentId = groups[0].blacklists.docs[type];
    regex = /\/users\/(\d+)/;
  } else if (type === "groups") {
    documentId = groups[0].blacklists.docs[type];
    regex = /\/groups\/(\d+)/;
  }
  if (documentId != null && regex != null) {
    const doc_obj = docs({ version: "v1", auth: doc_auth });
    const res = await doc_obj.documents.get({
      documentId: documentId,
    });
    const document = res.data;
    const ids = extractIDsFromDocument(document, regex);
    return ids;
  }
}

async function getBlacklist(type: string, force = false) {
  if (type === "users" || type === "groups") {
    if (cache_blacklist[type] === null || force === true) {
      const id_array = await getIDs(type);
      cache_blacklist[type] = id_array;
      return id_array;
    } else {
      return cache_blacklist[type];
    }
  } else {
    throw new Error("Invalid input");
  }
}

export async function getBlacklistedGroupIDs(force = true) {
  return getBlacklist("groups", force);
}

export async function getBlacklistedUserIDs(force = true) {
  return getBlacklist("users", force);
}
