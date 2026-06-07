import { http } from "./http.js";

import config from "./config.js";
import { AuditLogItem, AuditLogResponse } from "./AuditTypes.js";
import ImmigrationUser from "./ImmigrationUser.js";
import { getCookie } from "./cookies.js";
import {
  addToRankingLogs,
  checkIfExists,
  getActionTimestampRange,
} from "./postgres.js";
import {
  RobloxAPI_GroupRolesetUserResponse,
  RobloxAPI_GroupUsersResponse,
} from "./types.js";
import { getCache, setPagingCursor } from "./cache.js";

const group = config.groups[0];
const AUDIT_RETRY_DELAY_MS = 10 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getRobloxErrorMessage(response: unknown) {
  if (!isRecord(response) || !Array.isArray(response.errors)) {
    return undefined;
  }

  const messages = response.errors
    .map((error) => {
      if (!isRecord(error)) {
        return String(error);
      }
      const code =
        typeof error.code === "number" || typeof error.code === "string"
          ? `code ${error.code}`
          : undefined;
      const message =
        typeof error.message === "string" ? error.message : undefined;
      return [code, message].filter(Boolean).join(": ");
    })
    .filter((message) => message.length > 0);

  return messages.length > 0 ? messages.join("; ") : undefined;
}

function getAuditLogItems(page: unknown) {
  if (isRecord(page) && Array.isArray(page.data)) {
    return page.data as AuditLogItem[];
  }
  return null;
}

async function fetchRobloxURL(
  url: string,
  cookieRequired: boolean = false
) {
  const headers = {
    "content-type": "application/json;charset=UTF-8",
    cookie: undefined as string | undefined,
  };
  if (cookieRequired) {
    const cookie = await getCookie(cookieRequired);
    if (cookie === null) {
      throw new Error("Cookie required but no cookies are available");
    }
    const ROBLOSECURITY = cookie.cookie;
    headers.cookie = `.ROBLOSECURITY=${ROBLOSECURITY};`;
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
    `Roblox request failed with HTTP ${response.statusCode}${
      response.statusMessage ? ` ${response.statusMessage}` : ""
    }${robloxError ? `: ${robloxError}` : ""}`
  );
}

export async function getMembershipGroupStaff() {
  const response = (await fetchRobloxURL(
    `https://groups.roblox.com/v1/groups/${group.subgroups.membership}/users?sortOrder=Asc&limit=100`
  )) as RobloxAPI_GroupUsersResponse;
  if (!Array.isArray(response.data)) {
    throw new Error("Membership staff response did not include a data array");
  }
  return response.data;
}

export async function getMembershipStaff() {
  const response = (await fetchRobloxURL(
    `https://groups.roblox.com/v1/groups/${group.id}/roles/${group.rolesets.staff}/users?sortOrder=Asc&limit=100`
  )) as RobloxAPI_GroupRolesetUserResponse;
  if (!Array.isArray(response.data)) {
    throw new Error(
      "Membership roleset staff response did not include a data array"
    );
  }
  return response.data;
}

