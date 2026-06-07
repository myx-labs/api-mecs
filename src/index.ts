// Modules
import fastify, { FastifyError, FastifyRequest } from "fastify";
import fastifyCors from "@fastify/cors";
import { Type, TypeBoxTypeProvider } from "@fastify/type-provider-typebox";

import { http } from "./http.js";
import pLimit from "p-limit";

// Classes
import ImmigrationUser from "./ImmigrationUser.js";
import config from "./config.js";

import { EmbedBuilder, WebhookClient } from "discord.js";

const subsystemStatus = {
  cookies: { available: false, count: 0 },
  database: { available: false },
  blacklists: { available: false },
  discord: { available: false },
};

let webhookClient: WebhookClient | null = null;

if (
  config.credentials.discord.webhook.id &&
  config.credentials.discord.webhook.token
) {
  try {
    webhookClient = new WebhookClient({
      id: config.credentials.discord.webhook.id,
      token: config.credentials.discord.webhook.token,
    });
    subsystemStatus.discord.available = true;
  } catch {
    console.warn(
      "Discord webhook credentials are invalid, webhook logging disabled.",
    );
  }
} else {
  console.warn(
    "Discord webhook credentials not set, webhook logging disabled.",
  );
}

// Typings
import {
  DefaultAPIResponse,
  RobloxAPI_ApiArrayResponse,
  RobloxAPI_ErrorResponse,
  RobloxAPI_GroupUserItem,
  RobloxAPI_MultiGetUserByNameResponse,
} from "./types.js";
import {
  getBlacklistedGroupIDs,
  getBlacklistedUserIDs,
  isBlacklistAvailable,
  preloadBlacklists,
} from "./scraper.js";
import { getCookieCount, hasCookies, loadCookies } from "./cookies.js";
import {
  getAggregateActorData,
  getAggregateData,
  getDecisionValues,
  getMTBD,
  getRankingLogs,
  getTimeCaseStats,
  getUserIdFromUsername,
  isDatabaseAvailable,
  PGTimeCaseStats,
  startDB,
  stopDB,
} from "./postgres.js";

import { getMembershipGroupStaff, processAuditLogs } from "./AuditAccuracy.js";

const requestCounter = {
  valid: 0 + config.stats.previousQueries,
};

const sessionStart = new Date();
const group = config.groups[0];

// Variables

const server = fastify({
  trustProxy: true,
  requestTimeout: 30000,
  bodyLimit: 65536, // 64 KiB — all request bodies are small JSON
}).withTypeProvider<TypeBoxTypeProvider>();
const port: number = config.port;

const automated_limit = pLimit(1);
const manual_limit = pLimit(1);

const origins = [
  /localhost/,
  /127.0.0.1/,
  /yan3321\.com$/,
  /yan\.gg$/,
  /mysver\.se$/,
];

server.register(fastifyCors, {
  origin: origins,
});

// Safety net for any uncaught throw / validation error in a route handler, so
// the response is always clean JSON (and validation 4xx codes are preserved).
server.setErrorHandler((error: FastifyError, req, reply) => {
  console.error(`Error handling ${req.method} ${req.url}:`, error);
  reply.status(error.statusCode ?? 500).send({
    error: error.message || "Unknown error occurred",
  });
});

server.setNotFoundHandler((req, reply) => {
  reply.status(404).send({ error: "Not found" });
});

const flattenObject = (obj: any, prefix = "") =>
  Object.keys(obj).reduce((acc: any, k) => {
    const pre = prefix.length ? prefix + "." : "";
    if (typeof obj[k] === "object")
      Object.assign(acc, flattenObject(obj[k], pre + k));
    else acc[pre + k] = obj[k];
    return acc;
  }, {});

