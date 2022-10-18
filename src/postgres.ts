import config from "./config.js";
import pkg from "pg";
import { DefaultAPIResponse } from "./types.js";
import PostgresInterval from "postgres-interval";
const { Pool } = pkg;

import {
  parse as parseIsoDuration,
  toSeconds as durationToSeconds,
} from "iso8601-duration";

const pool = new Pool();

const table = "mecs.action_log";

export async function startDB() {
  try {
    await pool.connect();
  } catch (error) {
    console.error(error);
    throw new Error("Unable to connect to Postgres database!");
  }
}

interface PGCount {
  count: string;
}

interface PGLogItem {
  actor_id: string;
  target_id: string;
  old_role_id: string;
  new_role_id: string;
  action_timestamp: Date;
  review_timestamp: Date | null;
  review_pass: boolean | null;
  review_data: DefaultAPIResponse | null;
}

interface PGAuditCount {
  correct: string;
  total: string;
}

interface PGModeTimeBetweenDecisions {
  mtbd: PostgresInterval.IPostgresInterval;
}

interface PGActorIds {
  actor_id: string;
}

interface PGAggregateActorData {
  actor_id: string;
  total: string;
  correct: string;
  valid_total: string;
  valid_correct: string;
  mtbd: PostgresInterval.IPostgresInterval;
}

interface PGAggregateData {
  actors: string;
  total: string;
  correct: string;
  valid_total: string;
  valid_correct: string;
  mtbd: PostgresInterval.IPostgresInterval;
}

interface PGTimestampRange {
  action_timestamp: Date;
}

export async function getDistinctActorIds() {
  let query = `SELECT DISTINCT actor_id FROM ${table}`;
  const response = await pool.query<PGActorIds>(query);
  return response.rows.map((item) => parseInt(item.actor_id));
}

export async function getActionTimestampRange() {
  let query = `
    (SELECT action_timestamp
    FROM ${table}
    ORDER BY action_timestamp DESC
    LIMIT 1)
    
    UNION ALL
    
    (SELECT action_timestamp
    FROM ${table}
    ORDER BY action_timestamp ASC    
    LIMIT 1)
  `;
  const response = await pool.query<PGTimestampRange>(query);
  const rows = response.rows;
  const latest = rows[0].action_timestamp;
  const oldest = rows[1].action_timestamp;
  return {
    latest,
    oldest,
  };
}

const group = config.groups[0];

export async function createTable() {
  // This function has not been tested, proceed with caution
  // Use manually when setting up a new database
  let query = `
    CREATE TABLE ${table} (
      "actor_id" int8 NOT NULL,
      "target_id" int8 NOT NULL,
      "old_role_id" int8 NOT NULL,
      "new_role_id" int8 NOT NULL,
      "action_timestamp" timestamptz NOT NULL,
      "review_timestamp" timestamptz,
      "review_pass" bool,
      "review_data" json
    );
  `;
  await pool.query(query);
}

function getPostgresIntervalInSeconds(
  interval: PostgresInterval.IPostgresInterval
) {
  return durationToSeconds(parseIsoDuration(interval.toISOString()));
}