async function getAuditLogPage(cursor?: string, userId?: number) {
  const response = await fetchRobloxURL(
    `https://groups.roblox.com/v1/groups/${
      group.id
    }/audit-log?actionType=ChangeRank&sortOrder=Desc&limit=100${
      userId ? `&userId=${userId}` : ""
    }${cursor ? `&cursor=${cursor}` : ""}`,
    true
  );
  return response as AuditLogResponse;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface AuditRange {
  latest: Date;
  oldest: Date;
}

export async function processAuditLogs(
  limit?: number,
  onlyNew = false,
  specificRange?: AuditRange
) {
  let counter = 0;
  let nextCursor: string | undefined = undefined;

  const shouldCache = !onlyNew && !specificRange;

  if (shouldCache) {
    const cache = await getCache();
    if (typeof cache.lastPagingCursor === "string") {
      console.log(`Loading cached paging cursor: ${cache.lastPagingCursor}`);
      nextCursor = cache.lastPagingCursor;
    }
  }

  let range = await getActionTimestampRange();

  if (specificRange) {
    range = specificRange;
  }

  while (typeof limit !== "undefined" ? counter < limit : true) {
    let page: AuditLogResponse;

    try {
      page = await getAuditLogPage(nextCursor);
    } catch (error) {
      if (onlyNew) {
        console.error("Failed to fetch audit log page, retrying:", error);
        await delay(AUDIT_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }

    const pageData = getAuditLogItems(page);
    if (pageData === null) {
      const robloxError = getRobloxErrorMessage(page);
      const message = `Audit log response did not include a data array${
        robloxError ? ` (${robloxError})` : ""
      }`;

      if (onlyNew) {
        console.error(`${message}; retrying.`);
        await delay(AUDIT_RETRY_DELAY_MS);
        continue;
      }

      throw new Error(message);
    }

    if (shouldCache) {
      await setPagingCursor(nextCursor);
    }

    const filteredPage = pageData.filter((item) => {
      const timestamp = new Date(item.created).getTime();
      if (Number.isNaN(timestamp)) {
        return false;
      }
      const rolesetId = item.description?.NewRoleSetId;
      const withinRolesetScope =
        rolesetId === group.rolesets.citizen ||
        rolesetId === group.rolesets.idc;
      let timeRange = timestamp > range.oldest.getTime();
      if (onlyNew) {
        timeRange = timestamp > range.latest.getTime();
      }
      if (specificRange) {
        timeRange =
          timestamp > range.oldest.getTime() &&
          timestamp < range.latest.getTime();
      }
      return timeRange && withinRolesetScope;
    });

    const shouldStop = (() => {
      if (filteredPage.length === 0) {
        if (specificRange) {
          const outOfRange = pageData.some((item) => {
            const timestamp = new Date(item.created).getTime();
            return (
              !Number.isNaN(timestamp) &&
              specificRange.oldest.getTime() > timestamp
            );
          });
          return outOfRange;
        }
        return true;
      }
      return false;
    })();

    if (shouldStop) {
      break;
    }

    for (const item of filteredPage) {
      try {
        const actorId = item.actor.user.userId;
        const targetId = item.description.TargetId;
        const oldRolesetId = item.description.OldRoleSetId;
        const newRolesetId = item.description.NewRoleSetId;
        const actionTimestamp = new Date(item.created);

        const exists = await checkIfExists(
          actorId,
          targetId,
          oldRolesetId,
          newRolesetId,
          actionTimestamp
        );

        if (exists) continue;

        const immigrationUser = new ImmigrationUser(targetId);

        const [[pass, data], hccGamepassOwned] = await Promise.all([
          immigrationUser.criteriaPassing(
            oldRolesetId === group.rolesets.citizen
          ),
          immigrationUser.getHCC().catch(() => false),
        ]);

        if (typeof immigrationUser.groupMembership?.role?.id !== "undefined") {
          await addToRankingLogs(
            actorId,
            targetId,
            oldRolesetId,
            newRolesetId,
            actionTimestamp,
            new Date(),
            pass,
            {
              user: {
                userId: immigrationUser.userId,
                username:
                  (await immigrationUser.getUsername()) ||
                  immigrationUser.userId.toString(),
                groupMembership: immigrationUser.groupMembership,
                hccGamepassOwned: hccGamepassOwned,
                exempt:
                  immigrationUser.groupMembership != null
                    ? immigrationUser.isExempt(
                        immigrationUser.groupMembership.role.id
                      )
                    : false,
              },
              tests: data,
              group: group,
            }
          );
          counter++;
        }
      } catch (error) {
        console.error(error);
      }
    }

    if (page.nextPageCursor) {
      nextCursor = page.nextPageCursor;
    } else {
      // console.log(`Reached end of page, breaking loop to fetch new logs`);
      break;
    }
  }
  if (onlyNew || specificRange) {
    await delay(AUDIT_RETRY_DELAY_MS);
    await processAuditLogs(undefined, true);
  }
}
