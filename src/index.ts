// Modules
import { config as config_env } from "dotenv";
config_env();
import got from "got";
import fastify, { FastifyRequest } from "fastify";
import pLimit from "p-limit";
import fastifyCors from "fastify-cors";

// Classes
import ImmigrationUser from "./ImmigrationUser.js";
import config from "./config.js";

import { MessageEmbed, WebhookClient } from "discord.js";

const webhookClient = new WebhookClient({
  id: config.credentials.discord.webhook.id,
  token: config.credentials.discord.webhook.token,
});

// Typings
import {
  DefaultAPIResponse,
  RobloxAPI_ApiArrayResponse,
  RobloxAPI_MultiGetUserByNameResponse,
} from "./types.js";
import getCSRFToken from "./csrf.js";
import { getBlacklistedGroupIDs, getBlacklistedUserIDs } from "./scraper.js";

const requestCounter = {
  valid: 0 + config.stats.previousQueries,
};

const sessionStart = new Date();

// Variables

const server = fastify({ trustProxy: "127.0.0.1" });
const port: number = config.port;

const automated_limit = pLimit(1);
const manual_limit = pLimit(1);

server.register(fastifyCors, {
  origin: [/localhost/, /yan3321\.com$/, /yan\.gg$/, /127.0.0.1/],
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

async function getImmigrationUser(
  userParam: string,
  userId: number,
  userName: string
) {
  if (Number.isNaN(userId)) {
    const response = await got(`https://users.roblox.com/v1/usernames/users`, {
      throwHttpErrors: false,
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
    });
    if (response) {
      if (response.statusCode === 200) {
        const json: RobloxAPI_ApiArrayResponse = response.body;
        if (json.data.length !== 0) {
          json.data.forEach((element: RobloxAPI_MultiGetUserByNameResponse) => {
            if (element.requestedUsername === userParam) {
              userName = element.name;
              userId = element.id;
            }
          });
        } else {
          throw new Error("No user found with that username!");
        }
      } else {
        console.error(response);
      }
    }
  }
  return new ImmigrationUser(userId, userName);
}

async function logPayload(req: FastifyRequest, payload: any) {
  try {
    requestCounter.valid++;
    const requestEmbed = new MessageEmbed()
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
    const userEmbed = new MessageEmbed()
      .setFields([
        {
          name: "User ID",
          value: payload.user.userId.toString(),
          inline: true,
        },
        {
          name: "User Name",
          value: payload.user.username,
          inline: true,
        },
      ])
      .setTitle("User data");
    const testEmbed = new MessageEmbed()
      .setFields(
        Object.keys(payload.tests).map((key) => {
          const test = payload.tests[key as keyof typeof payload.tests];
          return {
            name: key,
            value: test.status ? "Yes" : "No",
          };
        })
      )
      .setTitle("Test data");
    webhookClient.send({
      username: "MECS",
      embeds: [requestEmbed, userEmbed, testEmbed],
    });
  } catch {}
}

interface userParams {
  id: string;
}

interface userParams2 {
  blacklistOnly: string;
}

server.get("/blacklist/groups", async (req, res) => {
  try {
    res.send(await getBlacklistedGroupIDs());
  } catch (error) {
    if (error instanceof Error) {
      res.status(500);
      res.send({ error: error.message });
    } else {
      res.status(500);
      res.send({ error: "Unknown error occured" });
    }
  }
});

server.get("/blacklist/users", async (req, res) => {
  try {
    res.send(await getBlacklistedUserIDs());
  } catch (error) {
    if (error instanceof Error) {
      res.status(500);
      res.send({ error: error.message });
    } else {
      res.status(500);
      res.send({ error: "Unknown error occured" });
    }
  }
});

server.get<{ Params: userParams; Querystring: userParams2 }>(
  "/user/:id",
  async (req, res) => {
    const userParam: string = req.params.id;
    const blacklistOnly = req.query.blacklistOnly === "true";
    let userId: number = Number(userParam);
    let userName: string = null;

    try {
      if (isEmpty(userParam)) {
        throw new Error("User parameter is not valid.");
      }
      const limit = (() => {
        if (req.headers.origin === "https://mys-mecs.yan.gg") {
          console.log("Manual limit in use");
          return manual_limit;
        }
        return automated_limit;
      })();
      const user = await limit(() => {
        return getImmigrationUser(userParam, userId, userName);
      });

      const [testResults, hccGamepassOwned] = await Promise.all([
        limit(async () => user.getTestStatus(blacklistOnly)),
        user.getHCC().catch(() => false),
      ]);

      if (testResults !== null && typeof testResults !== "undefined") {
        const payload: DefaultAPIResponse = {
          user: {
            userId: user.userId,
            username: user.username,
            groupMembership: user.groupMembership,
            hccGamepassOwned: hccGamepassOwned,
            exempt:
              user.groupMembership != null
                ? user.isExempt(user.groupMembership.role.id)
                : false,
          },
          tests: testResults,
        };
        logPayload(req, payload);
        res.send(payload);
      } else {
        res.status(500);
      }
    } catch (error) {
      if (error instanceof Error) {
        res.status(500);
        console.error(error);
        res.send({ error: error.message });
      } else {
        res.status(500);
        res.send({ error: "Unknown error occured" });
      }
    }
  }
);

server.post<{ Params: userParams; Querystring: userParams2 }>(
  "/user/:id/automated-review",
  async (req, res) => {
    const userParam: string = req.params.id;
    let userId: number = Number(userParam);
    let userName: string = null;
    try {
      if (isEmpty(userParam)) {
        throw new Error("User parameter is not valid.");
      }
      const limit = (() => {
        if (req.headers.origin === "https://mys-mecs.yan.gg") {
          console.log("Manual limit in use");
          return manual_limit;
        }
        return automated_limit;
      })();
      const user = await limit(() => {
        return getImmigrationUser(userParam, userId, userName);
      });
      const results = await limit(() => {
        return user.automatedReview();
      });
      res.status(200);
      res.send(results);
    } catch (error) {
      let errorString = "Unknown error occured";
      if (error instanceof Error) {
        errorString = error.message;
      }
      res.status(500);
      res.send({ error: errorString });
    }
  }
);

server.get("/session", async (req, res) => {
  try {
    res.send({
      requestCounter: requestCounter,
      sessionStart: sessionStart,
    });
  } catch (error) {
    if (error instanceof Error) {
      res.status(500);
      res.send({ error: error.message });
    } else {
      res.status(500);
      res.send({ error: "Unknown error occured" });
    }
  }
});

async function bootstrap() {
  await getCSRFToken();
  const address = await server.listen(port);
  console.log(`Server listening at ${address}`);
}

await bootstrap();