export async function getAggregateData() {
  let query = `
      SELECT 
        COUNT(DISTINCT actor_id) as actors, 
        COUNT(*) as total, 
        COUNT(
          CASE WHEN (
            review_pass = true 
            AND new_role_id = ${group.rolesets.citizen}
          ) 
          OR (
            review_pass = false 
            AND new_role_id = ${group.rolesets.idc}
          ) THEN 1 ELSE null END
        ) AS correct,
        COUNT(
            CASE
                WHEN (
                    DATE_PART('day', review_timestamp - action_timestamp) = 0
                ) THEN 1
                ELSE null
            END
        ) AS valid_total,
        COUNT(
            CASE
                WHEN (
                    review_pass = true
                    AND new_role_id = ${group.rolesets.citizen}
                    AND DATE_PART('day', review_timestamp - action_timestamp) = 0
                )
                OR (
                    review_pass = false
                    AND new_role_id = ${group.rolesets.idc}
                    AND DATE_PART('day', review_timestamp - action_timestamp) = 0
                ) THEN 1
                ELSE null
            END
        ) AS valid_correct, 
        (
          SELECT 
            mode() WITHIN GROUP (
              ORDER BY 
                difference_action_timestamp
            ) AS mtbd 
          FROM 
            (
              SELECT 
                action_timestamp - LAG(action_timestamp) OVER (
                  ORDER BY 
                    action_timestamp
                ) AS difference_action_timestamp 
              FROM 
              ${table}
            ) AS mtbdTable
        ) as mtbd 
      FROM 
        ${table}
  `;
  const [response, timestampRange] = await Promise.all([
    pool.query<PGAggregateData>(query),
    getActionTimestampRange(),
  ]);
  const item = response.rows[0];
  return {
    actors: parseInt(item.actors),
    dar: {
      total: parseInt(item.total),
      correct: parseInt(item.correct),
      valid: {
        total: parseInt(item.valid_total),
        correct: parseInt(item.valid_correct),
      },
    },
    mtbd: getPostgresIntervalInSeconds(item.mtbd) || null,
    timeRange: timestampRange,
  };
}

export async function getAggregateActorData() {
  let query = `
      SELECT 
        ${table}.actor_id, 
        COUNT(*) as total, 
        COUNT(
          CASE WHEN (
            review_pass = true 
            AND new_role_id = ${group.rolesets.citizen}
          ) 
          OR (
            review_pass = false 
            AND new_role_id = ${group.rolesets.idc}
          ) THEN 1 ELSE null END
        ) AS correct,
        COUNT(
          CASE WHEN (
            DATE_PART('day', review_timestamp - action_timestamp) = 0
          ) THEN 1 ELSE null END
        ) AS valid_total,
        COUNT(
          CASE WHEN (
            review_pass = true 
            AND new_role_id = ${group.rolesets.citizen}
            AND DATE_PART('day', review_timestamp - action_timestamp) = 0
          ) 
          OR (
            review_pass = false 
            AND new_role_id = ${group.rolesets.idc}
            AND DATE_PART('day', review_timestamp - action_timestamp) = 0
          ) THEN 1 ELSE null END
        ) AS valid_correct, 
        mtbd_table.mtbd 
      FROM 
        ${table} 
        LEFT JOIN (
          SELECT 
            actor_id, 
            mode() WITHIN GROUP (
              ORDER BY 
                difference_action_timestamp
            ) AS mtbd 
          FROM 
            (
              SELECT 
                actor_id, 
                action_timestamp - LAG(action_timestamp) OVER (
                  ORDER BY 
                    action_timestamp
                ) AS difference_action_timestamp 
              FROM 
                ${table}
            ) AS mtbdTable 
          GROUP BY 
            actor_id
        ) as mtbd_table ON ${table}.actor_id = mtbd_table.actor_id 
      GROUP BY 
        ${table}.actor_id, 
        mtbd_table.mtbd 
      ORDER BY 
        total DESC;

  `;
  const response = await pool.query<PGAggregateActorData>(query);
  return response.rows.map((item) => ({
    actorId: parseInt(item.actor_id),
    dar: {
      total: parseInt(item.total),
      correct: parseInt(item.correct),
      valid:
        parseInt(item.valid_total) > 0
          ? {
              total: parseInt(item.valid_total),
              correct: parseInt(item.valid_correct),
            }
          : undefined,
    },
    mtbd: getPostgresIntervalInSeconds(item.mtbd) || null,
  }));
}

