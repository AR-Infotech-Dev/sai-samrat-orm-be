import { query, DB_PREFIX, getDbPool } from "#config/database.js";

export const withPiWriteLock = async (id, work) => {
  const connection = await getDbPool().getConnection();
  const key = `pi:${DB_PREFIX}:${id}`.slice(0, 64);
  let locked = false;
  try {
    const [rows] = await connection.execute("SELECT GET_LOCK(?, 10) AS acquired", [key]);
    locked = Number(rows[0].acquired) === 1;
    if (!locked) throw new Error("PI is being updated. Please retry.");
    return await work();
  } finally {
    if (locked) await connection.execute("SELECT RELEASE_LOCK(?)", [key]);
    connection.release();
  }
};

export const transitionPi = async (id, from, to, userId) => withPiWriteLock(id, async () => {
  const result = await query(`UPDATE ${DB_PREFIX}proforma_invoices
    SET pi_status = ?, modified_by = ?, modified_date = NOW(),
        approved_by = CASE WHEN ? = 'approved' THEN ? ELSE approved_by END,
        approved_at = CASE WHEN ? = 'approved' THEN NOW() ELSE approved_at END
    WHERE pi_id = ? AND pi_status = ? AND status <> 'delete'`,
  [to, userId, to, userId, to, id, from]);
  return result.affectedRows > 0;
});
