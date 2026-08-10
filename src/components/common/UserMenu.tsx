import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiLogOut, FiUser, FiChevronDown, FiSettings } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { useProfileStore } from '../../state/ProfileStore';
import { UserAvatar } from './UserAvatar';
import { clearAuth } from '../../utils/auth';

export const UserMenu = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { avatarUrl: globalAvatarUrl } = useProfileStore();

  const userStr = localStorage.getItem('printer_user');
  const user = userStr ? JSON.parse(userStr) : { name: 'Printer', email: 'printer@company.com', avatarUrl: null };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    try {
      // clearAuth wipes the session AND notifies the route guard, which
      // redirects to /auth on its own — no full page reload needed.
      clearAuth();
      toast.success('Logged out successfully');
      navigate('/auth', { replace: true });
    } catch (error) {
      toast.error('Logout failed');
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 p-1.5 rounded-xl hover:bg-gray-50 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/10 group"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <UserAvatar
          src={globalAvatarUrl || user.avatarUrl}
          className="w-9 h-9 rounded-full border border-gray-200 shadow-sm"
          iconClassName="w-4 h-4"
        />
        <div className="hidden md:block text-left leading-tight">
          <div className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
            {user.companyName || user.name}
          </div>
          <div className="text-[11px] text-gray-500">
            {user.email}
          </div>
        </div>
        <FiChevronDown
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50 animate-in fade-in zoom-in duration-200"
          role="menu"
          aria-orientation="vertical"
        >
          <div className="px-4 py-2 border-b border-gray-50 mb-1 md:hidden">
            <div className="text-sm font-semibold text-gray-900">{user.companyName || user.name}</div>
            <div className="text-xs text-gray-500">{user.email}</div>
          </div>

          <button
            onClick={() => {
              navigate('/profile');
              setIsOpen(false);
            }}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-colors"
            role="menuitem"
          >
            <FiUser className="w-4 h-4" />
            Business Profile
          </button>

          <button
            onClick={() => {
              navigate('/settings');
              setIsOpen(false);
            }}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-colors"
            role="menuitem"
          >
            <FiSettings className="w-4 h-4" />
            Settings
          </button>

          <div className="h-px bg-gray-100 my-1"></div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            role="menuitem"
          >
            <FiLogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
};
