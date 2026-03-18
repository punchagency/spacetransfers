import { User, UserRoles, UserRole } from "../models/user.model.js";
import { hashPassword, verifyPassword } from "../utils/passwords.js";
import { signJwt } from "../utils/jwt.js";

interface RegisterParams {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
  companyName?: string;
  phone?: string;
}

interface UserResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  companyName?: string;
  phone?: string;
}

interface AuthResponse {
  user: UserResponse;
  token: string;
}

export const registerUser = async ({
  name,
  email,
  password,
  role,
  companyName,
  phone
}: RegisterParams): Promise<AuthResponse> => {
  const existing = await User.findOne({ email });
  if (existing) {
    const error = new Error("Email already in use") as any;
    error.statusCode = 400;
    throw error;
  }

  if (password.length < 8) {
    const error = new Error("Password must be at least 8 characters long") as any;
    error.statusCode = 400;
    throw error;
  }

  const passwordHash = await hashPassword(password);
  // Default to CUSTOMER if no role provided or invalid role
  const resolvedRole = role && Object.values(UserRoles).includes(role) ? role : UserRoles.CUSTOMER;

  // Validate required fields based on role
  if (resolvedRole === UserRoles.PRINTER) {
    if (!companyName) {
      const error = new Error("Business Name is required for Printer registration") as any;
      error.statusCode = 400;
      throw error;
    }
  } else if (resolvedRole === UserRoles.ADMIN) {
    if (!companyName || !phone) {
      const error = new Error("Company Name and Phone Number are required for Admin registration") as any;
      error.statusCode = 400;
      throw error;
    }
  }

  const userPayload: any = {
    name,
    email,
    passwordHash,
    role: resolvedRole
  };

  if (companyName) userPayload.companyName = companyName;
  if (phone) userPayload.phone = phone;

  const user = await User.create(userPayload);

  const token = signJwt({ sub: user.id, role: user.role });

  const userResponse: UserResponse = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  if (user.companyName) userResponse.companyName = user.companyName;
  if (user.phone) userResponse.phone = user.phone;

  return {
    user: userResponse,
    token
  };
};

export const loginUser = async ({ email, password }: Partial<RegisterParams>): Promise<AuthResponse> => {
  const user = await User.findOne({ email });
  if (!user) {
    const error = new Error("Invalid credentials") as any;
    error.statusCode = 401;
    throw error;
  }

  const valid = await verifyPassword(password!, user.passwordHash);
  if (!valid) {
    const error = new Error("Invalid credentials") as any;
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
