export const buildProductionNoteNumber = (orderId, createdDate) => {
  const date = createdDate instanceof Date ? createdDate : new Date(createdDate);
  if (!Number.isSafeInteger(Number(orderId)) || Number(orderId) <= 0 || Number.isNaN(date.getTime())) {
    throw new Error("Valid order ID and date are required for a Production Note number");
  }
  const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  const fy = `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
  return `SAIPL/PN/${fy}/${String(orderId).padStart(3, "0")}`;
};
