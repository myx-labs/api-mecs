import got from "got";

import config from "./config.js";
import { AuditLogResponse } from "./AuditTypes.js";
import ImmigrationUser from "./ImmigrationUser.js";
import { getCookie } from "./cookies.js";
import { addToRankingLogs, getActionTimestampRange } from "./postgres.js";
import {
  RobloxAPI_GroupRolesetUserResponse,
  RobloxAPI_GroupUsersResponse,
} from "./types.js";
import { getCache, setPagingCursor } from "./cache.js";

const group = config.groups[0];

async function fetchRobloxURL(
  url: string,
  auditCookieRequired: boolean = false
) {
  const headers = {
    "content-type": "application/json;charset=UTF-8",
    cookie: undefined as string | undefined,
  };
  const cookie = await getCookie(auditCookieRequired);
  const ROBLOSECURITY = cookie.cookie;
  headers.cookie = `.ROBLOSECURITY=${ROBLOSECURITY};`;
  const response = await got
    .get(url, {
      throwHttpErrors: false,
      headers: headers,
    })
    .json();
  return response;
}

export async function getMembershipGroupStaff() {
  const response = (await fetchRobloxURL(
    `https://groups.roblox.com/v1/groups/${group.subgroups.membership}/users?sortOrder=Asc&limit=100`
  )) as RobloxAPI_GroupUsersResponse;
  return response.data;
}

export async function getMembershipStaff() {
  const response = (await fetchRobloxURL(
    `https://groups.roblox.com/v1/groups/${group.id}/roles/${group.rolesets.staff}/users?sortOrder=Asc&limit=100`
  )) as RobloxAPI_GroupRolesetUserResponse;
  return response.data;
}

async function getAuditLogPage(cursor?: string, userId?: number) {
  const response = await fetchRobloxURL(
    `https://groups.roblox.com/v1/groups/${
      group.id
    }/audit-log?actionType=ChangeRank&sortOrder=Asc&limit=100${
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
    const page = await getAuditLogPage(nextCursor);

    if (shouldCache) {
      await setPagingCursor(nextCursor);
    }

    const filteredPage = page.data.filter((item) => {
      const timestamp = new Date(item.created).getTime();
      const withinRolesetScope =
        item.description.NewRoleSetId === group.rolesets.citizen ||
        item.description.NewRoleSetId === group.rolesets.idc;
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

    if (filteredPage.length === 0) {
      if (specificRange) {
        const outOfRange = page.data.some(
          (item) =>
            specificRange.oldest.getTime() > new Date(item.created).getTime()
        );
        if (outOfRange) {
          break;
        }
      } else {
        break;
      }
    } else {
      for (const item of filteredPage) {
        try {
          const immigrationUser = new ImmigrationUser(
            item.description.TargetId
          );
          const [[pass, data], hccGamepassOwned] = await Promise.all([
            immigrationUser.criteriaPassing(
              item.description.OldRoleSetId === group.rolesets.citizen
            ),
            immigrationUser.getHCC().catch(() => false),
          ]);

          if (
            typeof immigrationUser.groupMembership?.role?.id !== "undefined"
          ) {
            await addToRankingLogs(
              item.actor.user.userId,
              item.description.TargetId,
              item.description.OldRoleSetId,
              item.description.NewRoleSetId,
              new Date(item.created),
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
    }

    if (page.nextPageCursor) {
      nextCursor = page.nextPageCursor;
    } else {
      // console.log(`Reached end of page, breaking loop to fetch new logs`);
      break;
    }
  }
  if (onlyNew || specificRange) {
    await delay(10 * 1000);
    await processAuditLogs(undefined, true);
  }
}
