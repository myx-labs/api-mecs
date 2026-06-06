// Modules
import got, { Response } from "got";

// Typings
import {
  IndividualTest,
  BlacklistedGroup,
  RobloxAPI_BadgeAwardResponse,
  RobloxAPI_ErrorResponse,
  RobloxAPI_Group_ApiArrayResponse,
  RobloxAPI_Group_GroupMembershipResponse,
  RobloxAPI_InventoryItemResponse,
  RankResponse,
  TestStatus,
  RobloxAPI_UserResponse,
} from "./types.js";

// Functions
import {
  getBlacklistedGroupIDs,
  getBlacklistedUserIDs,
  processReasonString,
} from "./scraper.js";
import config from "./config.js";
import { getCookie, updateCookieCSRF } from "./cookies.js";

const activeGroup = config.groups[0];
const rolesets = activeGroup.rolesets;
const array_rolesets = Object.values(rolesets);
const ROBLOX_REQUEST_TIMEOUT_MS = 10000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getArrayData<T>(json: unknown): T[] | null {
  if (Array.isArray(json)) {
    return json as T[];
  }
  if (isRecord(json) && Array.isArray(json.data)) {
    return json.data as T[];
  }
  return null;
}

function getRobloxErrorCode(json: unknown) {
  if (!isRecord(json) || !Array.isArray(json.errors)) {
    return undefined;
  }

  const [error] = json.errors;
  if (!isRecord(error)) {
    return undefined;
  }

  return typeof error.code === "number" ? error.code : undefined;
}

