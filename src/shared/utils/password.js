import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export function isPasswordHash(password = "") {
  return /^\$2[aby]\$\d{2}\$/.test(String(password || ""));
}

export async function hashPassword(password) {
  return bcrypt.hash(String(password), SALT_ROUNDS);
}

export async function verifyPassword(plainPassword, storedPassword) {
  if (!storedPassword) {
    return false;
  }

  if (isPasswordHash(storedPassword)) {
    return bcrypt.compare(String(plainPassword), String(storedPassword));
  }

  return String(plainPassword) === String(storedPassword);
}
