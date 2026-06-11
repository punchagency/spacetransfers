import { useNavigate, useLocation } from "react-router-dom";
import {
  AiOutlineDollar,
  AiOutlineUser,
  AiOutlineSetting,
} from "react-icons/ai";
import { LuPrinter } from "react-icons/lu";
import { FiHome, FiUser } from "react-icons/fi";
import { useProfileStore } from "../../state/ProfileStore";
const nav = [
  { label: "Home", icon: FiHome, path: "/dashboard" },
  { label: "Jobs & Orders", iconSrc: "/menu.svg", path: "/orders" },
  {
    label: "Print Queue",
    icon: LuPrinter,
    path: "/print-queue",
  },
  { label: "Earnings & Payouts", icon: AiOutlineDollar, path: "/earnings" },
];

const bottomNav = [
  { label: "Profile", icon: AiOutlineUser, path: "/profile" },
  { label: "Settings", icon: AiOutlineSetting, path: "/settings" },
];

export const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { name, avatarUrl } = useProfileStore();

  return (
    <aside className="w-65 bg-white border-r border-gray-200 h-full flex flex-col py-2">
      <div className="flex items-center justify-center gap-2 border-b border-gray-200 mb-6">
        <span className="font-semibold text-lg">spacetransfers</span>
        <img src="/space.svg" alt="logo" className="w-15 h-15" />
      </div>

      <nav className="space-y-2 border-b mb-6 border-gray-200 px-3">
        {nav.map(({ label, icon: Icon, iconSrc, path }, index) => (
          <div
            key={label}
            onClick={() => navigate(path)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer text-sm
              ${
                location.pathname === path ||
                (path === "/orders" &&
                  (location.pathname.startsWith("/orders") ||
                    location.pathname.startsWith("/dashboard/orders"))) ||
                (path === "/fulfilment-partners" &&
                  location.pathname.startsWith(
                    "/dashboard/fulfilment-partners",
                  ))
                  ? "bg-blue-50 text-blue-600 border-l-4 border-blue-600"
                  : "text-gray-600 hover:bg-gray-50"
              }
              ${index === nav.length - 1 ? "mb-2" : ""}
            `}
          >
            {Icon ? (
              <Icon size={18} />
            ) : (
              <img src={iconSrc} alt={label} className="w-[18px] h-[18px]" />
            )}
            <span>{label}</span>
          </div>
        ))}
      </nav>

      <div className="space-y-2 px-3">
        {bottomNav.map(({ label, icon: Icon, path }) => (
          <div
            key={label}
            onClick={() => navigate(path)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm cursor-pointer
              ${
                location.pathname === path
                  ? "bg-blue-50 text-blue-600 border-l-4 border-blue-600"
                  : "text-gray-600 hover:bg-gray-50"
              }
            `}
          >
            <Icon size={18} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="mt-auto px-4 py-4 border-t border-gray-100">
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name}
              className="w-10 h-10 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center flex-shrink-0">
              <FiUser className="w-5 h-5 text-gray-400" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">
              {name || "Printer"}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
