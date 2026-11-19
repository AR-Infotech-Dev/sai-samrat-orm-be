ALTER TABLE ab_customer
  ADD COLUMN country varchar(100) DEFAULT NULL AFTER address,
  ADD COLUMN postal_code varchar(30) DEFAULT NULL AFTER country,
  ADD COLUMN vat_no varchar(80) DEFAULT NULL AFTER gst_number;

ALTER TABLE ab_proforma_invoices
  ADD COLUMN packing text DEFAULT NULL AFTER delivery_terms,
  ADD COLUMN validity_of_offer text DEFAULT NULL AFTER packing,
  ADD COLUMN other_term text DEFAULT NULL AFTER validity_of_offer,
  ADD COLUMN country_of_origin varchar(100) DEFAULT NULL AFTER other_term,
  ADD COLUMN port_of_loading varchar(150) DEFAULT NULL AFTER country_of_origin,
  ADD COLUMN country_of_export varchar(100) DEFAULT NULL AFTER port_of_loading,
  ADD COLUMN port_of_discharge varchar(150) DEFAULT NULL AFTER country_of_export,
  ADD COLUMN final_destination varchar(150) DEFAULT NULL AFTER port_of_discharge;
