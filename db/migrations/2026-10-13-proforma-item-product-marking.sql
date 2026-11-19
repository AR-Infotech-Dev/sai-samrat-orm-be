ALTER TABLE ab_proforma_invoice_items
  ADD COLUMN product_marking text DEFAULT NULL AFTER product_name_snapshot;
