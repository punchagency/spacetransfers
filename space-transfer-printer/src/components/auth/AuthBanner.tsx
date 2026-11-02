import { useEffect, useState } from "react";
import type { AuthBannerProps } from "../../types/auth";
import { apiFetch } from "../../utils/api";

type NetworkStats = {
  activePartners: number;
  ordersFulfilled: number;
};

/**
 * Sign-in / sign-up banner.
 *
 * The three figures underneath read "500+", "50K+" and "4.9". The network has
 * eight active partners and has fulfilled no orders yet, and this screen is what
 * a prospective print partner reads while deciding whether to join — so those
 * numbers were not placeholder styling, they were a claim about the size of the
 * business made to someone about to rely on it.
 *
 * Partners and orders now come from `/api/public/stats`, which is public because
 * this screen renders before anyone has a session. Rating stays fixed at 5.0
 * until real ratings exist; it is the one figure here still standing in for
 * something, and it matches what the console shows.
 */
export const AuthBanner = ({ isSignIn }: AuthBannerProps) => {
  const [stats, setStats] = useState<NetworkStats | null>(null);
  /*
   * Unknown renders as "—", never as 0. A failed fetch showing zero would be
   * indistinguishable from an empty network — wrong in the same quiet way the
   * invented numbers were, just in the other direction.
   */
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    apiFetch("/public/stats")
      .then((data) => {
        if (cancelled) return;
        setStats({
          activePartners: Number(data?.activePartners ?? 0),
          ordersFulfilled: Number(data?.ordersFulfilled ?? 0),
        });
      })
      .catch(() => {
        // Silent by design: this is decoration beside a form someone is trying
        // to use, and a toast about network statistics would sit on top of it.
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const show = (value: number | undefined) =>
    failed || stats === null || value === undefined ? "—" : value.toLocaleString();

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
          <p className="text-xl text-white font-light">
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
            <h3 className="text-3xl font-bold">{show(stats?.activePartners)}</h3>
            <p className="text-sm text-blue-50 mt-1">Active Partners</p>
          </div>
          <div className="text-left">
            <h3 className="text-3xl font-bold">{show(stats?.ordersFulfilled)}</h3>
            <p className="text-sm text-blue-50 mt-1">Orders Fulfilled</p>
          </div>
          <div className="text-left">
            <h3 className="text-3xl font-bold">5.0</h3>
            <p className="text-sm text-blue-50 mt-1">Average Rating</p>
          </div>
        </div>
      </div>
    </div>
  );
};
