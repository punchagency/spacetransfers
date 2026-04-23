import { type AuthBannerProps } from "../../types/auth";

export const AuthBanner = ({ isSignIn }: AuthBannerProps) => {
  return (
    <div className="hidden lg:flex w-1/2 bg-[#1A5EFF] relative flex-col justify-between text-white overflow-hidden">
      {/* Decorative Circles */}
      <div className="absolute -top-32 -right-32 w-[320px] h-[320px] bg-[#4A7CFF]   border-white/20 rounded-full   opacity-50" />
      <div className="absolute -bottom-32 -left-32 w-[270px] h-[270px] bg-[#4A7CFF]   border-white/20 rounded-full   opacity-50" />

      {/* Content */}
      <div className="relative z-10 p-16 flex flex-col justify-center h-full">
        <div className="space-y-4 mb-20">
          <h1 className="text-5xl font-bold leading-tight">
            {isSignIn ? "Welcome back  " : "Join Our Network"}
          </h1>
          <p className="text-xl text-blue-100 font-light">
            {isSignIn
              ? "Login to get started"
              : "Start your DTF fulfillment journey"}
          </p>
        </div>
      </div>

      {/* Footer Stats */}
      <div className="relative z-10 px-16 pb-12">
        <div className="border-t border-white/20 pt-8 flex justify-between items-center text-center">
          <div className="text-left">
            <h3 className="text-3xl font-bold">500+</h3>
            <p className="text-sm text-blue-200 mt-1">Active Partners</p>
          </div>
          <div className="text-left">
            <h3 className="text-3xl font-bold">50K+</h3>
            <p className="text-sm text-blue-200 mt-1">Orders Fulfilled</p>
          </div>
          <div className="text-left">
            <h3 className="text-3xl font-bold">4.9</h3>
            <p className="text-sm text-blue-200 mt-1">Average Rating</p>
          </div>
        </div>
      </div>
    </div>
  );
};
