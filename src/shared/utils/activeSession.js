import crypto from "crypto";
import { DB_PREFIX, query } from "#config/database.js";

let ensuredActiveSessionColumn = false;
let ensureActiveSessionColumnPromise = null;

export function createActiveSessionId() {
  return crypto.randomUUID();
}

export async function ensureActiveSessionColumn() {
  if (ensuredActiveSessionColumn) {
    return;
  }

  if (!ensureActiveSessionColumnPromise) {
    ensureActiveSessionColumnPromise = (async () => {
      const rows = await query(`SHOW COLUMNS FROM ${DB_PREFIX}admin LIKE 'active_session_id'`);

      if (!rows.length) {
        await query(`ALTER TABLE ${DB_PREFIX}admin ADD COLUMN active_session_id VARCHAR(64) NULL`);
      }

      ensuredActiveSessionColumn = true;
    })();
  }

  return ensureActiveSessionColumnPromise;
}

export async function setActiveSessionId(adminID, activeSessionId, isMobile = false) {
  await ensureActiveSessionColumn();

  if (isMobile) {
    return query(
      `UPDATE ${DB_PREFIX}admin SET active_session_id_mob = ?, modified_date = NOW() WHERE adminID = ?`,
      [activeSessionId, adminID]
    );
  }

  return query(
    `UPDATE ${DB_PREFIX}admin SET active_session_id = ?, modified_date = NOW() WHERE adminID = ?`,
    [activeSessionId, adminID]
  );
}

export async function getActiveSessionId(adminID,isMobile = false) {
  const rows = await query(
    isMobile 
    ?`SELECT active_session_id_mob as active_session_id FROM ${DB_PREFIX}admin WHERE adminID = ? LIMIT 1`
    :`SELECT active_session_id as active_session_id FROM ${DB_PREFIX}admin WHERE adminID = ? LIMIT 1`,
    [adminID]
  );

  return rows[0]?.active_session_id || null;
}
