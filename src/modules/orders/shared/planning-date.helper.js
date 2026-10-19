export const getLatestReadyDate = (items = []) => items.reduce((latest, item) => {
  const date = String(item.expected_ready_date || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date > latest ? date : latest;
}, "");
