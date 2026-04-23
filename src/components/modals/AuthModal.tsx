import React, { useEffect, useState } from "react";
import { MdClose, MdEmail, MdLock, MdPerson, MdVisibility, MdVisibilityOff, MdExpandMore } from "react-icons/md";
import { FiMapPin } from "react-icons/fi";
import { apiFetch } from "../../lib/utils/api";
import toast from "react-hot-toast";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: any) => void;
  onSubAccountCreated?: (user: any) => void;
  initialView?: "login" | "register";
  isSubAccountCreation?: boolean;
  resetToken?: string | null;
  resetEmail?: string | null;
}

export default function AuthModal({
  isOpen,
  onClose,
  onAuthSuccess,
  onSubAccountCreated,
  initialView = "login",
  isSubAccountCreation = false,
  resetToken,
  resetEmail,
}: AuthModalProps) {
  const [mode, setMode] = useState<"auth" | "forgot" | "reset">("auth");
  const [view, setView] = useState<"login" | "register">(
    isSubAccountCreation ? "register" : initialView
  );
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    region: "West",
  });
  const [activeResetToken, setActiveResetToken] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setView(isSubAccountCreation ? "register" : initialView);
    if (resetToken) {
      setMode("reset");
      setView("login");
      setActiveResetToken(resetToken);
    } else {
      setMode("auth");
      setActiveResetToken(null);
    }
    setLoading(false);
    setShowPassword(false);
    setError(null);
    setFormData({
      name: "",
      email: resetEmail || "",
      password: "",
      region: "West",
    });
  }, [isOpen, initialView, isSubAccountCreation, resetToken, resetEmail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (mode === "forgot") {
        const response = await apiFetch("/auth/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email: formData.email }),
        });

        toast.success(response?.message || "If an account exists, a reset link has been sent");
        setMode("auth");
        setView("login");
        return;
      }

      if (mode === "reset") {
        if (!activeResetToken) {
          setError("Reset token is missing. Please use the link from your email.");
          return;
        }
        const response = await apiFetch("/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ token: activeResetToken, newPassword: formData.password }),
        });

        toast.success(response?.message || "Password reset successfully");
        setActiveResetToken(null);
        setMode("auth");
        setView("login");
        setFormData({ name: "", email: formData.email, password: "", region: "West" });
        return;
      }

      let endpoint = view === "login" ? "/auth/login" : "/auth/register";
      if (isSubAccountCreation && view === "register") {
        endpoint = "/auth/sub-accounts";
      }

      const payload = view === "login" 
        ? { email: formData.email, password: formData.password }
        : { ...formData, role: "customer" };

      const response = await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (isSubAccountCreation) {
        toast.success("Account created successfully!");
        onSubAccountCreated?.(response.user);
        onClose();
        return;
      }

      if (response.token) {
        localStorage.setItem("token", response.token);
      }

      toast.success(view === "login" ? "Welcome back!" : "Account created successfully!");
      onAuthSuccess(response.user);
      onClose();
    } catch (err: any) {
      const errorMessage = err.message || "An error occurred during authentication";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6"
      >
        {/* Header */}
        <div className="relative mb-6">
          <h2 className="text-xl font-bold text-gray-900">
            {mode === "reset"
              ? "Reset Password"
              : mode === "forgot"
                ? "Forgot Password"
                : isSubAccountCreation
                  ? "Add Sub-Account"
                  : view === "login"
                    ? "Welcome Back"
                    : "Create Account"}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {mode === "reset"
              ? "Set a new password for your account"
              : mode === "forgot"
                ? "We will email you a password reset link"
                : isSubAccountCreation
                  ? "Enter details to create a linked sub-account"
                  : view === "login"
                    ? "Sign in to access your designs"
                    : "Join us to start creating your gang sheets"}
          </p>
          <button
            onClick={onClose}
            className="absolute -right-2 -top-2 p-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-xs text-red-500 bg-red-50 border border-red-100 rounded-xl">
              {error}
            </div>
          )}
          {mode === "reset" && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                  New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    <MdLock size={18} />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    required
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPassword ? (
                      <MdVisibilityOff size={20} />
                    ) : (
                      <MdVisibility size={20} />
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
          {mode === "auth" && view === "register" && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <MdPerson size={18} />
                </div>
                <input
                  type="text"  
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="John Doe"
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              Email Address
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <MdEmail size={18} />
              </div>
              <input
                type="email"
                name="email"
                required
                value={formData.email}
                onChange={handleChange}
                placeholder="name@example.com"
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          {mode === "auth" && view === "register" && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Region
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <FiMapPin size={18} />
                </div>
                <select
                  name="region"
                  required
                  value={formData.region}
                  onChange={handleChange}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all appearance-none"
                >
                  <option value="Northeast">Northeast</option>
                  <option value="Midwest">Midwest</option>
                  <option value="South">South</option>
                  <option value="West">West</option>
                </select>
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-gray-400">
                  <MdExpandMore size={20} />
                </div>
              </div>
            </div>
          )}

          {mode === "auth" && (
            <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <MdLock size={18} />
              </div>
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                required
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                className="w-full pl-10 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showPassword ? (
                  <MdVisibilityOff size={20} />
                ) : (
                  <MdVisibility size={20} />
                )}
              </button>
            </div>
            </div>
          )}

          {view === "login" && mode === "auth" && (
            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
                onClick={() => setMode("forgot")}
              >
                Forgot password?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 bg-slate-900 text-white rounded-xl font-semibold text-sm transform active:scale-[0.98] transition-all shadow-lg shadow-slate-900/10 mt-2 ${
              loading ? "opacity-50 cursor-not-allowed" : "hover:bg-slate-800"
            }`}
          >
            {loading
              ? "Please wait..."
              : mode === "forgot"
                ? "Send Reset Link"
                : mode === "reset"
                  ? "Reset Password"
                  : view === "login"
                    ? "Sign In"
                    : "Create Account"}
          </button>
        </form>

        {/* Footer */}
        {mode !== "auth" ? (
          <div className="mt-8 pt-6 border-t border-gray-100 text-center">
            <button
              type="button"
              onClick={() => {
                setMode("auth");
                setView("login");
                setError(null);
                setFormData({ name: "", email: "", password: "", region: "West" });
              }}
              className="text-sm font-bold text-blue-600 hover:text-blue-700"
            >
              Back to Sign In
            </button>
          </div>
        ) : !isSubAccountCreation && (
          <div className="mt-8 pt-6 border-t border-gray-100 text-center">
            <p className="text-sm text-gray-600">
              {view === "login"
                ? "Don't have an account?"
                : "Already have an account?"}{" "}
              <button
                onClick={() => setView(view === "login" ? "register" : "login")}
                className="font-bold text-blue-600 hover:text-blue-700"
              >
                {view === "login" ? "Sign Up" : "Log In"}
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
