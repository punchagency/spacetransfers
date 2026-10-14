import bcrypt from "bcryptjs";

// 12 is the current floor for bcrypt; under test it is lowered so the suite stays fast.
const SALT_ROUNDS = process.env.NODE_ENV === "test" ? 4 : 12;

export const hashPassword = async (plainPassword: string): Promise<string> => {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(plainPassword, salt);
};

export const verifyPassword = async (plainPassword: string, passwordHash: string): Promise<boolean> => {
  return bcrypt.compare(plainPassword, passwordHash);
};
