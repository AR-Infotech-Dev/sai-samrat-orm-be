const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isEmpty = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "");

export const validateBody = (body = {}, fieldRules = {}) => {
  const data = {};

  for (const [key, rule] of Object.entries(fieldRules)) {
    const {
      label = key,
      required = false,
      type = "string",
    } = rule;

    const value = body[key];

    if (required && isEmpty(value)) {
      return {
        isValid: false,
        message: `${label} is required`,
        field: key,
        data: {},
      };
    }

    if (value === undefined) {
      continue;
    }

    if (!isEmpty(value)) {
      if (type === "email" && !EMAIL_REGEX.test(String(value).trim())) {
        return {
          isValid: false,
          message: `${label} must be a valid email`,
          field: key,
          data: {},
        };
      }

      if (type === "date" && Number.isNaN(Date.parse(value))) {
        return {
          isValid: false,
          message: `${label} must be a valid date`,
          field: key,
          data: {},
        };
      }

      if (type === "number" && Number.isNaN(Number(value))) {
        return {
          isValid: false,
          message: `${label} must be a valid number`,
          field: key,
          data: {},
        };
      }
    }

    data[key] = body[key];
  }

  return {
    isValid: true,
    data,
  };
};