function isEmpty(text: string) {
  return text == null || text.match(/^\s*$/) !== null;
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

async function getImmigrationUser(
  userParam: string,
  inferType = true,
  treatAsUserId = false,
) {
  let userName: string | undefined;
  let userId: number | undefined;

  if (inferType) {
    treatAsUserId = !Number.isNaN(Number(userParam));
  }

  if (!treatAsUserId) {
    const dbUserId = (await getUserIdFromUsername(userParam)) || undefined;
    if (dbUserId) {
      userId = Number(dbUserId);
    } else {
      const response = await http<RobloxAPI_ApiArrayResponse>(
        `https://users.roblox.com/v1/usernames/users`,
        {
          method: "POST",
          json: {
            usernames: [userParam],
            excludeBannedUsers: true,
          },
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          responseType: "json",
        },
      );

      if (response.statusCode !== 200) {
        const robloxError = getRobloxErrorMessage(response.body);
        throw new Error(
          `Username lookup failed with HTTP ${response.statusCode}${
            response.statusMessage ? ` ${response.statusMessage}` : ""
          }${robloxError ? `: ${robloxError}` : ""}`,
        );
      }

      const json = response.body;
      if (!Array.isArray(json.data)) {
        throw new Error(
          "Username lookup response did not include a data array",
        );
      }

      if (json.data.length === 0) {
        throw new Error("No user found with that username!");
      }

      const match = json.data.find(
        (element: RobloxAPI_MultiGetUserByNameResponse) =>
          element.requestedUsername?.toLowerCase() === userParam.toLowerCase(),
      );
      if (match) {
        if (match.name && match.id) {
          userName = match.name;
          userId = match.id;
        } else {
          throw new Error("Unable to get name and ID of user!");
        }
      }
    }
  } else {
    userId = Number(userParam);
  }

  if (!userId) {
    throw new Error("Unable to get user ID!");
  }

  return new ImmigrationUser(userId, userName);
}

async function logPayload(req: FastifyRequest, payload: any) {
  if (!webhookClient) return;
  try {
    requestCounter.valid++;
    const requestEmbed = new EmbedBuilder()
      .setFields([
        {
          name: "Request URL",
          value: req.url,
          inline: true,
        },
        {
          name: "Request IP",
          value: req.ips ? req.ips[req.ips.length - 1] : "unavailable",
          inline: true,
        },
      ])
      .setTitle("Request data")
      .setTimestamp();
    const userEmbed = new EmbedBuilder()
      .setFields([
        {
          name: "User ID",
          value: payload.user.userId.toString(),
          inline: true,
        },
        {
          name: "User Name",
          value: payload.user.username ?? "Unknown",
          inline: true,
        },
      ])
      .setTitle("User data");
    const testEmbed = new EmbedBuilder()
      .setFields(
        Object.keys(payload.tests).map((key) => {
          const test = payload.tests[key as keyof typeof payload.tests];
          return {
            name: key,
            value: test.status ? "Yes" : "No",
          };
        }),
      )
      .setTitle("Test data");
    webhookClient
      .send({
        username: "MECS",
        embeds: [requestEmbed, userEmbed, testEmbed],
      })
      .catch((err) => console.error("Discord webhook send failed:", err));
  } catch (error) {
    console.error("Failed to log payload to Discord:", error);
  }
}

server.get("/health", async () => {
  const allAvailable =
    subsystemStatus.cookies.available &&
    subsystemStatus.database.available &&
    subsystemStatus.blacklists.available &&
    subsystemStatus.discord.available;
  return {
    status: allAvailable ? "ok" : "degraded",
    uptime: process.uptime(),
    subsystems: subsystemStatus,
  };
});

server.get("/blacklist/groups", async (req, res) => {
  try {
    return await getBlacklistedGroupIDs(true, true);
  } catch (error) {
    res.status(500);
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
});

server.get("/blacklist/users", async (req, res) => {
  try {
    return await getBlacklistedUserIDs(true, true);
  } catch (error) {
    res.status(500);
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
});

interface MembershipAction {
  officer?: number;
  officerName?: string;
  target: {
    name: string;
    id: number;
  };
  action: "Grant" | "Refusal";
  correct: boolean;
  timestamps: {
    action: Date;
    review?: Date;
  };
  data?: DefaultAPIResponse;
}

interface AuditDecisionData {
  dar: {
    percentage: number;
    data: {
      correct: number;
      total: number;
      valid?: {
        correct: number;
        total: number;
      };
    };
  };
  atbd?: {
    data: number[];
    mtbd: {
      mean: number | null;
      mode: number | null;
      median: number | null;
    };
  };

  last5: MembershipAction[];
}

async function getRankingHistory(targetId: number) {
  const rows = await getRankingLogs(undefined, undefined, targetId);
  const logs: MembershipAction[] = [];
  for (const item of rows) {
    let valid = false;
    const pass = item.review_pass;
    if (
      pass !== null &&
      item.review_data !== null &&
      item.review_timestamp !== null
    ) {
      if (parseInt(item.new_role_id) === group.rolesets.citizen) {
        valid = pass;
      } else {
        valid = !pass;
      }
      logs.push({
        officer: parseInt(item.actor_id),
        officerName:
          membershipStaffCache.find(
            (cacheItem) => cacheItem.user?.userId === parseInt(item.actor_id),
          )?.user?.username || undefined,
        target: {
          id: parseInt(item.target_id),
          name: item.review_data.user.username,
        },
        action:
          parseInt(item.new_role_id) === group.rolesets.citizen
            ? "Grant"
            : "Refusal",
        correct: valid,
        timestamps: {
          action: item.action_timestamp,
          review: item.review_timestamp,
        },
        data: item.review_data,
      });
    }
  }
  return logs;
}

interface AggregateData {
  actors: number;
  dar: {
    total: number;
    correct: number;
  };
  mtbd: number | null;
  timeRange: {
    latest: Date;
    oldest: Date;
  };
}

const cacheUpdateInterval = 5 * 60 * 1000; // 5 minutes

let aggregateDataCache: AggregateData | null = null;
let aggregateRefreshing = false;

async function updateAggregateDataCache() {
  if (aggregateRefreshing) return; // skip if a previous refresh is still running
  aggregateRefreshing = true;
  try {
    aggregateDataCache = await getAggregateData();
  } catch (error) {
    console.error("Failed to update aggregate data cache:");
    console.error(error);
  } finally {
    aggregateRefreshing = false;
  }
}

setInterval(updateAggregateDataCache, cacheUpdateInterval).unref();

server.get("/audit/accuracy", async (req, res) => {
  try {
    if (aggregateDataCache === null) {
      aggregateDataCache = await getAggregateData();
    }
    if (aggregateDataCache === null) {
      res.status(503);
      return { error: "Aggregate data is currently unavailable" };
    }
    return aggregateDataCache;
  } catch (error) {
    res.status(500);
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
});

let timeCaseStatsCache: PGTimeCaseStats[] | null = null;
let timeCaseStatsRefreshing = false;

async function updateTimeCaseStats() {
  if (timeCaseStatsRefreshing) return; // skip if a previous refresh is still running
  timeCaseStatsRefreshing = true;
  try {
    timeCaseStatsCache = await getTimeCaseStats();
  } catch (error) {
    console.error("Failed to update time case stats data cache:");
    console.error(error);
  } finally {
    timeCaseStatsRefreshing = false;
  }
}

setInterval(updateTimeCaseStats, cacheUpdateInterval).unref();

server.get("/stats/case", async (req, res) => {
  try {
    if (timeCaseStatsCache === null) {
      timeCaseStatsCache = await getTimeCaseStats();
    }
    return timeCaseStatsCache
      .map((item) => ({
        time: new Date(item.time),
        users: parseInt(item.users),
        granted: parseInt(item.granted),
        total: parseInt(item.total),
      }))
      .sort((a, b) => a.time.getTime() - b.time.getTime());
  } catch (error) {
    res.status(500);
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
});

async function getDecisionDataForAllOfficers() {
  const actorData = await getAggregateActorData();

  return actorData.map((data) => {
    const darData = data.dar;
    const mtbdData = data.mtbd;
    const decisions = {
      dar: {
        percentage: 0,
        data: {
          correct: 0,
          total: 0,
        },
      },

      atbd: {
        data: [] as number[],
        mtbd: {
          mean: null as number | null,
          mode: null as number | null,
          median: null as number | null,
        },
      },

      last5: [] as MembershipAction[],
    } as AuditDecisionData;

    decisions.dar.data.valid = darData.valid;
    decisions.dar.data.correct = darData.correct;
    decisions.dar.data.total = darData.total;
    decisions.dar.percentage =
      (decisions.dar.data.correct / decisions.dar.data.total) * 100;

    if (typeof mtbdData !== "number") {
      decisions.atbd = undefined;
    } else {
      // decisions.atbd.mtbd.mean = mean(decisions.atbd.data);
      if (decisions.atbd) decisions.atbd.mtbd.mode = mtbdData;
      // decisions.atbd.mtbd.median = median(decisions.atbd.data);
    }
    return {
      id: data.actorId,
      decisions: decisions,
    };
  });
}

async function getDecisionDataForOfficer(id: number) {
  const [darData, mtbdData, rows2] = await Promise.all([
    getDecisionValues(id),
    getMTBD(id),
    getRankingLogs(5, id, undefined),
  ]);

  if (darData?.total === 0 || darData === null) {
    throw new Error("No records for this actor");
  }

  const decisions = {
    dar: {
      percentage: 0,
      data: {
        correct: 0,
        total: 0,
      },
    },

    atbd: {
      data: [] as number[],
      mtbd: {
        mean: null as number | null,
        mode: null as number | null,
        median: null as number | null,
      },
    },
    last5: [] as MembershipAction[],
  } as AuditDecisionData;

  rows2.forEach((item2) => {
    let valid = false;

    const pass = item2.review_pass;

    if (pass !== null && item2.review_data && item2.review_timestamp) {
      if (parseInt(item2.new_role_id) === group.rolesets.citizen) {
        valid = pass;
      } else {
        valid = !pass;
      }
      decisions.last5.push({
        target: {
          id: parseInt(item2.target_id),
          name: item2.review_data.user.username,
        },
        action:
          parseInt(item2.new_role_id) === group.rolesets.citizen
            ? "Grant"
            : "Refusal",
        correct: valid,
        timestamps: {
          action: item2.action_timestamp,
          review: item2.review_timestamp,
        },
      });
    }
  });

  decisions.dar.data.correct = darData.correct;
  decisions.dar.data.total = darData.total;
  decisions.dar.percentage =
    (decisions.dar.data.correct / decisions.dar.data.total) * 100;

  if (typeof mtbdData !== "number") {
    delete decisions.atbd;
  } else {
    // decisions.atbd.mtbd.mean = mean(decisions.atbd.data);
    if (decisions.atbd) decisions.atbd.mtbd.mode = mtbdData;
    // decisions.atbd.mtbd.median = median(decisions.atbd.data);
  }

  return decisions;
}

async function preloadDecisionData() {
  const decisions = await getDecisionDataForAllOfficers();
  return decisions;
}

let membershipStaffCache: RobloxAPI_GroupUserItem[] = [];

let officerDecisionDataCache: OfficerDecisionData[] | null = null;

interface OfficerDecisionData {
  officer: {
    id: number;
    name?: string;
  };
  decisions: AuditDecisionData;
}

async function getOfficerDecisionData() {
  const [officers, decisionData] = await Promise.all([
    getMembershipGroupStaff(),
    preloadDecisionData(),
  ]);
  membershipStaffCache = officers;
  const data: OfficerDecisionData[] = [];
  for (const item of officers) {
    const decisions = decisionData.find(
      (item2) => item2.id === item.user?.userId,
    );
    const user = item.user;
    if (user?.userId && decisions) {
      const dataItem: OfficerDecisionData = {
        officer: {
          id: user.userId,
          name: user.username,
        },
        decisions: decisions.decisions,
      };
      data.push(dataItem);
    }
  }
  const filtered = data.filter((item) => typeof item.decisions !== "undefined");
  filtered.sort((a, z) =>
    z.decisions.dar.data.total > a.decisions.dar.data.total ? 1 : -1,
  );
  return filtered;
}

let officerDecisionRefreshing = false;

async function updateOfficerDecisionDataCache() {
  if (officerDecisionRefreshing) return; // skip if a previous refresh is still running
  officerDecisionRefreshing = true;
  try {
    officerDecisionDataCache = await getOfficerDecisionData();
  } catch (error) {
    console.error("Failed to update officer decision data cache:");
    console.error(error);
  } finally {
    officerDecisionRefreshing = false;
  }
}

setInterval(updateOfficerDecisionDataCache, cacheUpdateInterval).unref();

server.get("/audit/staff", async (req, res) => {
  try {
    if (officerDecisionDataCache === null) {
      officerDecisionDataCache = await getOfficerDecisionData();
    }
    return officerDecisionDataCache;
  } catch (error) {
    res.status(500);
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
});

server.get(
  "/audit/staff/:id",
  {
    schema: {
      params: Type.Object({
        id: Type.String(),
      }),
    },
  },
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (id) {
        const decisions = await getDecisionDataForOfficer(id);
        return decisions;
      } else {
        throw new Error("Invalid ID");
      }
    } catch (error) {
      res.status(500);
      return {
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
);

enum ParamType {
  ID = "id",
  Name = "name",
}

server.get(
  "/user/:id",
  {
    schema: {
      params: Type.Object({
        id: Type.String(),
      }),
      querystring: Type.Object({
        blacklistOnly: Type.Optional(Type.Boolean()),
        includeHistory: Type.Optional(Type.Boolean()),
        paramType: Type.Optional(
          Type.Union([Type.Literal("id"), Type.Literal("name")]),
        ),
      }),
      // no idea why but header types can't be inferred without this line
      headers: Type.Object({}),
    },
  },
  async (req, res) => {
    const userParam: string = req.params.id;
    const blacklistOnly =
      typeof req.query.blacklistOnly !== "undefined"
        ? req.query.blacklistOnly
        : false;
    const includeHistory =
      typeof req.query.includeHistory !== "undefined"
        ? req.query.includeHistory
        : true;

    const paramType = req.query.paramType;

    try {
      if (isEmpty(userParam)) {
        throw new Error("User parameter is not valid.");
      }
      const limit = (() => {
        const origin = req.headers.origin;
        if (origin) {
          if (origins.some((rx) => rx.test(origin))) {
            console.log("Manual limit in use");
            return manual_limit;
          }
        }
        return automated_limit;
      })();
      const user = await limit(() => {
        return getImmigrationUser(
          userParam,
          typeof paramType === "undefined",
          paramType === "id",
        );
      });

      const [testResults, hccGamepassOwned, firearmsGamepassOwned, history] =
        await Promise.all([
          limit(async () => user.getTestStatus(blacklistOnly)),
          user.getHCC().catch(() => false),
          user.getFirearms().catch(() => false),
          includeHistory
            ? getRankingHistory(user.userId).catch(() => undefined)
            : undefined,
        ]);

      if (testResults !== null && typeof testResults !== "undefined") {
        const payload = {
          user: {
            userId: user.userId,
            username: user.username,
            groupMembership: user.groupMembership,
            hccGamepassOwned: hccGamepassOwned,
            firearmsGamepassOwned: firearmsGamepassOwned,
            exempt: user.groupMembership?.role?.id
              ? user.isExempt(user.groupMembership?.role?.id)
              : false,
          },
          tests: testResults,
          group: group,
          history: history,
        };
        logPayload(req, payload);
        return payload;
      } else {
        throw new Error("Test results are null");
      }
    } catch (error) {
      res.status(500);
      console.error(error);
      return {
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
);

server.post(
  "/user/:id/automated-review",
  {
    schema: {
      params: Type.Object({
        id: Type.String(),
      }),
      querystring: Type.Object({
        blacklistOnly: Type.Optional(Type.Boolean()),
      }),
      // no idea why but header types can't be inferred without this line
      headers: Type.Object({}),
    },
  },
  async (req, res) => {
    const userParam: string = req.params.id;
    try {
      if (isEmpty(userParam)) {
        throw new Error("User parameter is not valid.");
      }
      const limit = (() => {
        const origin = req.headers.origin;
        if (origin) {
          if (origins.some((rx) => rx.test(origin))) {
            console.log("Manual limit in use");
            return manual_limit;
          }
        }
        return automated_limit;
      })();
      const user = await limit(() => {
        return getImmigrationUser(userParam, true);
      });
      const results = await limit(() => {
        return user.automatedReview();
      });
      res.status(200);
      return results;
    } catch (error) {
      res.status(500);
      return {
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  },
);

server.get("/session", async (req, res) => {
  try {
    return {
      requestCounter: requestCounter,
      sessionStart: sessionStart,
    };
  } catch (error) {
    res.status(500);
    return {
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
});

async function bootstrap() {
  await Promise.allSettled([loadCookies(), startDB(), preloadBlacklists()]);

  subsystemStatus.cookies.available = hasCookies();
  subsystemStatus.cookies.count = getCookieCount();
  subsystemStatus.database.available = isDatabaseAvailable();
  subsystemStatus.blacklists.available = isBlacklistAvailable();

  await Promise.allSettled([
    updateAggregateDataCache(),
    updateOfficerDecisionDataCache(),
  ]);

  const address = await server.listen({ port: port });
  console.log(`Server listening at ${address}`);

  // Start at most one audit pipeline. The in-flight guard in processAuditLogs
  // rejects overlapping runs, so we must not kick off two concurrent pipelines.
  // A configured gap-fill takes priority because it backfills its range and then
  // transitions into continuous polling on its own; otherwise we start the
  // configured processing mode.
  const fillAuditGaps = config.flags.fillAuditGaps;
  const gapRange =
    fillAuditGaps.enabled && fillAuditGaps.range.from && fillAuditGaps.range.to
      ? { latest: fillAuditGaps.range.from, oldest: fillAuditGaps.range.to }
      : null;

  if (gapRange) {
    console.log("Filling audit data gap...");
    processAuditLogs(undefined, false, gapRange).catch((err) =>
      console.error("processAuditLogs (gap fill) failed:", err),
    );
  } else if (config.flags.processAudit) {
    if (config.flags.onlyNewAudit) {
      console.log("Processing latest audit logs...");
      processAuditLogs(undefined, true).catch((err) =>
        console.error("processAuditLogs (latest) failed:", err),
      );
    } else {
      console.log("Processing all audit logs...");
      processAuditLogs(undefined, false).catch((err) =>
        console.error("processAuditLogs (all) failed:", err),
      );
    }
  }
}

await bootstrap();

let shuttingDown = false;

async function shutdown(exitCode = 0) {
  if (shuttingDown) return; // guard against re-entry (e.g. signal + uncaughtException)
  shuttingDown = true;
  console.log("Shutting down gracefully...");

  // Hard-exit fallback in case server.close()/stopDB() hangs.
  const hardExit = setTimeout(() => {
    console.error("Graceful shutdown timed out; forcing exit.");
    process.exit(exitCode);
  }, 10_000);
  hardExit.unref();

  try {
    await server.close();
    await stopDB();
  } catch (error) {
    console.error("Error during shutdown:", error);
  } finally {
    clearTimeout(hardExit);
    process.exit(exitCode);
  }
}

process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));

// Log and continue: floating rejections are common and usually benign here
// (e.g. webhook sends, background audit work).
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

// An uncaught exception means unknown/corrupt state: log, drain briefly, then
// exit non-zero so the process manager (PM2) restarts us cleanly.
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  void shutdown(1);
});

// Surface runtime warnings (e.g. MaxListenersExceededWarning) into the logs.
process.on("warning", (warning) => {
  console.warn("Process warning:", warning.name, warning.message);
});
