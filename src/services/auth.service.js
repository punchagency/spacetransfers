import { User, UserRoles } from "../models/user.model.js";
import { hashPassword, verifyPassword } from "../utils/passwords.js";
import { signJwt } from "../utils/jwt.js";

export const registerUser = async ({ name, email, password, role, companyName }) => {
  const existing = await User.findOne({ email });
  if (existing) {
    const error = new Error("Email already in use");
    error.statusCode = 400;
    throw error;
  }

  const passwordHash = await hashPassword(password);
  const resolvedRole = role && Object.values(UserRoles).includes(role) ? role : UserRoles.CUSTOMER;

  const user = await User.create({
    name,
    email,
    passwordHash,
    role: resolvedRole,
    companyName
  });

  const token = signJwt({ sub: user.id, role: user.role });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyName: user.companyName
    },
    token
  };
};

export const loginUser = async ({ email, password }) => {
  const user = await User.findOne({ email });
  if (!user) {
    const error = new Error("Invalid credentials");
    error.statusCode = 401;
    throw error;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const error = new Error("Invalid credentials");
    error.statusCode = 401;
    throw error;
  }

  const token = signJwt({ sub: user.id, role: user.role });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyName: user.companyName
    },
    token
  };
};

