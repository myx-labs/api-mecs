import pkg from "pg";
import { DefaultAPIResponse } from "./types";
const { Pool } = pkg;

const pool = new Pool();

const table = "mecs.action_log";

export async function startDB() {
  try {
    await pool.connect();
  } catch (error) {
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

  if (limit) {
    if (limit > 0) {
      if (limit && actorId) {
        query = `SELECT ${scope} FROM ${table} WHERE actor_id = '${actorId}' ORDER BY action_timestamp DESC LIMIT ${limit}`;
      } else if (limit && targetId) {
        query = `SELECT ${scope} FROM ${table} WHERE target_id = '${targetId}' ORDER BY action_timestamp DESC LIMIT ${limit}`;
      } else {
        query = `SELECT ${scope} FROM ${table} ORDER BY action_timestamp DESC LIMIT ${limit}`;
      }
    }
  } else if (actorId) {
    query = `SELECT ${scope} FROM ${table} WHERE actor_id = '${actorId}' ORDER BY action_timestamp DESC`;
  } else if (targetId) {
    query = `SELECT ${scope} FROM ${table} WHERE target_id = '${targetId}' ORDER BY action_timestamp DESC`;
  }
  
  const response = await pool.query<PGLogItem>(query);
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
      "INSERT INTO mecs.action_log(actor_id, target_id, old_role_id, new_role_id, action_timestamp, review_timestamp, review_pass, review_data) VALUES($1, $2, $3, $4, $5, $6, $7, $8)",
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
    throw new Error(
      `${actorId}-${targetId}-${oldRolesetId}-${newRolesetId}-${actionTimestamp.getTime()} already exists, skipping.`
    );
  }
}
