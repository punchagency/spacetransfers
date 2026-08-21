import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaCheck } from "react-icons/fa";
import { HiOutlineEye, HiOutlineEyeOff } from "react-icons/hi";
import { type AuthFormProps } from "../../types/auth";
import { apiFetch } from "../../utils/api";
import { setAuth } from "../../utils/auth";
import { buildLegalAcceptancePayload } from "../../utils/legal";
import toast from "react-hot-toast";

export const AuthForm = ({ isSignIn, setIsSignIn }: AuthFormProps) => {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Form State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const navigate = useNavigate();

  // Password Validation
  const hasMinLength = password.length >= 8;
  const passwordsMatch =
    password && confirmPassword && password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (isSignIn) {
        const response = await apiFetch("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        
        if (response.user.role !== "ADMIN") {
          throw new Error("Access denied. Admin account required.");
        }

        setAuth(response.token, response.user);
        toast.success("Welcome back, Admin!");
        navigate("/dashboard");
      } else {
        // Sign Up Logic
        if (!hasMinLength || !passwordsMatch || !agreedToTerms) {
          toast.error("Please check the form for errors");
          setIsLoading(false);
          return;
        }

        const response = await apiFetch("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            name: fullName,
            email,
            password,
            companyName,
            phone,
            role: "ADMIN",
            // Required by the server — registration is refused outright without
            // it. The single "I agree to the Terms" checkbox covers both
            // acknowledgements the server asks for.
            legalAcceptance: buildLegalAcceptancePayload(
              agreedToTerms,
              agreedToTerms,
            ),
          }),
        });

        setAuth(response.token, response.user);
        toast.success("Account created successfully!");
        navigate("/dashboard");
      }
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
          <h2 className="text-3xl font-bold text-slate-900">
            {isSignIn ? "Welcome Back" : "Create Account"}
          </h2>
          <p className="text-slate-500 text-sm">
            {isSignIn
              ? "Sign in to access your Admin Portal dashboard"
              : "Sign up to access admin tools and manage your team"}{" "}
          </p>
        </div>

        {/* Toggle */}
        <div className="bg-gray-100 p-1 rounded-xl flex items-center max-w-md mx-auto w-full">
          <button
            onClick={() => setIsSignIn(true)}
            className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
              isSignIn
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => setIsSignIn(false)}
            className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
              !isSignIn
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Sign Up
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5 text-left">
          {isSignIn ? (
            /* Sign In Form */
            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-900 ml-1 block">
                  Email Address *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                  placeholder="admin@company.com"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-900 ml-1 block">
                  Password *
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                    placeholder="Enter password"
                  />
                  <button
                    type="button"
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
          ) : (
            /* Sign Up Form */
            <div className="space-y-5">
              {/* Row 1: Name & Company */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-900 ml-1 block">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="John Smith"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-900 ml-1 block">
                    Company Name *
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="DTF Prints Inc."
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-900 ml-1 block">
                  Email Address *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@company.com"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                />
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-900 ml-1 block">
                  Phone Number *
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 123-4567"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                />
              </div>

              {/* Row 2: Passwords */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-900 ml-1 block">
                    Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min. 8 characters"
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                    />
                    <button
                      type="button"
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
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-900 ml-1 block">
                    Confirm Password *
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showConfirmPassword ? (
                        <HiOutlineEyeOff className="text-lg" />
                      ) : (
                        <HiOutlineEye className="text-lg" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Password Requirements */}
              {/* <div className="bg-[#F8FAFC] border border-slate-200 rounded-xl p-4 space-y-2">
                <h4 className="text-sm font-bold text-slate-700">
                  Password Requirements:
                </h4>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {hasMinLength ? (
                      <HiCheckCircle className="text-green-500 text-lg" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-slate-300" />
                    )}
                    <span
                      className={`text-sm ${hasMinLength ? "text-slate-700" : "text-slate-500"}`}
                    >
                      At least 8 characters
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {passwordsMatch && confirmPassword ? (
                      <HiCheckCircle className="text-green-500 text-lg" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-slate-300" />
                    )}
                    <span
                      className={`text-sm ${passwordsMatch && confirmPassword ? "text-slate-700" : "text-slate-500"}`}
                    >
                      Passwords match
                    </span>
                  </div>
                </div>
              </div> */}

              {/* Terms Checkbox */}
              <div className="flex items-start gap-2 pt-1">
                <div className="relative flex items-center mt-0.5">
                  <input
                    type="checkbox"
                    id="terms"
                    checked={agreedToTerms}
                    onChange={(e) => setAgreedToTerms(e.target.checked)}
                    className="peer h-5 w-5 opacity-0 absolute z-10 cursor-pointer"
                  />
                  <div
                    className={`h-5 w-5 border rounded transition-colors flex items-center justify-center ${agreedToTerms ? "bg-blue-600 border-blue-600" : "bg-white border-slate-300"}`}
                  >
                    <FaCheck
                      className={`text-white text-[12px] transition-opacity ${agreedToTerms ? "opacity-100" : "opacity-0"}`}
                    />
                  </div>
                </div>
                <label
                  htmlFor="terms"
                  className="text-sm text-slate-500 leading-tight cursor-pointer select-none"
                >
                  I agree to the{" "}
                  <a
                    href="#"
                    className="text-blue-600 font-medium hover:underline"
                  >
                    Terms & Conditions
                  </a>{" "}
                  and{" "}
                  <a
                    href="#"
                    className="text-blue-600 font-medium hover:underline"
                  >
                    Privacy Policy
                  </a>
                </label>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className={`w-full py-3.5 px-4 rounded-lg text-white font-semibold shadow-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99] mt-6 ${
              isLoading 
                ? "bg-blue-400 cursor-not-allowed" 
                : "bg-[#2563EB] hover:bg-blue-700"
            }`}
          >
            <span>
              {isLoading 
                ? "Please Wait..." 
                : isSignIn 
                  ? "Sign In" 
                  : "Create Account"}
            </span>
          </button>
        </form>

        <div className="text-center">
          <p className="text-sm text-slate-500">
            {isSignIn ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              onClick={() => setIsSignIn(!isSignIn)}
              className="text-blue-600 font-medium hover:underline"
            >
              {isSignIn ? "Sign up" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};
