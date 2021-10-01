// Modules
import { config as config_env } from "dotenv";
config_env();
import got from "got";
import fastify from "fastify";
import pLimit from "p-limit";
import fastifyCors from "fastify-cors";

// Classes
import ImmigrationUser from "./ImmigrationUser.js";
import config from "./config.js";

// Typings
import {
  RobloxAPI_ApiArrayResponse,
  RobloxAPI_MultiGetUserByNameResponse,
} from "./types.js";
import getCSRFToken from "./csrf.js";
import { getBlacklistedGroupIDs, getBlacklistedUserIDs } from "./scraper.js";

// Variables

const server = fastify();
const port: number = config.port;

const automated_limit = pLimit(1);
const manual_limit = pLimit(1);

server.register(fastifyCors, {
  origin: [/localhost/, /yanix\.dev$/, /yan3321\.com$/, /yan\.gg$/],
});

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
        if (req.headers.origin === "https://mys-iefe.yanix.dev") {
          console.log("Manual limit in use");
          return manual_limit;
        }
        return automated_limit;
      })();
      const user = await limit(() => {
        return getImmigrationUser(userParam, userId, userName);
      });
      const testResults: object = await limit(() => {
        return user.getTestStatus(blacklistOnly);
      });
      if (testResults) {
        res.send({
          user: {
            userId: user.userId,
            username: user.username,
            groupMembership: user.groupMembership,
            exempt:
              user.groupMembership != null
                ? user.isExempt(user.groupMembership.role.id)
                : false,
          },
          tests: testResults,
        });
      } else {
        res.status(500);
      }
    } catch (error) {
      if (error instanceof Error) {
        res.status(500);
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
        if (req.headers.origin === "https://mys-iefe.yanix.dev") {
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

async function bootstrap() {
  await getCSRFToken();
  server.listen(port, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Server listening at ${address}`);
  });
}

await bootstrap();
