CREATE TABLE IF NOT EXISTS ab_currency_exchange_rates (
  currency_exchange_rate_id INT NOT NULL AUTO_INCREMENT,
  base_currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  target_currency VARCHAR(10) NOT NULL,
  rate_date DATE NOT NULL,
  exchange_rate DECIMAL(18, 8) NOT NULL,
  provider VARCHAR(80) NOT NULL DEFAULT 'open.er-api.com',
  fetched_at DATETIME NOT NULL,
  response_json LONGTEXT NULL,
  PRIMARY KEY (currency_exchange_rate_id),
  UNIQUE KEY uk_currency_rate_day (base_currency, target_currency, rate_date),
  KEY idx_currency_rate_lookup (target_currency, rate_date)
);
