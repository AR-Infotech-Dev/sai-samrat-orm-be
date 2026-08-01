import { failureResponse } from "#shared/utils/apiResponse.js";

const buckets = new Map();

const getClientKey = (req, keyPrefix) => {
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || req.ip || req.socket?.remoteAddress || "unknown").split(",")[0].trim();

  const username = req.body?.username || req.body?.email || "";
  return `${keyPrefix}:${ip}:${String(username).toLowerCase()}`;
};

export const rateLimit = ({
  windowMs = 15 * 60 * 1000,
  max = 10,
  keyPrefix = "default",
  message = "Too many requests. Please try again later.",
} = {}) => {
  return (req, res, next) => {
    const now = Date.now();
    const key = getClientKey(req, keyPrefix);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;

    if (bucket.count > max) {
      return failureResponse(res, {
        code: 2029,
        httpStatus: 429,
        message,
      });
    }

    return next();
  };
};