function getRobloxErrorMessage(json: unknown) {
  if (!isRecord(json) || !Array.isArray(json.errors)) {
    return undefined;
  }

  const errorResponse = json as RobloxAPI_ErrorResponse;
  const messages = errorResponse.errors
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

function isSuccessfulStatus(statusCode: number) {
  return statusCode >= 200 && statusCode < 300;
}

function getSuccessfulBody(response: Response<unknown>, context: string) {
  if (isSuccessfulStatus(response.statusCode)) {
    return response.body;
  }

  const robloxError = getRobloxErrorMessage(response.body);
  throw new Error(
    `${context} failed with HTTP ${response.statusCode}${
      response.statusMessage ? ` ${response.statusMessage}` : ""
    }${robloxError ? `: ${robloxError}` : ""}`
  );
}

function getCountData(json: unknown) {
  if (isRecord(json) && typeof json.count === "number") {
    return json.count;
  }
  return null;
}

function getUserData(json: unknown) {
  if (isRecord(json)) {
    return json as RobloxAPI_UserResponse;
  }
  return null;
}

function getGamepassOwnership(json: unknown) {
  if (typeof json === "boolean") {
    return json;
  }

  const data = getArrayData(json);
  if (data !== null) {
    return data.length > 0;
  }

  return null;
}

class PrivateInventoryError extends Error {
  constructor(userId: number) {
    super(`Not authorised to view ${userId} inventory`);
  }
}

interface RobloxFetchOptions {
  cookieRequired?: boolean;
}

export default class ImmigrationUser {
  userId: number;
  username: string | null;
  groupMembership: RobloxAPI_Group_GroupMembershipResponse | undefined;
  private lastRolesetId: number | null;
  private requestCache: Map<string, Response<unknown>> = new Map();

  constructor(
    userId: number,
    username: string | null = null,
    lastRolesetId: number | null = null
  ) {
    this.userId = userId;
    this.username = username;
    this.lastRolesetId = lastRolesetId;
  }

  async getUsername() {
    if (this.username === null) {
      let json: unknown = null;

      if (config.proxy.enabled) {
        json = await this.fetchDataProxy("user");
      } else {
        const response = await this.fetchUser();
        json = getSuccessfulBody(response, "Fetching user");
      }

      const user = getUserData(json);
      if (user && typeof user.name === "string") {
        this.username = user.name;
        return this.username;
      }
    }
    return this.username;
  }

  setUsername(username: string) {
    this.username = username;
  }

  async rankRoleset(rolesetId: number) {
    const respond = (changed: boolean, desc?: string) => {
      const response: RankResponse = {
        changed: changed,
        description: desc,
      };
      return response;
    };
    const currentRoleset = this.lastRolesetId;
    if (currentRoleset === null) {
      throw new Error("Unable to get current roleset");
    }
    const rolesetCovered = this.rolesetCovered(currentRoleset);
    const rolesetDifferent = currentRoleset !== rolesetId;
    const rolesetValid = rolesetCovered && rolesetDifferent;
    if (!rolesetCovered) {
      return respond(false, "Roleset ID is not covered");
    } else if (!rolesetDifferent) {
      return respond(false, "Target roleset is same as current user roleset");
    }
    if (rolesetValid) {
      const cookie = await getCookie(false, true);
      const ROBLOSECURITY = cookie.cookie;
      if (typeof cookie.csrf !== "string") {
        throw new Error("Selected rank cookie does not have a CSRF token");
      }
      let ROBLOX_X_CSRF_TOKEN = cookie.csrf;
      const rankUser = () =>
        got<unknown>(
          `https://groups.roblox.com/v1/groups/${activeGroup.id}/users/${this.userId}`,
          {
            throwHttpErrors: false,
            method: "PATCH",
            json: {
              roleId: rolesetId,
            },
            headers: {
              "content-type": "application/json",
              cookie: `.ROBLOSECURITY=${ROBLOSECURITY}`,
              "X-CSRF-TOKEN": ROBLOX_X_CSRF_TOKEN,
            },
            responseType: "json",
            timeout: { request: ROBLOX_REQUEST_TIMEOUT_MS },
          }
        );
      let response = await rankUser();
      const refreshedToken = response.headers["x-csrf-token"];
      if (response.statusCode === 403 && typeof refreshedToken === "string") {
        ROBLOX_X_CSRF_TOKEN = refreshedToken;
        await updateCookieCSRF(ROBLOSECURITY, refreshedToken);
        response = await rankUser();
      }
      if (response.statusCode === 200) {
        let descriptorString = null;
        for (const [key, value] of Object.entries(rolesets)) {
          if (value === rolesetId) {
            descriptorString = key;
          }
        }
        console.log(
          `${await this.getUsername()} (${
            this.userId
          }) ranked to ${descriptorString}`
        );
        return respond(true, `Player ranked to ${rolesetId}`);
      } else {
        const robloxError = getRobloxErrorMessage(response.body);
        throw new Error(
          `Error occurred attempting to rank user (${response.statusCode})${
            response.statusMessage ? ` ${response.statusMessage}` : ""
          }${robloxError ? `: ${robloxError}` : ""}`
        );
      }
    }
    return respond(false, "Roleset is s");
  }

  async getTestStatus(blacklist_only: boolean = false) {
    if (config.proxy.enabled) {
      await this.fetchUserDataViaProxy();
    } else {
      await Promise.all([this.fetchUser(), this.fetchGroups()]);
    }

    const isBanned = await this.isBanned();
    if (isBanned) {
      throw new Error("Banned");
    } else {
      if (!blacklist_only) {
        if (!config.proxy.enabled) {
          await Promise.all([
            this.fetchFriends(),
            this.fetchBadges(),
            this.fetchAccessories(),
          ]);
        }

        const tests = await Promise.all([
          this.testAge(),
          this.testBlacklist(),
          this.testAccessory(),
          this.testBadges(),
          this.testFriends(),
          this.testGroups(),
        ]);
        return {
          age: tests[0],
          blacklist: tests[1],
          accessory: tests[2],
          badges: tests[3],
          friends: tests[4],
          groups: tests[5],
        } as TestStatus;
      } else {
        const test = await this.testBlacklist();
        return {
          blacklist: test,
        } as TestStatus;
      }
    }
  }

  async testBlacklist() {
    const results = {
      status: true,
      values: {
        pass: true,
        current: true,
      },
      metadata: {
        player: false,
        group: [],
        src: {
          docs: activeGroup.blacklists.docs,
        },
      },
      descriptions: {
        pass: "Not a blacklisted user and not in any blacklisted groups",
        current: "",
      },
    } as IndividualTest;

    // Fetch user and group blacklists in parallel
    const [userBlacklistResult, blacklisted_groups] = await Promise.all([
      this.getUserBlacklisted().catch((error) => {
        console.error(error);
        throw new Error("Unable to fetch user blacklist");
      }),
      this.getGroupBlacklisted().catch(() => {
        throw new Error("Unable to fetch group blacklist");
      }),
    ]);

    // User blacklist
    const [user_blacklisted, reason] = userBlacklistResult;
    if (user_blacklisted) {
      results.status = false;
      results.values.current = false;
      results.metadata.player = true;
      results.metadata.reason =
        processReasonString(
          reason !== null ? reason : undefined,
          this.username ? this.username : undefined
        ) || undefined;
      if (results.descriptions)
        results.descriptions.current += `User is individually blacklisted`;
    } else {
      results.metadata.player = false;
      if (results.descriptions)
        results.descriptions.current += `User is not individually blacklisted`;
    }

    // Group blacklist
    if (blacklisted_groups.length > 0) {
      results.status = false;
      results.values.current = false;
      results.metadata.group = blacklisted_groups;
      if (results.descriptions)
        results.descriptions.current = `Account ${this.userId} is in ${blacklisted_groups.length} blacklisted groups`;
    } else {
      if (results.descriptions)
        results.descriptions.current = `Account ${this.userId} is not in any blacklisted groups`;
    }

    return results;
  }

  getTestPercentage(testStatus: any) {
    const keys = Object.keys(testStatus);
    let totalTests = 0;
    let passingTests = 0;

    keys.forEach((element) => {
      const test = testStatus[element];
      if (test) {
        if (element != "blacklist") {
          totalTests++;
        }
        if (test.status) {
          if (element != "blacklist") {
            passingTests++;
          }
        }
      }
    });
    return passingTests / totalTests;
  }

  async criteriaPassing(blacklistOnly: boolean) {
    type CriteriaResult = [boolean, TestStatus];
    const testStatus = await this.getTestStatus(blacklistOnly);
    if (testStatus.blacklist.status === true) {
      // If blacklist passed
      if (blacklistOnly) {
        return [true, testStatus] as CriteriaResult;
      } else {
        if (testStatus.age.status === true) {
          // If age test passing
          const testPercentage = this.getTestPercentage(testStatus);
          const passingPercentage = 0.75;
          if (testPercentage >= passingPercentage) {
            return [true, testStatus] as CriteriaResult;
          }
        }
      }
    }
    return [false, testStatus] as CriteriaResult;
  }

  async automatedReview() {
    const membership = await this.getMembership();
    if (membership) {
      let blacklistOnly = false;

      if (!membership.role?.id) {
        throw new Error("Membership ID not defined");
      }

      switch (membership.role.id) {
        case rolesets.citizen:
          blacklistOnly = true;
        case rolesets.pending:
          if (!config.flags.processPending) {
            throw new Error("Immigration processing disabled temporarily");
          } else {
            break;
          }
        default:
          break;
      }

      const [pass] = await this.criteriaPassing(blacklistOnly);
      let targetRoleset = rolesets.citizen;
      if (pass) {
        targetRoleset = rolesets.citizen;
      } else {
        targetRoleset = rolesets.idc;
      }
      const rankResponse = await this.rankRoleset(targetRoleset);
      return {
        changed: rankResponse.changed,
        passing: pass,
        exempt: this.isExempt(membership.role.id),
      };
    } else {
      throw new Error("Player is not inside the group");
    }
  }

  async testAge() {
    const results = {
      status: true,
      values: {
        pass: 60, // Max age
        current: 0,
      },
      descriptions: {
        pass: "At least 60 days old",
        current: null,
      },
    } as IndividualTest;

    const age: number = await this.getAge();

    results.status = age >= results.values.pass;
    results.values.current = age;
    if (typeof results.descriptions !== "undefined") {
      results.descriptions.current = `Account age is ${age}`;
    }

    return results;
  }

  async testAccessory() {
    const results = {
      status: true,
      values: {
        pass: 10,
        current: 0,
      },
      descriptions: {
        pass: "At least 10 accessories or private inventory",
        current: null,
      },
    } as IndividualTest;

    try {
      const acc_count = await this.getAccessoryCount();
      if (typeof acc_count === "number") {
        results.values.current = acc_count;
        if (results.descriptions)
          results.descriptions.current = `${acc_count} accessory(s) found`;

        if (acc_count >= results.values.pass) {
          results.status = true;
        } else {
          results.status = false;
        }
      }
    } catch (error) {
      if (!(error instanceof PrivateInventoryError)) {
        throw error;
      }
      results.values.current = null;
      if (results.descriptions)
        results.descriptions.current = `Private inventory`;
      results.status = true;
    }

    return results;
  }

  async testBadges() {
    const results = {
      status: true,
      values: {
        pass: 10, // Max age
        current: 0,
      },
      descriptions: {
        pass: "At least 10 badges",
        current: null,
      },
    } as IndividualTest;

    const badges: number = await this.getBadges();

    results.status = badges >= results.values.pass;
    results.values.current = badges;
    if (results.descriptions)
      results.descriptions.current = `User has ${badges} badge(s)`;

    return results;
  }

  async testFriends() {
    const results = {
      status: true,
      values: {
        pass: 5, // Max age
        current: 0,
      },
      descriptions: {
        pass: "At least 5 friends",
        current: null,
      },
    } as IndividualTest;

    const friends: number = await this.getFriends();

    results.status = friends >= results.values.pass;
    results.values.current = friends;
    if (results.descriptions)
      results.descriptions.current = `User has ${friends} friends(s)`;

    return results;
  }

  rolesetCovered(rolesetId: number) {
    return array_rolesets.includes(rolesetId);
  }

  isExempt(rolesetId: number) {
    return !this.rolesetCovered(rolesetId);
  }

  async testGroups() {
    const results = {
      status: true,
      values: {
        pass: 3, // Max age
        current: 0,
      },
      descriptions: {
        pass: "At least 3 groups",
        current: null,
      },
    } as IndividualTest;

    const groups: RobloxAPI_Group_GroupMembershipResponse[] =
      await this.getGroups();
    const group_count: number = groups.length;

    results.status = group_count >= results.values.pass;
    results.values.current = group_count;
    if (results.descriptions)
      results.descriptions.current = `User is in ${group_count} group(s)`;

    return results;
  }

  async fetchRobloxURL(url: string, options: RobloxFetchOptions = {}) {
    const cacheKey = `${options.cookieRequired ? "auth" : "anon"}:${url}`;
    const cacheHit = this.requestCache.get(cacheKey);
    if (cacheHit === undefined) {
      const headers = {
        "content-type": "application/json;charset=UTF-8",
        cookie: undefined as string | undefined,
      };

      if (options.cookieRequired) {
        const cookie = await getCookie();
        const ROBLOSECURITY = cookie.cookie;
        headers.cookie = `.ROBLOSECURITY=${ROBLOSECURITY};`;
      }

      const response = await got.get<unknown>(url, {
        throwHttpErrors: false,
        headers: headers,
        responseType: "json",
        timeout: { request: ROBLOX_REQUEST_TIMEOUT_MS },
      });

      const clone = Object.assign({}, response);
      this.requestCache.set(cacheKey, clone);
      return clone;
    } else {
      return Object.assign({}, cacheHit);
    }
  }

  proxyPromise: Promise<Response<unknown>> | null = null;

  async fetchUserDataViaProxy() {
    if (this.proxyPromise) {
      return this.proxyPromise;
    }

    try {
      this.proxyPromise = got.get<unknown>(
        `${config.proxy.url}?userId=${this.userId}`,
        {
          throwHttpErrors: false,
          responseType: "json",
          cache: config.cache,
          timeout: { request: ROBLOX_REQUEST_TIMEOUT_MS },
        }
      );

      const response = await this.proxyPromise;
      getSuccessfulBody(response, "Fetching proxy user data");

      return response;
    } catch (error) {
      this.proxyPromise = null;
      throw error;
    }
  }

  fetchUser() {
    return this.fetchRobloxURL(
      `https://users.roblox.com/v1/users/${this.userId}`
    );
  }

  fetchFriends() {
    return this.fetchRobloxURL(
      `https://friends.roblox.com/v1/users/${this.userId}/friends/count`
    );
  }

  fetchGroups() {
    return this.fetchRobloxURL(
      `https://groups.roblox.com/v2/users/${this.userId}/groups/roles`
    );
  }

  fetchBadges() {
    return this.fetchRobloxURL(
      `https://badges.roblox.com/v1/users/${this.userId}/badges?limit=10&sortOrder=Asc`,
      { cookieRequired: true }
    );
  }

  async fetchDataProxy(
    key: "user" | "friends" | "groups" | "badges" | "accessories"
  ) {
    const data = await this.fetchUserDataViaProxy();
    const body = data.body;
    if (!isRecord(body) || !(key in body)) {
      throw new Error(`Proxy response missing ${key} data`);
    }

    const payload = body[key];
    if (isRecord(payload) && "data" in payload) {
      return payload.data;
    }

    return payload;
  }

  fetchAccessories() {
    return this.fetchRobloxURL(
      `https://inventory.roblox.com/v2/users/${this.userId}/inventory?assetTypes=Shirt,Pants,Hat&limit=10&sortOrder=Asc`
    );
  }

  fetchGamepassOwnership(id: number) {
    return this.fetchRobloxURL(
      `https://inventory.roblox.com/v1/users/${this.userId}/items/GamePass/${id}/is-owned`
    );
  }

  async getHCC() {
    const response = await this.fetchGamepassOwnership(
      activeGroup.gamepasses.hcc.id
    );
    const json = getSuccessfulBody(response, "Fetching HCC data");
    const ownership = getGamepassOwnership(json);
    if (ownership !== null) {
      return ownership;
    }
    throw new Error("Error occured while fetching HCC data");
  }

  async getFirearms() {
    const response = await this.fetchGamepassOwnership(
      activeGroup.gamepasses.firearms.id
    );
    const json = getSuccessfulBody(response, "Fetching firearms licence data");
    const ownership = getGamepassOwnership(json);
    if (ownership !== null) {
      return ownership;
    }
    throw new Error("Error occured while fetching firearms licence data");
  }

  async getMembership() {
    await this.getGroups();
    if (this.groupMembership !== null) {
      if (this.groupMembership?.role?.id)
        this.lastRolesetId = this.groupMembership.role?.id;
    }
    return this.groupMembership;
  }

  async getFriends() {
    let json: unknown = null;

    if (config.proxy.enabled) {
      json = await this.fetchDataProxy("friends");
    } else {
      const response = await this.fetchFriends();
      json = getSuccessfulBody(response, "Fetching friends data");
    }

    const count = getCountData(json);
    if (count !== null) {
      return count;
    }

    throw new Error("Error occured while fetching friends data");
  }
  async getBadges() {
    let json: unknown = null;

    if (config.proxy.enabled) {
      json = await this.fetchDataProxy("badges");
    } else {
      const response = await this.fetchBadges();
      json = getSuccessfulBody(response, "Fetching badges data");
    }
    const badges = getArrayData<RobloxAPI_BadgeAwardResponse>(json);
    if (badges !== null) {
      return badges.length;
    }

    throw new Error("Error occured while fetching badges data");
  }

  async getGroups() {
    let json: RobloxAPI_Group_ApiArrayResponse | unknown = null;

    if (config.proxy.enabled) {
      json = await this.fetchDataProxy("groups");
    } else {
      const response = await this.fetchGroups();
      json = getSuccessfulBody(response, "Fetching group data");
    }

    const player_groups =
      getArrayData<RobloxAPI_Group_GroupMembershipResponse>(json);

    if (player_groups === null) {
      throw new Error("Group data not available");
    }

    player_groups.forEach(
      (player_group_membership: RobloxAPI_Group_GroupMembershipResponse) => {
        if (player_group_membership.group?.id === activeGroup.id) {
          this.groupMembership = player_group_membership;
        }
      }
    );
    return player_groups;
  }

  async getGroupBlacklisted() {
    const groups: RobloxAPI_Group_GroupMembershipResponse[] =
      await this.getGroups();
    const blacklisted_IDs = await getBlacklistedGroupIDs();
    const blacklistedGroups: BlacklistedGroup[] = [];
    if (blacklisted_IDs === null) {
      throw new Error("Unable to obtain blacklisted IDs");
    }
    const blacklistMap = new Map(
      blacklisted_IDs.map((b) => [b.id, b])
    );
    for (const player_group_membership of groups) {
      const group = player_group_membership.group;
      if (group?.id) {
        const blacklisted = blacklistMap.get(group.id);
        if (blacklisted) {
          blacklistedGroups.push({
            id: group.id,
            name: group.name,
            reason: blacklisted.reason || undefined,
          });
        }
      }
    }
    return blacklistedGroups;
  }

  async getUserBlacklisted() {
    const userIDs = await getBlacklistedUserIDs();
    if (userIDs === null) throw new Error("Unable to get user IDs");
    for (const blacklisted_id of userIDs) {
      if (blacklisted_id.id === this.userId) {
        return [true, blacklisted_id.reason] as [boolean, string];
      }
    }
    return [false, null] as [boolean, string | null];
  }

  async getAge() {
    let json: unknown = null;

    if (config.proxy.enabled) {
      json = await this.fetchDataProxy("user");
    } else {
      const response = await this.fetchUser();
      json = getSuccessfulBody(response, "Fetching age data");
    }

    const user = getUserData(json);
    if (user && typeof user.created === "string") {
      if (typeof user.name === "string") {
        this.setUsername(user.name);
      }
      const createdDate = new Date(user.created);
      if (Number.isNaN(createdDate.getTime())) {
        throw new Error("Unable to get age: invalid created date");
      }
      const currentDate = new Date();
      const timeDifference = currentDate.getTime() - createdDate.getTime();
      const age = Math.round(timeDifference / (1000 * 3600 * 24));
      return age;
    } else {
      // if (response.statusCode === 429) {
      //   throw new Error(`Unable to get age: too many requests`);
      // }
      throw new Error("Unable to get age");
    }
  }

  async isBanned() {
    let json: unknown = null;
    if (config.proxy.enabled) {
      json = await this.fetchDataProxy("user");
    } else {
      const response = await this.fetchUser();
      json = getSuccessfulBody(response, "Fetching banned status");
    }
    const user = getUserData(json);
    if (user && typeof user.isBanned === "boolean") {
      const banned = user.isBanned;
      return banned;
    } else {
      throw new Error("Unable to get banned status");
    }
  }

  async getAccessoryCount() {
    let json: unknown = null;

    if (config.proxy.enabled) {
      json = await this.fetchDataProxy("accessories");
    } else {
      const response = await this.fetchAccessories();
      json = response.body;
      if (!isSuccessfulStatus(response.statusCode)) {
        if (
          response.statusCode === 403 &&
          (getRobloxErrorCode(json) === 3 || getRobloxErrorCode(json) === 4)
        ) {
          throw new PrivateInventoryError(this.userId);
        }
        getSuccessfulBody(response, "Fetching accessories data");
      }
    }

    if (getRobloxErrorCode(json) === 3 || getRobloxErrorCode(json) === 4) {
      throw new PrivateInventoryError(this.userId);
    }

    const data = getArrayData<RobloxAPI_InventoryItemResponse>(json);
    if (data !== null) {
      return data.length;
    }

    throw new Error("Error occured while fetching accessories data");
  }
}
