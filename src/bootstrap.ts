import { config } from "./config";
import { sequelize } from "./db";
import { hashPassword } from "./auth";
import { User } from "./models";

export async function initDatabase() {
  await sequelize.authenticate();
  if (config.DB_SYNC) await sequelize.sync({ alter: config.NODE_ENV !== "production" });
}

export async function ensureMayor() {
  const email = config.MAYOR_EMAIL.trim().toLowerCase();
  const existing = await User.findOne({ where: { role: "mayor" } });
  if (existing) return existing;
  return User.create({
    role: "mayor",
    name: config.MAYOR_NAME,
    email,
    phone: config.MAYOR_PHONE,
    office: config.MAYOR_OFFICE,
    city: config.MAYOR_CITY,
    passwordHash: await hashPassword(config.MAYOR_PASSWORD),
  });
}
