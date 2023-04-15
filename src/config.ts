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
  port:
    typeof process.env.API_PORT !== "undefined"
      ? parseInt(process.env.API_PORT)
      : 3000,
  credentials: {
    google:
      typeof process.env.GOOGLEAUTH !== "undefined"
        ? JSON.parse(process.env.GOOGLEAUTH)
        : undefined,
    api: process.env.AUTHENTICATION_KEY as string,
    discord: {
      webhook: {
        id: process.env.DISCORD_WEBHOOK_ID as string,
        token: process.env.DISCORD_WEBHOOK_TOKEN as string,
      },
    },
  },
  proxy: {
    enabled: process.env.USE_WORKER_PROXY === "true",
    url: process.env.WORKER_PROXY_URL as string,
  },
  flags: {
    loadCache: process.env.LOAD_AUDIT_PROGRESS_FROM_CACHE === "true",
    processPending: process.env.DISABLE_PENDING_PROCESSING !== "true",
    processAudit: process.env.ENABLE_AUDIT_PROCESSING === "true",
    onlyNewAudit: process.env.ONLY_PROCESS_LATEST_AUDITS === "true",
    fillAuditGaps: {
      enabled: process.env.FILL_DATA_GAP === "true",
      range: {
        from: process.env.FILL_FROM_TIMESTAMP
          ? new Date(process.env.FILL_FROM_TIMESTAMP)
          : null,
        to: process.env.FILL_TO_TIMESTAMP
          ? new Date(process.env.FILL_TO_TIMESTAMP)
          : null,
      },
    },
  },
  stats: {
    previousQueries:
      typeof process.env.PREVIOUS_QUERY_COUNT !== "undefined"
        ? parseInt(process.env.PREVIOUS_QUERY_COUNT)
        : 0,
  },
};
