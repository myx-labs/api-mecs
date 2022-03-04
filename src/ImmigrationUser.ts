// Modules
import got, { Response } from "got";

// Typings
import {
  IndividualTest,
  BlacklistedGroup,
  RobloxAPI_Group_ApiArrayResponse,
  RobloxAPI_Group_GroupMembershipResponse,
  RankResponse,
  CombinedTestResults,
} from "./types.js";

// Functions
import getCSRFToken from "./csrf.js";
import { getBlacklistedGroupIDs, getBlacklistedUserIDs } from "./scraper.js";
import config from "./config.js";

const ROBLOSECURITY = config.credentials.roblox;

const activeGroup = config.groups[0];
const rolesets = activeGroup.rolesets;
const array_rolesets = Object.values(rolesets);

interface cachedResponse {
  url: string;
  response: Response;
}

export default class ImmigrationUser {
  userId: number;
  username: string;
  groupMembership: RobloxAPI_Group_GroupMembershipResponse;
  private lastRolesetId: number;
  private requestCache: cachedResponse[] = [];

  constructor(
    userId: number,
    username: string = null,
    lastRolesetId: number = null
  ) {
    this.userId = userId;
    this.username = username;
    this.lastRolesetId = lastRolesetId;
  }

  async getUsername() {
    if (this.username === null) {
      const response = await this.fetchUser();
      if (response.statusCode === 200) {
        const json = response.body as any;
        if (json) {
          this.username = json.name;
          return this.username;
        }
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
    const rolesetCovered = this.rolesetCovered(currentRoleset);
    const rolesetDifferent = currentRoleset !== rolesetId;
    const rolesetValid = rolesetCovered && rolesetDifferent;
    if (!rolesetCovered) {
      return respond(false, "Roleset ID is not covered");
    } else if (!rolesetDifferent) {
      return respond(false, "Target roleset is same as current user roleset");
    }
    if (rolesetValid) {
      const ROBLOX_X_CSRF_TOKEN: string = await getCSRFToken(true);
      const response = await got(
        `https://groups.roblox.com/v1/groups/${activeGroup.id}/users/${this.userId}`,
        {
          throwHttpErrors: false,
          method: "PATCH",
          body: JSON.stringify({
            roleId: rolesetId,
          }),
          headers: {
            "content-type": "application/json",
            cookie: `.ROBLOSECURITY=${ROBLOSECURITY}`,
            "X-CSRF-TOKEN": ROBLOX_X_CSRF_TOKEN,
          },
        }
      );
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
        console.error(response);
        throw new Error(
          `Error occurred attempting to rank user: ${response.statusMessage}`
        );
      }
    }
    return respond(false, "Roleset is s");
  }

  async getTestStatus(blacklist_only: boolean = false) {
    await Promise.all([this.fetchUser(), this.fetchGroups()]);
    const isBanned = await this.isBanned();
    if (isBanned) {
      throw new Error("Banned");
    } else {
      if (!blacklist_only) {
        await Promise.all([
          this.fetchFriends(),
          this.fetchBadges(),
          this.fetchAccessories(),
        ]);
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
        };
      } else {
        const test = await this.testBlacklist();
        return {
          blacklist: test,
        };
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

    // User blacklist

    try {
      const user_blacklisted: boolean = await this.getUserBlacklisted();
      if (user_blacklisted) {
        results.status = false;
        results.values.current = false;
        results.metadata.player = true;
        results.descriptions.current += `User is individually blacklisted`;
      } else {
        results.metadata.player = false;
        results.descriptions.current += `User is not individually blacklisted`;
      }
    } catch (error) {
      throw new Error("Unable to fetch user blacklist");
    }

    // Group blacklist

    try {
      const blacklisted_groups: BlacklistedGroup[] =
        await this.getGroupBlacklisted();
      if (blacklisted_groups.length > 0) {
        results.status = false;
        results.values.current = false;
        results.metadata.group = blacklisted_groups;
        results.descriptions.current = `Account ${this.userId} is in ${blacklisted_groups.length} blacklisted groups`;
      } else {
        results.descriptions.current = `Account ${this.userId} is not in any blacklisted groups`;
      }
    } catch (error) {
      throw new Error("Unable to fetch group blacklist");
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
    const testStatus = await this.getTestStatus(blacklistOnly);
    if (testStatus.blacklist.status === true) {
      // If blacklist passed
      if (blacklistOnly) {
        return [true, testStatus];
      } else {
        if (testStatus.age.status === true) {
          // If age test passing
          const testPercentage = this.getTestPercentage(testStatus);
          const passingPercentage = 0.75;
          if (testPercentage >= passingPercentage) {
            return [true, testStatus];
          }
        }
      }
    }
    return [false, testStatus];
  }

  async automatedReview() {
    const membership = await this.getMembership();
    if (membership !== null) {
      let blacklistOnly = false;

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
    results.descriptions.current = `Account age is ${age}`;

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
      const acc_count: number = await this.getAccessoryCount();
      results.values.current = acc_count;
      results.descriptions.current = `${acc_count} accessory(s) found`;

      if (acc_count >= results.values.pass) {
        results.status = true;
      }
    } catch (error) {
      results.values.current = null;
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
    results.descriptions.current = `User is in ${group_count} group(s)`;

    return results;
  }

  async fetchRobloxURL(url: string, cookieRequired: boolean = false) {
    const cacheHit = this.requestCache.find((element) => element.url === url);
    if (cacheHit === undefined) {
      const headers = {
        "content-type": "application/json;charset=UTF-8",
        cookie: undefined as string,
      };
      if (cookieRequired) {
        headers.cookie = `.ROBLOSECURITY=${ROBLOSECURITY};`;
      }
      const response = await got.get(url, {
        throwHttpErrors: false,
        headers: headers,
        responseType: "json",
      });
      const clone = Object.assign({}, response);
      this.requestCache.push({ url: url, response: clone });
      return clone;
    } else {
      return Object.assign({}, cacheHit.response);
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
      `https://badges.roblox.com/v1/users/${this.userId}/badges?limit=10&sortOrder=Asc`
    );
  }

  fetchAccessories() {
    return this.fetchRobloxURL(
      `https://inventory.roblox.com/v2/users/${this.userId}/inventory?assetTypes=Shirt,Pants,Hat&limit=10&sortOrder=Asc`
    );
  }

  fetchGamepassOwnership(id: number) {
    return this.fetchRobloxURL(
      `https://inventory.roblox.com/v1/users/${this.userId}/items/GamePass/${id}`
    );
  }

  async getHCC() {
    const response = await this.fetchGamepassOwnership(
      activeGroup.gamepasses.hcc.id
    );
    if (response.statusCode === 200) {
      const json = response.body as any;
      return (json.data as any[]).length > 0;
    } else {
      throw new Error("Error occured while fetching HCC data");
    }
  }

  async getMembership() {
    await this.getGroups();
    if (this.groupMembership !== null) {
      this.lastRolesetId = this.groupMembership.role.id;
    }
    return this.groupMembership;
  }

  async getFriends() {
    const response = await this.fetchFriends();
    if (response.statusCode === 200) {
      const json = response.body as any;
      return json.count as number;
    } else {
      throw new Error("Error occured while fetching friends data");
    }
  }
  async getBadges() {
    const response = await this.fetchBadges();
    if (response.statusCode === 200) {
      const json = response.body as any;
      return json.data.length as number;
    } else {
      throw new Error("Error occured while fetching badges data");
    }
  }

  async getGroups() {
    const response = await this.fetchGroups();
    const json: RobloxAPI_Group_ApiArrayResponse = response.body as any;
    const player_groups: RobloxAPI_Group_GroupMembershipResponse[] = json.data;
    player_groups.forEach(
      (player_group_membership: RobloxAPI_Group_GroupMembershipResponse) => {
        if (player_group_membership.group.id === activeGroup.id) {
          this.groupMembership = player_group_membership;
        }
      }
    );
    return player_groups;
  }

  async getGroupBlacklisted() {
    const groups: RobloxAPI_Group_GroupMembershipResponse[] =
      await this.getGroups();
    const blacklisted_IDs: number[] = await getBlacklistedGroupIDs();
    const blacklistedGroups: BlacklistedGroup[] = [];
    groups.forEach(
      (player_group_membership: RobloxAPI_Group_GroupMembershipResponse) => {
        const group = player_group_membership.group;
        blacklisted_IDs.forEach((blacklistedGroupID) => {
          if (group.id === blacklistedGroupID) {
            blacklistedGroups.push({
              id: group.id,
              name: group.name,
            });
          }
        });
      }
    );
    return blacklistedGroups;
  }

  async getUserBlacklisted() {
    const userIDs: number[] = await getBlacklistedUserIDs();
    for (const blacklisted_id of userIDs) {
      if (blacklisted_id === this.userId) {
        return true;
      }
    }
    return false;
  }

  async getAge() {
    const response = await this.fetchUser();
    if (response.statusCode === 200) {
      const json = response.body as any;
      this.setUsername(json.name);
      const createdDate = new Date(json.created);
      const currentDate = new Date();
      const timeDifference = currentDate.getTime() - createdDate.getTime();
      const age = Math.round(timeDifference / (1000 * 3600 * 24));
      return age;
    } else {
      if (response.statusCode === 429) {
        throw new Error(`Unable to get age: too many requests`);
      }
      throw new Error("Unable to get age");
    }
  }

  async isBanned() {
    const response = await this.fetchUser();
    if (response.statusCode === 200) {
      const json = response.body as any;
      const banned = json.isBanned as boolean;
      return banned;
    } else {
      if (response.statusCode === 429) {
        throw new Error(`Unable to get banned status: too many requests`);
      }
      throw new Error("Unable to get banned status");
    }
  }

  async getAccessoryCount() {
    const response = await this.fetchAccessories();
    const json = response.body as any;
    if (response.statusCode === 200) {
      return json.data.length as number;
    } else {
      if (json.errors[0].code === 4) {
        throw new Error("Not authorised to view " + this.userId + " inventory");
      }
    }
  }
}
