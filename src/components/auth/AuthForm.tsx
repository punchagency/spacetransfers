import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaCheck } from "react-icons/fa";
import {
  HiOutlineMail,
  HiOutlineLockClosed,
  HiOutlineEye,
  HiOutlineEyeOff,
} from "react-icons/hi";
import { BsArrowRight } from "react-icons/bs";
import type { AuthFormProps } from "../../types/auth";
import { apiFetch } from "../../utils/api";
import toast from "react-hot-toast";
import { SpaceLoader } from "../common/SpaceLoader";
 
export const AuthForm = ({ isSignIn, setIsSignIn, onLogin }: AuthFormProps) => {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [region, setRegion] = useState<"Northeast" | "Midwest" | "South" | "West">("West");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [stateProv, setStateProv] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (isSignIn) {
        const response = await apiFetch("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });

        if (response.user.role !== "PRINTER") {
          throw new Error("Access denied. Printer account required.");
        }

        localStorage.setItem("printer_token", response.token);
        localStorage.setItem("printer_user", JSON.stringify(response.user));
        toast.success("Welcome back!");
        onLogin();
        navigate("/dashboard");
      } else {
        if (!fullName || !companyName || !email || !password || !phone || !region || !street || !city || !stateProv || !postalCode || !country) {
          toast.error("Please fill in all fields");
          setIsLoading(false);
          return;
        }

        await apiFetch("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            name: fullName,
            companyName,
            email,
            password,
            phone,
            website: website || undefined,
            region,
            address: {
              street,
              city,
              state: stateProv,
              postalCode,
              country
            },
            role: "PRINTER"
          }),
        });

        toast.success("Registration successful! Your account is pending approval.");
        setIsSignIn(true); // Switch to sign in
      }
    } catch (error: any) {
      toast.error(error.message || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-8 lg:p-16 bg-[#F8FAFC]">
      <div className="w-full max-w-md space-y-8">
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

        <div className="text-left space-y-2">
          <h2 className="text-3xl font-bold text-slate-900">
            {isSignIn ? "Welcome Back" : "Create Account"}
          </h2>
          <p className="text-slate-500 text-sm">
            {isSignIn
              ? "Sign in to access your partner dashboard"
              : "Join our network of DTF fulfillment partners"}
          </p>
        </div>

        {/* Toggle */}
        <div className="bg-gray-100 p-1 rounded-xl flex items-center">
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
          {!isSignIn && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs text-left font-semibold text-slate-700 ml-1 block">
                  Full Name
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Davidson"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400 text-left"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-left font-semibold text-slate-700 ml-1 block">
                  Business Name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Premium DTF Solutions"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400 text-left"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-left font-semibold text-slate-700 ml-1 block">
                  Region
                </label>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value as any)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm text-left"
                >
                  <option value="Northeast">Northeast</option>
                  <option value="Midwest">Midwest</option>
                  <option value="South">South</option>
                  <option value="West">West</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-left font-semibold text-slate-700 ml-1 block">
                  Phone
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 123-4567"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400 text-left"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-left font-semibold text-slate-700 ml-1 block">
                  Website (optional)
                </label>
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400 text-left"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-left font-semibold text-slate-700 ml-1 block">
                  Street Address
                </label>
                <input
                  type="text"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="123 Main St"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400 text-left"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-left font-semibold text-slate-700 ml-1 block">
                    City
                  </label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Los Angeles"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400 text-left"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-left font-semibold text-slate-700 ml-1 block">
                    State
                  </label>
                  <input
                    type="text"
                    value={stateProv}
                    onChange={(e) => setStateProv(e.target.value)}
                    placeholder="CA"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400 text-left"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-left font-semibold text-slate-700 ml-1 block">
                    Postal Code
                  </label>
                  <input
                    type="text"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    placeholder="90001"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400 text-left"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-left font-semibold text-slate-700 ml-1 block">
                    Country
                  </label>
                  <input
                    type="text"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="United States"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400 text-left"
                  />
                </div>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <label className="text-xs text-left font-semibold text-slate-700 ml-1 block">
              Email Address
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <HiOutlineMail className="text-slate-400 text-lg" />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="demo@spacetransfers.com"
                className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400 text-left"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-left font-semibold text-slate-700 ml-1 block">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <HiOutlineLockClosed className="text-slate-400 text-lg" />
              </div>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="demo123"
                className="w-full pl-11 pr-11 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm placeholder:text-slate-400 text-left"
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

          {!isSignIn && (
            <div className="flex items-start gap-2 pt-1">
              {/* Custom Checkbox */}
              <div className="relative flex items-center">
                <input
                  type="checkbox"
                  id="terms"
                  className="peer h-4 w-4 opacity-0 absolute z-10 cursor-pointer"
                />
                <div className="h-4 w-4 border border-slate-300 rounded bg-white peer-checked:bg-blue-600 peer-checked:border-blue-600 transition-colors flex items-center justify-center">
                  <FaCheck className="text-white text-[10px] opacity-0 peer-checked:opacity-100" />
                </div>
              </div>
              <label
                htmlFor="terms"
                className="text-xs text-slate-500 leading-snug cursor-pointer select-none"
              >
                I agree to the{" "}
                <a href="#" className="text-blue-600 hover:underline">
                  Terms of Service
                </a>{" "}
                and{" "}
                <a href="#" className="text-blue-600 hover:underline">
                  Privacy Policy
                </a>
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className={`w-full py-3 px-4 rounded-xl text-white font-semibold shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] ${
              isLoading 
                ? "bg-blue-400 cursor-not-allowed" 
                : "bg-[#3B82F6] hover:bg-blue-600"
            }`}
          >
            {isLoading ? <SpaceLoader size={18} layout="inline" /> : null}
            <span>{isLoading ? "Please Wait..." : isSignIn ? "Sign In" : "Create Account"}</span>
            {!isLoading && <BsArrowRight className="text-lg" />}
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
