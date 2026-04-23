import { AiOutlineSearch } from 'react-icons/ai';
import { GoBell } from "react-icons/go";
import { UserMenu } from "../common/UserMenu";

export const Topbar = () => (
  <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
    {/* Search */}
    <div className="flex items-center gap-3 w-full max-w-xl border border-gray-200 rounded-xl px-4 py-2 hover:border-blue-400 transition-colors group">
      <AiOutlineSearch className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors" />
      <input
        className="bg-transparent outline-none text-sm w-full placeholder-gray-400"
        placeholder="Search jobs, orders..."
      />
    </div>

    {/* Right */}
    <div className="flex items-center gap-6">
      {/* Notification */}
      <button className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/10">
        <GoBell className="w-5 h-5 text-gray-600" />
        <span className="absolute top-1.5 right-2 w-2 h-2 bg-blue-500 rounded-full border-2 border-white"></span>
      </button>

      {/* User */}
      <UserMenu />
    </div>
  </header>
);
