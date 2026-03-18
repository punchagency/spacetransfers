import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export const hashPassword = async (plainPassword: string): Promise<string> => {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(plainPassword, salt);
};

export const verifyPassword = async (plainPassword: string, passwordHash: string): Promise<boolean> => {
  return bcrypt.compare(plainPassword, passwordHash);
};
