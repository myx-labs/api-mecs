import { config as config_env } from "dotenv-safe";
config_env();

export default {
  testMode: false,
  cursorInterval: 3,
  groups: [
    {
      id: 1143446,
      subgroups: {
        membership: 5231965,
      },
      rolesets: {
        pending: 7475347,
        idc: 7476578,
        citizen: 7476582,
        staff: 7979816,
      },
      gamepasses: {
        hcc: {
          id: 1251870,
        },
      },
      blacklists: {
        docs: {
          users: "1SurqGXE34siGefJTGiUQfZgHnC6l3xlatGcVBI8mn8A",
          groups: "1viFDTScJyvTVwUWdkNFWt-1eVu7yvRxp5ST7S-pH2eY",
        },
      },
    },
  ],
  port: parseInt(process.env.API_PORT) as number,
  credentials: {
    google: JSON.parse(process.env.GOOGLEAUTH),
    api: process.env.AUTHENTICATION_KEY as string,
    discord: {
      webhook: {
        id: process.env.DISCORD_WEBHOOK_ID as string,
        token: process.env.DISCORD_WEBHOOK_TOKEN as string,
      },
    },
  },
  flags: {
    loadCache: process.env.LOAD_FROM_CACHE === "true",
    processPending: process.env.DISABLE_PENDING_PROCESSING !== "true",
    processAudit: process.env.ENABLE_AUDIT_PROCESSING === "true",
  },
  stats: {
    previousQueries: parseInt(process.env.PREVIOUS_QUERY_COUNT) || 0,
  },
};
