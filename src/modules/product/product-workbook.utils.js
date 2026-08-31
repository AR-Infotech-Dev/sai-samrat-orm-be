import * as XLSX from "xlsx";

export const PRODUCT_WORKBOOK_SHEET = "Products";

export const PRODUCT_WORKBOOK_COLUMNS = [
  { key: "product_id", header: "Product ID", width: 12 },
  { key: "product_code", header: "Product Code", width: 18 },
  { key: "product_name", header: "Product Name", width: 28 },
  { key: "product_type", header: "Product Type", width: 22 },
  { key: "brand", header: "Brand", width: 22 },
  { key: "unit", header: "Unit", width: 12 },
  { key: "standard_rate", header: "Rate", width: 14 },
  { key: "gst_rate", header: "GST Rate", width: 12 },
  { key: "weight", header: "Weight", width: 12 },
  { key: "ready_stock", header: "Ready Stock", width: 14 },
  { key: "fg_code", header: "FG Code", width: 18 },
  { key: "product_description", header: "Description", width: 35 },
  { key: "status", header: "Status", width: 12 },
  { key: "tally_item_id", header: "Tally Item ID", width: 16 },
];

const normalizeHeader = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const headerToKey = PRODUCT_WORKBOOK_COLUMNS.reduce((lookup, column) => {
  lookup.set(normalizeHeader(column.key), column.key);
  lookup.set(normalizeHeader(column.header), column.key);
  return lookup;
}, new Map());

const buildSheet = (columns, rows = []) => {
  const data = [
    columns.map((column) => column.header),
    ...rows.map((row) => columns.map((column) => row?.[column.key] ?? "")),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = columns.map((column) => ({ wch: column.width || 16 }));
  return sheet;
};

const productToWorkbookRow = (product = {}) => ({
  product_id: product.product_id ?? "",
  product_code: product.product_code ?? "",
  product_name: product.product_name ?? "",
  product_type: product.product_type_name ?? product.product_type ?? "",
  brand: product.brand ?? "",
  unit: product.unit ?? "Nos",
  standard_rate: product.standard_rate ?? "",
  gst_rate: product.gst_rate ?? "",
  weight: product.weight ?? "",
  ready_stock: product.ready_stock ?? "",
  fg_code: product.fg_code ?? "",
  product_description: product.product_description ?? product.product_desscription ?? "",
  status: product.status ?? "active",
  tally_item_id: product.tally_item_id ?? "",
});

export const buildProductWorkbook = ({ products = [], template = false } = {}) => {
  const workbook = XLSX.utils.book_new();

  const productRows = template
    ? [
        {
          product_code: "AUTO-60",
          product_name: "Auto 60",
          product_type: "Automotive Series",
          brand: "Automotive Series",
          unit: "Nos",
          standard_rate: 4200,
          gst_rate: 18,
          weight: 64,
          ready_stock: 0,
          fg_code: "FG-AUTO-60",
          product_description: "Sample row - replace with actual product data",
          status: "active",
        },
      ]
    : products.map(productToWorkbookRow);

  const instructions = buildSheet(
    [
      { key: "field", header: "Field", width: 24 },
      { key: "note", header: "Note", width: 70 },
    ],
    [
      { field: "Product ID", note: "Keep blank for new product. If present, importer updates that product." },
      { field: "Product Code", note: "Required. If Product ID is blank and this code already exists, that product will be updated." },
      { field: "Product Type", note: "Required. Enter category name, slug, or category ID from Product Types." },
      { field: "Rate / GST Rate", note: "Required numeric values. Product master rate is stored in INR." },
      { field: "Status", note: "Use active or inactive. Blank defaults to active." },
    ]
  );

  XLSX.utils.book_append_sheet(workbook, instructions, "Instructions");
  XLSX.utils.book_append_sheet(workbook, buildSheet(PRODUCT_WORKBOOK_COLUMNS, productRows), PRODUCT_WORKBOOK_SHEET);

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
};

export const isProductWorkbook = (workbook) => workbook?.SheetNames?.includes(PRODUCT_WORKBOOK_SHEET);

export const parseProductWorkbook = (workbook) => {
  const sheet = workbook?.Sheets?.[PRODUCT_WORKBOOK_SHEET];
  if (!sheet) return [];

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  return rows.map((row, index) => {
    const mapped = { __row: index + 2 };
    Object.entries(row).forEach(([header, value]) => {
      const key = headerToKey.get(normalizeHeader(header));
      if (key) mapped[key] = value;
    });
    return mapped;
  });
};
