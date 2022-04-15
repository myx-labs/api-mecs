import got from "got";

import config from "./config.js";
import { AuditLogResponse } from "./AuditTypes.js";
import ImmigrationUser from "./ImmigrationUser.js";
import { getCookie } from "./cookies.js";
import {
  addToRankingLogs,
  getActionTimestampRange,
  getRankingLogs,
} from "./postgres.js";
import { RobloxAPI_GroupRolesetUserResponse } from "./types.js";
import { getCache, setPagingCursor } from "./cache.js";

const group = config.groups[0];

async function fetchRobloxURL(
  url: string,
  auditCookieRequired: boolean = false
) {
  const headers = {
    "content-type": "application/json;charset=UTF-8",
    cookie: undefined as string,
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
    }/audit-log?actionType=ChangeRank&sortOrder=Asc&limit=10${
      userId ? `&userId=${userId}` : ""
    }${cursor ? `&cursor=${cursor}` : ""}`,
    true
  );
  return response as AuditLogResponse;
}

export async function processAuditLogs(limit?: number) {
  let counter = 0;
  let nextCursor: string | undefined = undefined;
  const cache = await getCache();
  if (typeof cache.lastPagingCursor === "string") {
    console.log(`Loading cached paging cursor: ${cache.lastPagingCursor}`);
    nextCursor = cache.lastPagingCursor;
  }
  const range = await getActionTimestampRange();
  console.log(`Processing logs outside of given range`);
  console.log(range);
  while (counter < limit || typeof limit === "undefined") {
    process.stdout.write(
      `Next cursor: ${nextCursor}, ${counter} logs processed\r`
    );
    const page = await getAuditLogPage(nextCursor);
    await setPagingCursor(nextCursor);
    const filteredPage = page.data.filter((item) => {
      const timestamp = new Date(item.created).getTime();
      const inrange =
        timestamp <= range.latest.getTime() &&
        timestamp >= range.oldest.getTime();
      const withinRolesetScope =
        item.description.NewRoleSetId === group.rolesets.citizen ||
        item.description.NewRoleSetId === group.rolesets.idc;
      return !inrange && withinRolesetScope;
    });
    for (const item of filteredPage) {
      try {
        const immigrationUser = new ImmigrationUser(item.description.TargetId);
        const [[pass, data], hccGamepassOwned] = await Promise.all([
          immigrationUser.criteriaPassing(
            item.description.OldRoleSetId === group.rolesets.citizen
          ),
          immigrationUser.getHCC().catch(() => false),
        ]);
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
              username: await immigrationUser.getUsername(),
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
      } catch (error) {
        console.error(error);
      }
    }
    if (page.nextPageCursor) {
      nextCursor = page.nextPageCursor;
    } else {
      break;
    }
  }
}
