import got from "got";

import config from "./config.js";
import { AuditLogItem, AuditLogResponse } from "./AuditTypes.js";
import ImmigrationUser from "./ImmigrationUser.js";
import { getCookie } from "./cookies.js";

const group = config.groups[0];

async function fetchRobloxURL(url: string, cookieRequired: boolean = false) {
  const headers = {
    "content-type": "application/json;charset=UTF-8",
    cookie: undefined as string,
  };
  if (cookieRequired) {
    const cookie = await getCookie(true);
    const ROBLOSECURITY = cookie.cookie;
    headers.cookie = `.ROBLOSECURITY=${ROBLOSECURITY};`;
  }
  const response = await got
    .get(url, {
      throwHttpErrors: false,
      headers: headers,
    })
    .json();
  return response;
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

export async function getAuditLog(limit: number = 10) {
  const logs: AuditLogItem[] = [];
  let nextCursor: string | undefined = undefined;

  while (logs.length < limit) {
    const page = await getAuditLogPage(nextCursor);
    for (const item of page.data) {
      if (
        item.description.NewRoleSetId === group.rolesets.citizen ||
        item.description.NewRoleSetId === group.rolesets.idc
      ) {
        if (logs.length < limit) {
          logs.push(item);
        } else {
          break;
        }
      }
    }
    if (page.nextPageCursor) {
      nextCursor = page.nextPageCursor;
    }
  }

  interface AuditResultItem {
    name: string;
    officer: string;
    previousRank: string;
    newRank: string;
    timestamp: number;
    valid: boolean;
  }

  const data: AuditResultItem[] = [];
  for (const item of logs) {
    try {
      let valid = false;
      const immigrationUser = new ImmigrationUser(item.description.TargetId);
      const [pass] = await immigrationUser.criteriaPassing(
        item.description.OldRoleSetId === group.rolesets.citizen
      );
      if (item.description.NewRoleSetId === group.rolesets.citizen) {
        valid = pass;
      } else {
        valid = !pass;
      }
      // await addToRankingLogs(
      //   item.actor.user.userId,
      //   item.description.TargetId,
      //   item.description.OldRoleSetId,
      //   item.description.NewRoleSetId,
      //   new Date(item.created),
      //   valid,
      //   undefined,
      //   new Date()
      // );
      const object = {
        name: item.description.TargetName,
        officer: item.actor.user.username,
        previousRank: item.description.OldRoleSetName,
        newRank: item.description.NewRoleSetName,
        timestamp: new Date(item.created).getTime(),
        valid: valid,
      };
      data.push(object);
    } catch (error) {}
  }

  return data;
}