export async function getMTBD(actorId: number) {
  let query = `
    SELECT 
      mode() WITHIN GROUP (
        ORDER BY 
          difference_action_timestamp
      ) AS mtbd 
    FROM 
      (
        SELECT 
          action_timestamp - LAG(action_timestamp) OVER (
            ORDER BY 
              action_timestamp
          ) AS difference_action_timestamp 
        FROM 
          ${table} 
        WHERE 
          actor_id = $1
      ) AS mtbdTable
  `;
  let values: any[] = [actorId];
  const response = await pool.query<PGModeTimeBetweenDecisions>(query, values);
  if (response.rows.length === 0) {
    return null;
  }
  const item = response.rows[0];
  // console.dir(item.mtbd, { depth: null });
  if (item.mtbd) {
    return getPostgresIntervalInSeconds(item.mtbd);
  }
  return null;
}

export async function getDecisionValues(actorId: number) {
  const group = config.groups[0];
  const rolesets = group.rolesets;
  let query = `SELECT (SELECT COUNT(*) FROM ${table} WHERE actor_id = $3 AND ((review_pass = true AND new_role_id = $1) OR (review_pass = false AND new_role_id = $2))) as correct, COUNT(*) as total FROM ${table} WHERE actor_id = $3`;
  let values: any[] = [rolesets.citizen, rolesets.idc, actorId];
  const response = await pool.query<PGAuditCount>(query, values);
  if (response.rows.length === 0) {
    return null;
  }
  const item = response.rows[0];
  const correct = parseInt(item.correct);
  const total = parseInt(item.total);
  return {
    correct,
    total,
  };
}

export async function getRankingLogs(
  limit?: number,
  actorId?: number,
  targetId?: number,
  excludeJSON = false
) {
  let scope = `*`;

  if (excludeJSON) {
    scope = `actor_id, target_id, old_role_id, new_role_id, action_timestamp, review_timestamp, review_pass`;
  }

  let query = `SELECT ${scope} FROM ${table} ORDER BY action_timestamp DESC`;
  let values: any[] = [];

  if (limit) {
    if (limit > 0) {
      if (limit && actorId) {
        query = `SELECT ${scope} FROM ${table} WHERE actor_id = $1 ORDER BY action_timestamp DESC LIMIT ${limit}`;
        values = [actorId];
      } else if (limit && targetId) {
        query = `SELECT ${scope} FROM ${table} WHERE target_id = $1 ORDER BY action_timestamp DESC LIMIT ${limit}`;
        values = [targetId];
      } else {
        query = `SELECT ${scope} FROM ${table} ORDER BY action_timestamp DESC LIMIT ${limit}`;
      }
    }
  } else if (actorId) {
    query = `SELECT ${scope} FROM ${table} WHERE actor_id = $1 ORDER BY action_timestamp DESC`;
    values = [actorId];
  } else if (targetId) {
    query = `SELECT ${scope} FROM ${table} WHERE target_id = $1 ORDER BY action_timestamp DESC`;
    values = [targetId];
  }

  const response = await pool.query<PGLogItem>(query, values);
  return response.rows;
}

export async function addToRankingLogs(
  actorId: number,
  targetId: number,
  oldRolesetId: number,
  newRolesetId: number,
  actionTimestamp: Date,
  reviewTimestamp?: Date,
  reviewPassing?: boolean,
  reviewData?: DefaultAPIResponse
) {
  const countResponse = await pool.query<PGCount>(
    `SELECT COUNT(*) FROM ${table} WHERE actor_id = $1 AND target_id = $2 AND old_role_id = $3 AND new_role_id = $4 AND action_timestamp = $5`,
    [actorId, targetId, oldRolesetId, newRolesetId, actionTimestamp]
  );
  const count = parseInt(countResponse.rows[0].count);
  if (count === 0) {
    await pool.query(
      `INSERT INTO ${table}(actor_id, target_id, old_role_id, new_role_id, action_timestamp, review_timestamp, review_pass, review_data) VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        actorId,
        targetId,
        oldRolesetId,
        newRolesetId,
        actionTimestamp,
        reviewTimestamp,
        reviewPassing,
        reviewData,
      ]
    );
  } else {
    // throw new Error(
    //   `${actorId}-${targetId}-${oldRolesetId}-${newRolesetId}-${actionTimestamp.getTime()} already exists, skipping.`
    // );
  }
}
