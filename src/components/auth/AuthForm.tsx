import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { HiOutlineEye, HiOutlineEyeOff } from "react-icons/hi";
import { apiFetch } from "../../utils/api";
import { setAuth } from "../../utils/auth";
import toast from "react-hot-toast";

/**
 * Sign-in only.
 *
 * The admin console is the platform operator's own tool, not a product anyone
 * signs up for — admin accounts are provisioned directly against the database.
 * Self-service registration was removed rather than hidden, so there is no
 * registration path left in this app to re-enable by accident.
 */
export const AuthForm = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    if (!email.trim() || !password) {
      toast.error("Enter your email and password.");
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (response?.user?.role !== "ADMIN") {
        throw new Error("Access denied. Admin account required.");
      }

      setAuth(response.token, response.user);
      toast.success("Welcome back, Admin!");

      // Return the operator to whatever the guard intercepted, so a deep link
      // survives the login round trip.
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
      navigate(from || "/dashboard", { replace: true });
    } catch (error: any) {
      toast.error(error.message || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-8 lg:p-16 bg-[#F8FAFC]">
      <div className="w-full max-w-xl space-y-8">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center ">
            <span className="text-2xl font-bold text-slate-900 tracking-tight">
              spacetransfers
            </span>
            <div className="relative">
              <img src="/space.svg" alt="space" className="w-[74px] h-[74px]" />
            </div>
          </div>
        </div>

        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold text-slate-900">Welcome Back</h2>
          <p className="text-slate-500 text-sm">
            Sign in to access your Admin Portal dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 text-left">
          <div className="space-y-5">
            <div className="space-y-1.5">
              <label
                htmlFor="admin-email"
                className="text-xs font-bold text-slate-900 ml-1 block"
              >
                Email Address *
              </label>
              <input
                id="admin-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                placeholder="admin@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="admin-password"
                className="text-xs font-bold text-slate-900 ml-1 block"
              >
                Password *
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                  placeholder="Enter password"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showPassword ? (
                    <HiOutlineEyeOff className="text-lg" />
                  ) : (
                    <HiOutlineEye className="text-lg" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className={`w-full py-3.5 px-4 rounded-lg text-white font-semibold shadow-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99] mt-6 ${
              isLoading
                ? "bg-blue-400 cursor-not-allowed"
                : "bg-[#2563EB] hover:bg-blue-700"
            }`}
          >
            <span>{isLoading ? "Please Wait..." : "Sign In"}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
