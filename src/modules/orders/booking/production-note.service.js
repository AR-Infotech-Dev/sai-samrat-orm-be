import { getProductionNoteRecord } from "./production-note.model.js";
import { renderTemplate } from "#shared/utils/templateMaker.js";
import { buildProductionNoteNumber } from "../shared/production-note-number.js";

const dateText = (value) => value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }) : "-";
export const buildProductionNote = async (id) => {
  const record = await getProductionNoteRecord(id);
  if (!record) return null;
  const { order, items } = record;
  const lines = items.map((item, index) => ({
    sr: index + 1, brand: item.pi_brand || order.brand || "-",
    code: item.product_code_snapshot || item.product_code || "-",
    fg: item.fg_code || "-", description: item.product_name_snapshot || item.product_name || "-",
    marking: item.product_marking || item.product_name_snapshot || item.product_name || "-",
    weight: Number(item.pi_weight ?? item.weight ?? 0), qty: Number(item.order_qty || 0), remarks: item.remarks || "",
  }));
  const qty = lines.reduce((sum, item) => sum + item.qty, 0);
  const weight = lines.reduce((sum, item) => sum + item.qty * item.weight, 0);
  const data = {
    number: buildProductionNoteNumber(order.order_id, order.created_date || order.order_date), code: order.order_code || "-", date: dateText(order.order_date),
    pi: order.pi_number || "-", piDate: dateText(order.pi_date), customer: order.customer_name || "-",
    port: order.port_of_discharge || "-", country: order.country_of_export || "-",
    items: lines, blanks: Array.from({ length: Math.max(0, 10 - lines.length) }), qty,
    weight: weight.toLocaleString("en-IN", { minimumFractionDigits: 2 }),
    remarks: order.remarks || "", printed: dateText(new Date()),
    packing: { container: "WHITE", lid: "Black", box: "TURBO KING / 5 PLY IT 600", screen: "YELLOW" },
  };
  return { html: await renderTemplate("productionNote", "preview", data), invoice: { pi_no: data.code } };
};
