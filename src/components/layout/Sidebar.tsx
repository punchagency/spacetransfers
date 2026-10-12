import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FiAlertTriangle } from "react-icons/fi";
import { apiFetch } from '../../utils/api';
import { MdClose } from "react-icons/md";
import {
  AiOutlineBank,
  AiOutlineDollar,
  AiOutlineUser,
  AiOutlineSetting,
  AiOutlineCheckCircle,
} from "react-icons/ai";
import { FiHome } from "react-icons/fi";
const nav = [
  { label: "Home", icon: FiHome, path: "/dashboard" },
  { label: "Orders", iconSrc: "/orders.svg", path: "/orders" },
  {
    label: "Fulfilment Partners",
    iconSrc: "/fulfilment.svg",
    path: "/fulfilment-partners",
  },
  { label: "Issues", icon: FiAlertTriangle, path: "/issues" },
  { label: "Approvals", icon: AiOutlineCheckCircle, path: "/printer-approvals" },
  { label: "Earnings", icon: AiOutlineDollar, path: "/earnings" },
  { label: "Payouts", icon: AiOutlineBank, path: "/payouts" },
];

const bottomNav = [
  { label: "Profile", icon: AiOutlineUser, path: "/profile" },
  { label: "Settings", icon: AiOutlineSetting, path: "/settings" },
];

/**
 * The menu: a fixed column on a laptop, a drawer on a phone.
 *
 * At 260px wide it left a 390px phone just 130px for the page itself, so every
 * table and heading ran off the side. `open`/`onClose` are read only below `md`;
 * the desktop layout is unchanged.
 */
export const Sidebar = ({ open = false, onClose }: { open?: boolean; onClose?: () => void }) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Open customer reports, so one waiting is seen from any page.
  const [openIssues, setOpenIssues] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      apiFetch('/admin/issues/counts')
        .then((data) => {
          if (alive) setOpenIssues(Number(data?.open) || 0);
        })
        .catch(() => {});
    load();
    const id = window.setInterval(load, 30000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [location.pathname]);

  /** Following a link on a phone closes the drawer; on desktop there is nothing to close. */
  const go = (path: string) => {
    navigate(path);
    onClose?.();
  };

  return (
    <aside
      className={`w-65 max-w-[85vw] bg-white border-r border-gray-200 h-full flex flex-col py-2
        max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:shadow-xl
        max-md:transition-transform max-md:duration-200 ${open ? "max-md:translate-x-0" : "max-md:-translate-x-full"}`}
    >
      <div className="flex items-center justify-center gap-2 border-b border-gray-200 mb-6 relative">
        <span className="font-semibold text-lg">spacetransfers</span>
        <img src="/space.svg" alt="logo" className="w-15 h-15" />
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="md:hidden absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
        >
          <MdClose size={22} />
        </button>
      </div>

      <nav className="space-y-2 border-b mb-6 border-gray-200 px-3">
        {nav.map(({ label, icon: Icon, iconSrc, path }, index) => (
          <div
            key={label}
            onClick={() => go(path)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer text-sm
              ${location.pathname === path ||
                (path === '/orders' && location.pathname.startsWith('/dashboard/orders')) ||
                (path === '/fulfilment-partners' && location.pathname.startsWith('/dashboard/fulfilment-partners'))
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
            {path === '/issues' && openIssues > 0 && (
              <span
                className="ml-auto rounded-full bg-red-500 px-2 text-xs font-semibold leading-5 text-white"
                aria-label={`${openIssues} open`}
              >
                {openIssues}
              </span>
            )}
          </div>
        ))}
      </nav>

      <div className="  space-y-2 px-3">
        {bottomNav.map(({ label, icon: Icon, path }) => (
          <div
            key={label}
            onClick={() => go(path)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm cursor-pointer
              ${location.pathname === path
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
    </aside>
  );
};
