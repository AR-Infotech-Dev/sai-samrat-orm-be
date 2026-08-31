import { query, DB_PREFIX } from "#config/database.js";
import { toMysqlDateTime } from "#shared/utils/dateTime.js";

const PROVIDER = "open.er-api.com";
const BASE_CURRENCY = "INR";
const SUPPORTED_CURRENCIES = ["INR", "USD", "EUR", "GBP", "JPY"];

const currencyCodeMap = {
  "₹": "INR",
  INR: "INR",
  "$": "USD",
  USD: "USD",
  "€": "EUR",
  EUR: "EUR",
  "£": "GBP",
  GBP: "GBP",
  "¥": "JPY",
  JPY: "JPY",
};

const getTodayInIndia = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export const normalizeCurrencyCode = (currency = BASE_CURRENCY) => {
  const normalized = String(currency || BASE_CURRENCY).trim().toUpperCase();
  return currencyCodeMap[normalized] || currencyCodeMap[currency] || normalized || BASE_CURRENCY;
};

const ensureExchangeRateTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS ${DB_PREFIX}currency_exchange_rates (
      currency_exchange_rate_id INT NOT NULL AUTO_INCREMENT,
      base_currency VARCHAR(10) NOT NULL DEFAULT 'INR',
      target_currency VARCHAR(10) NOT NULL,
      rate_date DATE NOT NULL,
      exchange_rate DECIMAL(18, 8) NOT NULL,
      provider VARCHAR(80) NOT NULL DEFAULT '${PROVIDER}',
      fetched_at DATETIME NOT NULL,
      response_json LONGTEXT NULL,
      PRIMARY KEY (currency_exchange_rate_id),
      UNIQUE KEY uk_currency_rate_day (base_currency, target_currency, rate_date),
      KEY idx_currency_rate_lookup (target_currency, rate_date)
    )
  `);
};

const readTodaysRates = async (currencies = []) => {
  if (!currencies.length) return {};
  await ensureExchangeRateTable();

  const placeholders = currencies.map(() => "?").join(",");
  const rows = await query(
    `
      SELECT target_currency, exchange_rate, rate_date, fetched_at, provider
      FROM ${DB_PREFIX}currency_exchange_rates
      WHERE base_currency = ?
        AND rate_date = ?
        AND target_currency IN (${placeholders})
    `,
    [BASE_CURRENCY, getTodayInIndia(), ...currencies]
  );

  return Object.fromEntries(rows.map((row) => [row.target_currency, Number(row.exchange_rate)]));
};

const readLatestFallbackRates = async (currencies = []) => {
  if (!currencies.length) return {};
  await ensureExchangeRateTable();

  const result = {};
  for (const currency of currencies) {
    const rows = await query(
      `
        SELECT target_currency, exchange_rate, rate_date, fetched_at, provider
        FROM ${DB_PREFIX}currency_exchange_rates
        WHERE base_currency = ?
          AND target_currency = ?
        ORDER BY rate_date DESC, fetched_at DESC
        LIMIT 1
      `,
      [BASE_CURRENCY, currency]
    );
    if (rows[0]) result[currency] = Number(rows[0].exchange_rate);
  }
  return result;
};

const fetchLiveRates = async (currencies = []) => {
  const response = await fetch(`https://${PROVIDER}/v6/latest/${BASE_CURRENCY}`);
  if (!response.ok) {
    throw new Error(`Currency provider failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  const providerRates = payload?.rates || {};
  const today = getTodayInIndia();
  const fetchedAt = toMysqlDateTime();
  const rates = {};

  await ensureExchangeRateTable();

  for (const currency of currencies) {
    const rate = currency === BASE_CURRENCY ? 1 : Number(providerRates[currency]);
    if (!Number.isFinite(rate) || rate <= 0) continue;

    rates[currency] = rate;
    await query(
      `
        INSERT INTO ${DB_PREFIX}currency_exchange_rates
          (base_currency, target_currency, rate_date, exchange_rate, provider, fetched_at, response_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          exchange_rate = VALUES(exchange_rate),
          provider = VALUES(provider),
          fetched_at = VALUES(fetched_at),
          response_json = VALUES(response_json)
      `,
      [BASE_CURRENCY, currency, today, rate, PROVIDER, fetchedAt, JSON.stringify({ result: payload?.result, time_last_update_utc: payload?.time_last_update_utc })]
    );
  }

  return rates;
};

export const getExchangeRates = async (requestedCurrencies = SUPPORTED_CURRENCIES) => {
  const currencies = [...new Set(requestedCurrencies.map(normalizeCurrencyCode).filter((currency) => SUPPORTED_CURRENCIES.includes(currency)))];
  if (!currencies.includes(BASE_CURRENCY)) currencies.unshift(BASE_CURRENCY);

  const cachedRates = await readTodaysRates(currencies);
  const missingCurrencies = currencies.filter((currency) => !cachedRates[currency]);

  if (!missingCurrencies.length) {
    return { base: BASE_CURRENCY, date: getTodayInIndia(), rates: cachedRates, source: "cache" };
  }

  try {
    const liveRates = await fetchLiveRates(currencies);
    return {
      base: BASE_CURRENCY,
      date: getTodayInIndia(),
      rates: { ...cachedRates, ...liveRates, INR: 1 },
      source: "live",
    };
  } catch (error) {
    const fallbackRates = await readLatestFallbackRates(missingCurrencies);
    const rates = { ...cachedRates, ...fallbackRates, INR: 1 };
    const stillMissing = currencies.filter((currency) => !rates[currency]);
    if (stillMissing.length) {
      throw new Error(`Unable to fetch exchange rate for ${stillMissing.join(", ")}`);
    }

    return {
      base: BASE_CURRENCY,
      date: getTodayInIndia(),
      rates,
      source: "fallback",
      warning: error.message,
    };
  }
};

export const getExchangeRate = async (currency = BASE_CURRENCY) => {
  const code = normalizeCurrencyCode(currency);
  const { rates } = await getExchangeRates([code]);
  return Number(rates[code] || 1);
};
