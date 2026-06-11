import { useEffect, useState } from 'react';
import {
    MdSettings,
    MdClose,
    MdStraighten,
    MdVisibility,
    MdGridView,
    MdAdd,
    MdSave,
    MdFolderOpen,
    MdPerson,
    MdLogout,
    MdKeyboardArrowDown,
    MdKeyboardArrowUp,
    MdDeleteOutline
} from 'react-icons/md';


// Toggle Component
// Toggle Component
const Toggle = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
    <button
        onClick={onChange}
        className={`w-9 h-5 rounded-full relative transition-colors duration-200 ease-in-out cursor-pointer ${checked ? 'bg-slate-900' : 'bg-gray-200'}`}
    >
        <div className={`absolute top-1 left-1 bg-white w-3 h-3 rounded-full shadow transition-transform duration-200 ease-in-out ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
);

// Section Header Component
const SectionHeader = ({ title, expanded, onToggle }: { title: string; expanded: boolean; onToggle: () => void }) => (
    <button
        onClick={onToggle}
        className="flex items-center justify-between w-full py-2 text-[12px] font-semibold text-gray-700 hover:text-gray-900 cursor-pointer"
    >
        <span>{title}</span>
        {expanded ? <MdKeyboardArrowUp size={18} /> : <MdKeyboardArrowDown size={18} />}
    </button>
);

// Icon Row Component
const IconRow = ({
    icon: Icon,
    label,
    action,
    onClick
}: {
    icon?: React.ElementType;
    label: string;
    action: React.ReactNode;
    onClick?: () => void;
}) => (
    <div
        className="flex items-center justify-between py-1.5 px-2 -mx-2 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
        onClick={onClick}
    >
        <div className="flex items-center gap-2 text-gray-600">
            {Icon && <Icon size={16} />}
            <span className="text-xs font-medium">{label}</span>
        </div>
        {action}
    </div>
);

type SidebarProps = {
    isOpen: boolean;
    onClose: () => void;
    settings: {
        showGrid: boolean;
        showRulers: boolean;
        showMargins: boolean;
        snapToGrid: boolean;
        autoNestStickers: boolean;
        spacing: number;
        marginSize: number;
    };
    onUpdateSetting: (key: keyof SidebarProps['settings'], value: any) => void;
    onOpenSaveModal: () => void;
    onOpenLoadModal: () => void;
    onOpenAccountModal: () => void;
    onOpenAuthModal: (view: "login" | "register") => void;
    onCreateGangSheet: () => void;
    onClearArtboard: () => void;
    onSignOut: () => void;
    isLoggedIn: boolean;
    user?: { name?: string; email?: string; avatarUrl?: string | null } | null;
};

function SpacingInput({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (v: number) => void }) {
    const [local, setLocal] = useState(String(value));

    useEffect(() => {
        const n = parseFloat(local);
        if (isNaN(n) || Math.abs(n - value) > 0.0001) setLocal(String(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
        <input
            type="text"
            inputMode="decimal"
            value={local}
            disabled={disabled}
            onChange={(e) => {
                setLocal(e.target.value);
                const n = parseFloat(e.target.value);
                if (Number.isFinite(n) && n >= 0) onChange(n);
            }}
            onBlur={() => {
                const n = parseFloat(local);
                if (Number.isFinite(n) && n >= 0) {
                    onChange(n);
                    setLocal(String(n));
                } else {
                    setLocal(String(value));
                }
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="w-full bg-gray-100 border-none rounded-md py-2 px-3 text-[12px] font-medium focus:outline-none focus:ring-1 focus:ring-black"
        />
    );
}

export default function Sidebar({
    isOpen,
    onClose,
    settings,
    onUpdateSetting,
    onOpenSaveModal,
    onOpenLoadModal,
    onOpenAccountModal,
    onOpenAuthModal,
    onCreateGangSheet,
    onClearArtboard,
    onSignOut,
    isLoggedIn,
    user
}: SidebarProps) {
    // State for sections
    const [sections, setSections] = useState({
        canvasDisplay: true,
        autoNest: true,
        gangSheets: true,
        account: true,
    });

    const [hoverHint, setHoverHint] = useState<{
        visible: boolean;
        top: number;
        left: number;
        text: string;
    }>({ visible: false, top: 0, left: 0, text: '' });

    const showHint = (e: React.MouseEvent<HTMLElement>, text: string) => {
        setHoverHint({
            visible: true,
            top: e.clientY + 14,
            left: e.clientX + 14,
            text
        });
    };

    const hideHint = () => {
        setHoverHint((prev) => ({ ...prev, visible: false }));
    };


    const toggleSection = (key: keyof typeof sections) => {
        setSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Overlay */}
            <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

            {/* Sidebar Container */}
            <div className="fixed top-12 right-4 w-[320px] max-h-[calc(100vh-64px)] bg-white rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col animate-slide-in-right border border-gray-100">

                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <div className="flex items-center gap-2 text-gray-800">
                        <MdSettings size={18} />
                        <span className="text-[14px] font-semibold">Settings</span>
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800 transition-colors cursor-pointer">
                        <MdClose size={18} />
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-4 py-2 custom-scrollbar">

                    {/* Canvas Display Section */}
                    <div className="border-b border-gray-100 pb-2">
                        <SectionHeader
                            title="Canvas Display"
                            expanded={sections.canvasDisplay}
                            onToggle={() => toggleSection('canvasDisplay')}
                        />

                        {sections.canvasDisplay && (
                            <div className="space-y-1 mb-4">
                                {/* Show Grid - Commented Out */}
                                {/* <IconRow
                                    icon={MdGridOn}
                                    label="Show Grid"
                                    action={<Toggle checked={settings.showGrid} onChange={() => onUpdateSetting('showGrid', !settings.showGrid)} />}
                                /> */} 
                                <IconRow
                                    icon={MdStraighten}
                                    label="Show Rulers"
                                    onClick={() => onUpdateSetting('showRulers', !settings.showRulers)}
                                    action={<Toggle checked={settings.showRulers} onChange={() => onUpdateSetting('showRulers', !settings.showRulers)} />}
                                />
                                <IconRow
                                    icon={MdVisibility}
                                    label="Show Margins"
                                    onClick={() => onUpdateSetting('showMargins', !settings.showMargins)}
                                    action={<Toggle checked={settings.showMargins} onChange={() => onUpdateSetting('showMargins', !settings.showMargins)} />}
                                />
                                <IconRow
                                    icon={MdGridView}
                                    label="Snap to Grid"
                                    onClick={() => onUpdateSetting('snapToGrid', !settings.snapToGrid)}
                                    action={<Toggle checked={settings.snapToGrid} onChange={() => onUpdateSetting('snapToGrid', !settings.snapToGrid)} />}
                                />

                                {/* Margin Size Dropdown */}
                                <div className="flex items-center justify-between py-2 mt-2 px-2 -mx-2 rounded-lg hover:bg-gray-50 transition-colors">
                                    <div className="flex items-center gap-3 text-gray-600">
                                        <MdStraighten size={20} className="rotate-45" />
                                        <span className="text-[12px] font-medium">Margin Size</span>
                                    </div>
                                    <div className="relative">
                                        <select
                                            value={settings.marginSize}
                                            onChange={(e) => onUpdateSetting('marginSize', parseFloat(e.target.value))}
                                            className="bg-gray-100 text-[12px] py-1.5 pl-3 pr-8 rounded-md border-none focus:outline-none focus:ring-1 focus:ring-black cursor-pointer appearance-none text-gray-700 font-medium w-40"
                                        >
                                            <option value={0.25}>0.25" (Default)</option>
                                            <option value={0.5}>0.5"</option>
                                            <option value={1.0}>1.0"</option>
                                        </select>
                                        <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-gray-500">
                                            <MdKeyboardArrowDown size={16} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Auto-Nest Section */}
                    <div className="border-b border-gray-100 py-2">
                        <SectionHeader
                            title="Auto-Nest"
                            expanded={sections.autoNest}
                            onToggle={() => toggleSection('autoNest')}
                        />

                        {sections.autoNest && (
                            <div className="mb-4">
                                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100 hover:bg-gray-100 transition-colors">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-[12px] font-semibold text-slate-800">Auto-Nest </span>
                                        <Toggle checked={settings.autoNestStickers} onChange={() => onUpdateSetting('autoNestStickers', !settings.autoNestStickers)} />
                                    </div>
                                    <p className="text-[12px] text-gray-500">Automatically arrange efficiently</p>
                                </div>

                                <div className="mt-4">
                                    <label className="text-[12px] font-semibold text-slate-700 block mb-2">Item Spacing Inches</label>
                                    <div className="relative">
                                        <SpacingInput
                                            value={settings.spacing}
                                            disabled={false}
                                            onChange={(v) => onUpdateSetting('spacing', v)}
                                        />
                                    </div>
                                    <p className="text-[12px] text-gray-500 mt-2">Space between items</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Gang Sheets Section */}
                    <div
                        className="border-b border-gray-100 py-2"
                        onMouseEnter={(e) => {
                            if (!isLoggedIn) showHint(e, "Signin or Signup to access Gangsheet");
                        }}
                        onMouseMove={(e) => {
                            if (!isLoggedIn) showHint(e, "Signin or Signup to access Gangsheet");
                        }}
                        onMouseLeave={hideHint}
                    >
                        <SectionHeader
                            title="Gang Sheets"
                            expanded={sections.gangSheets}
                            onToggle={() => toggleSection('gangSheets')}
                        />

                        {sections.gangSheets && (
                            <div className="space-y-1 mb-4">
                                <div
                                    onMouseEnter={(e) => {
                                        if (!isLoggedIn) showHint(e, "Signin or Signup to access Gangsheet");
                                    }}
                                    onMouseMove={(e) => {
                                        if (!isLoggedIn) showHint(e, "Signin or Signup to access Gangsheet");
                                    }}
                                    onMouseLeave={hideHint}
                                >
                                    <button
                                        className="flex items-center gap-3 w-full py-2 px-2 -mx-2 rounded-lg text-gray-600 hover:text-slate-900 hover:bg-gray-50 text-left cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={() => { onCreateGangSheet(); onClose(); }}
                                        disabled={!isLoggedIn}
                                    >
                                        <MdAdd size={20} />
                                        <span className="text-[12px] font-medium">Create GangSheet</span>
                                    </button>
                                </div>
                                <div
                                    onMouseEnter={(e) => {
                                        if (!isLoggedIn) showHint(e, "Signin or Signup to access Gangsheet");
                                    }}
                                    onMouseMove={(e) => {
                                        if (!isLoggedIn) showHint(e, "Signin or Signup to access Gangsheet");
                                    }}
                                    onMouseLeave={hideHint}
                                >
                                    <button
                                        className="flex items-center gap-3 w-full py-2 px-2 -mx-2 rounded-lg text-gray-600 hover:text-slate-900 hover:bg-gray-50 text-left cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={onOpenSaveModal}
                                        disabled={!isLoggedIn}
                                    >
                                        <MdSave size={20} />
                                        <span className="text-[12px] font-medium">Save GangSheet</span>
                                    </button>
                                </div>
                                <div
                                    onMouseEnter={(e) => {
                                        if (!isLoggedIn) showHint(e, "Signin or Signup to access Gangsheet");
                                    }}
                                    onMouseMove={(e) => {
                                        if (!isLoggedIn) showHint(e, "Signin or Signup to access Gangsheet");
                                    }}
                                    onMouseLeave={hideHint}
                                >
                                    <button
                                        className="flex items-center gap-3 w-full py-2 px-2 -mx-2 rounded-lg text-gray-600 hover:text-slate-900 hover:bg-gray-50 text-left cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={onOpenLoadModal}
                                        disabled={!isLoggedIn}
                                    >
                                        <MdFolderOpen size={20} />
                                        <span className="text-[12px] font-medium">Load GangSheet</span>
                                    </button>
                                </div>
                                <div
                                    onMouseEnter={(e) => {
                                        if (!isLoggedIn) showHint(e, "Signin or Signup to access Gangsheet");
                                    }}
                                    onMouseMove={(e) => {
                                        if (!isLoggedIn) showHint(e, "Signin or Signup to access Gangsheet");
                                    }}
                                    onMouseLeave={hideHint}
                                >
                                    <button
                                        className="flex items-center gap-3 w-full py-2 px-2 -mx-2 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 text-left cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={() => {
                                            onClearArtboard();
                                            onClose();
                                        }}
                                        disabled={!isLoggedIn}
                                    >
                                        <MdDeleteOutline size={20} />
                                        <span className="text-[12px] font-medium">Clear Artboard</span>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Account Section */}
                    <div className="py-2">
                        <SectionHeader
                            title="Account"
                            expanded={sections.account}
                            onToggle={() => toggleSection('account')}
                        />

                        {sections.account && (
                            <div className="space-y-1 mb-4">
                                {!isLoggedIn ? (
                                    <>
                                        <button onClick={() => { onClose(); onOpenAuthModal("login"); }} className="flex items-center gap-3 w-full py-2 px-2 -mx-2 rounded-lg text-gray-600 hover:text-slate-900 hover:bg-gray-50 text-left cursor-pointer transition-colors">
                                            <MdPerson size={20} />
                                            <span className="text-[12px] font-medium">Sign In</span>
                                        </button>
                                        <button onClick={() => { onClose(); onOpenAuthModal("register"); }} className="flex items-center gap-3 w-full py-2 px-2 -mx-2 rounded-lg text-gray-600 hover:text-slate-900 hover:bg-gray-50 text-left cursor-pointer transition-colors">
                                            <MdPerson size={20} />
                                            <span className="text-[12px] font-medium">Create Account</span>
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        {(user?.name || user?.email) && (
                                            <div className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-lg bg-gray-50 mb-1">
                                                {user?.avatarUrl ? (
                                                    <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                                                ) : (
                                                    <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center text-[12px] font-semibold flex-shrink-0">
                                                        {(user?.name || user?.email || "").charAt(0).toUpperCase()}
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    {user?.name && <p className="text-[12px] font-semibold text-gray-900 truncate">{user.name}</p>}
                                                    {user?.email && <p className="text-[11px] text-gray-500 truncate">{user.email}</p>}
                                                </div>
                                            </div>
                                        )}
                                        <button onClick={() => { onClose(); onOpenAccountModal(); }} className="flex items-center gap-3 w-full py-2 px-2 -mx-2 rounded-lg text-gray-600 hover:text-slate-900 hover:bg-gray-50 text-left cursor-pointer transition-colors">
                                            <MdPerson size={20} />
                                            <span className="text-[12px] font-medium">Account Settings</span>
                                        </button>
                                        <button onClick={() => { onSignOut(); onClose(); }} className="flex items-center gap-3 w-full py-2 px-2 -mx-2 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 text-left cursor-pointer transition-colors">
                                            <MdLogout size={20} className="transform rotate-180" />
                                            <span className="text-[12px] font-medium">Sign Out</span>
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                </div>
            </div>
            <div
                className={`fixed z-[60] pointer-events-none transition-all duration-200 ease-out ${hoverHint.visible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-1"}`}
                style={{
                    top: hoverHint.top,
                    left: hoverHint.left,
                    transform: hoverHint.visible ? "translateX(0)" : "translateX(-4px)"
                }}
            >
                <div className="rounded-lg bg-slate-900 text-white text-[12px] font-medium px-3 py-2 shadow-lg">
                    {hoverHint.text}
                </div>
            </div>
        </>
    );
}
