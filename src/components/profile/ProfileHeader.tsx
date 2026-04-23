import {
  FiCalendar,
  FiClock,
} from "react-icons/fi";
import { BsBoxSeam } from "react-icons/bs";
import { MdOutlineVerified } from "react-icons/md";
import { HiStar } from "react-icons/hi2";

export const ProfileHeader = () => {
  return (
    <div className="relative overflow-hidden bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] rounded-2xl px-6 py-5 md:px-8 md:py-6 flex items-center shadow-md text-white">
      <div className="flex items-center gap-6">
        <div className="relative w-24 h-24 rounded-2xl overflow-hidden shadow-lg bg-gray-200 flex-shrink-0">
          <img
            src="/profile1.jpg"
            alt="Profile avatar"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 rounded-2xl border-4 border-white/20 pointer-events-none" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold leading-tight">John Davidson</h2>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-white/10 border border-white/25 backdrop-blur">
              <MdOutlineVerified className="w-3.5 h-3.5  " />
              Verified
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-white/10 border border-white/25 backdrop-blur">
              <HiStar className="w-3.5 h-3.5 " />
              4.9 Rating
            </span>
          </div>
          <p className="text-sm text-blue-100 mt-1">
            Premium DTF Solutions · DTF Printing Service
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-40 text-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white/90">
                <BsBoxSeam className="w-5 h-5" />
              </div>
              <div>
                <div className="text-lg font-semibold leading-tight">248</div>
                <div className="text-xs text-blue-100 mt-0.5">Total Jobs</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white/90">
                <FiClock className="w-5 h-5" />
              </div>
              <div>
                <div className="text-lg font-semibold leading-tight">
                  &lt; 2 hours
                </div>
                <div className="text-xs text-blue-100 mt-0.5">
                  Response Time
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white/90">
                <FiCalendar className="w-5 h-5" />
              </div>
              <div>
                <div className="text-lg font-semibold leading-tight">
                  January 2024
                </div>
                <div className="text-xs text-blue-100 mt-0.5">Member Since</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute -top-52 -right-32 w-[320px] h-[320px] bg-[#4A7CFF] border-white/20 rounded-full opacity-50" />
    </div>
  );
};
