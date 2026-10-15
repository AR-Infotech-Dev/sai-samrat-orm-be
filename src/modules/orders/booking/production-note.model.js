import { query, DB_PREFIX } from "#config/database.js";

export const getProductionNoteRecord = async (orderId) => {
  const orders = await query(`SELECT o.*, c.name AS customer_name,
    pi.pi_date, pi.port_of_discharge, pi.country_of_export
    FROM ${DB_PREFIX}orders o
    LEFT JOIN ${DB_PREFIX}customer c ON c.customer_id = o.customer_id
    LEFT JOIN ${DB_PREFIX}proforma_invoices pi ON pi.pi_id = o.pi_id
    WHERE o.order_id = ? AND o.status <> 'delete'`, [orderId]);
  if (!orders.length) return null;
  const items = await query(`SELECT oi.*, p.product_code, p.product_name, p.fg_code, p.weight,
    pii.brand_snapshot AS pi_brand, pii.product_marking, pii.weight AS pi_weight
    FROM ${DB_PREFIX}order_items oi
    LEFT JOIN ${DB_PREFIX}products p ON p.product_id = oi.product_id
    LEFT JOIN ${DB_PREFIX}proforma_invoice_items pii ON pii.pi_item_id = oi.pi_item_id
    WHERE oi.order_id = ? AND oi.status <> 'delete' ORDER BY oi.order_item_id`, [orderId]);
  return { order: orders[0], items };
};
