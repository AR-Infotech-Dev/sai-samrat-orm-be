import jwt from "jsonwebtoken";
import { jwtSecret, jwtExpire } from "#config/legacy.js";

export const generateToken = (user) => {
  return jwt.sign(
    {
      adminID: user.adminID,
      name: user.name,
      roleID: user.roleID
    },
    jwtSecret,
    { expiresIn: jwtExpire }
  );
};
