import { registerSelectedImageSlot } from "../lib/selectedImageSlot";
import { useEffect, useState } from 'react';
import { useIsMobile } from '../lib/useIsMobile';
import { CANVAS, CANVAS_BACKGROUNDS, MARGIN_OPTIONS } from '../config/artboard.config';
import {
    MdSettings,
    MdReceiptLong,
    MdClose,
    MdStraighten,
    MdVisibility,
    MdGridView,
    MdGridOn,
    MdAdd,
    MdFolderOpen,
    MdPerson,
    MdLogout,
    MdKeyboardArrowDown,
    MdKeyboardArrowUp,
    MdDeleteOutline
} from 'react-icons/md';

// Toggle Component
const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        // The row around it toggles too; one click must not count twice.
        onClick={(e) => { e.stopPropagation(); onChange(); }}
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
    onClick,
    hint,
}: {
    icon?: React.ElementType;
    label: string;
    action: React.ReactNode;
    onClick?: () => void;
    /** Shown under the label when the setting has no visible effect yet. */
    hint?: string;
}) => (
    <div
        className="py-1.5 px-2 -mx-2 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
        onClick={onClick}
    >
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-600">
                {Icon && <Icon size={16} />}
                <span className="text-xs font-medium">{label}</span>
            </div>
            {action}
        </div>
        {hint && <p className="mt-1 ml-6 text-[11px] text-gray-500">{hint}</p>}
    </div>
);

function checkerStyle(c1: string, c2: string): React.CSSProperties {
    return {
        backgroundImage: [
            `linear-gradient(45deg,  ${c1} 25%, transparent 25%)`,
            `linear-gradient(-45deg, ${c1} 25%, transparent 25%)`,
            `linear-gradient(45deg,  transparent 75%, ${c1} 75%)`,
            `linear-gradient(-45deg, transparent 75%, ${c1} 75%)`,
        ].join(', '),
        backgroundSize: '8px 8px, 8px 8px, 8px 8px, 8px 8px',
        backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
        backgroundColor: c2,
    };
}

const BG_STYLES: Record<string, React.CSSProperties> = {
    'transparent': checkerStyle('#E9F2F1', '#ffffff'),
    '#ffffff': checkerStyle('#e0e0e0', '#ffffff'),
    '#f3f4f6': checkerStyle('#d1d5db', '#f3f4f6'),
    '#9ca3af': checkerStyle('#6b7280', '#9ca3af'),
    '#4b5563': checkerStyle('#374151', '#4b5563'),
    '#111827': checkerStyle('#000000', '#374151'),
    '#ef4444': checkerStyle('#b91c1c', '#ef4444'),
    '#f59e0b': checkerStyle('#b45309', '#f59e0b'),
    '#22c55e': checkerStyle('#15803d', '#22c55e'),
    '#6366f1': checkerStyle('#3730a3', '#6366f1'),
    '#a855f7': checkerStyle('#7e22ce', '#a855f7'),
    '#ec4899': checkerStyle('#be185d', '#ec4899'),
    'rainbow': { backgroundImage: 'linear-gradient(135deg,#f857a6 0%,#ff5858 16%,#ffae58 33%,#fffe58 50%,#58ff89 66%,#58c6ff 83%,#b558ff 100%)' },
};

// Ids and labels come from the shared palette so this sidebar and the AI
// command parser can never disagree about which swatches exist; only the
// visual treatment lives here.
const BG_SWATCHES = CANVAS_BACKGROUNDS.map((swatch) => ({
    ...swatch,
    style: BG_STYLES[swatch.id],
}));

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
        canvasBg: string;
        autoCropUploads: boolean;
        bgClearEnclosed: boolean;
    };
    onUpdateSetting: (key: keyof SidebarProps['settings'], value: any) => void;
    onOpenLoadModal: () => void;
    onOpenOrderHistory: () => void;
    onOpenAccountModal: () => void;
    onOpenAuthModal: (view: "login" | "register") => void;
    onCreateGangSheet: () => void;
    /** Whether the board has anything on it — decides whether guides can show. */
    hasArtwork: boolean;
    onClearArtboard: () => void;
    onSignOut: () => void;
    isLoggedIn: boolean;
    user?: { name?: string; email?: string; avatarUrl?: string | null } | null;
};

/*
 * No `disabled` prop. Its only call site passed a literal `false`, and spacing is
 * live whether or not auto-nest is on — changing it forces a one-off re-gap
 * (`runGlobalPack = autoNestStickers || configChanged`).
 */
/** How much one press of a stepper moves the spacing, in inches. */
const SPACING_STEP_IN = 0.05;
/** Matches the validation in `editorSettings`, so a stepper cannot store a value a reload would reject. */
const SPACING_MAX_IN = 6;

function SpacingInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const [local, setLocal] = useState(String(value));

    useEffect(() => {
        const n = parseFloat(local);
        if (isNaN(n) || Math.abs(n - value) > 0.0001) setLocal(String(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    /*
     * Typing a decimal was the only way to change this. A stepper is what the
     * control is for — nudging a gap by a hair and watching the sheet re-nest —
     * and doing that by selecting text and retyping "0.55" is the slow path.
     *
     * Rounded to two decimals because repeated float addition drifts: 0.5 + 0.05
     * eight times lands on 0.8999999999999999, which then renders in the field.
     */
    const step = (direction: 1 | -1) => {
        const current = Number.isFinite(parseFloat(local)) ? parseFloat(local) : value;
        const next = Math.min(SPACING_MAX_IN, Math.max(0, Math.round((current + direction * SPACING_STEP_IN) * 100) / 100));
        setLocal(String(next));
        onChange(next);
    };

    const atMin = value <= 0;
    const atMax = value >= SPACING_MAX_IN;

    const stepBtn = "flex h-1/2 w-7 items-center justify-center text-gray-500 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors cursor-pointer";

    return (
        <div className="flex items-stretch rounded-md bg-gray-100 focus-within:ring-1 focus-within:ring-black overflow-hidden">
            <input
                type="text"
                inputMode="decimal"
                aria-label="Item spacing in inches"
                value={local}
                onChange={(e) => {
                    setLocal(e.target.value);
                    const n = parseFloat(e.target.value);
                    if (Number.isFinite(n) && n >= 0 && n <= SPACING_MAX_IN) onChange(n);
                }}
                onBlur={() => {
                    const n = parseFloat(local);
                    if (Number.isFinite(n) && n >= 0) {
                        const clamped = Math.min(SPACING_MAX_IN, n);
                        onChange(clamped);
                        setLocal(String(clamped));
                    } else {
                        setLocal(String(value));
                    }
                }}
                /* Arrow keys step it too, which is what the field already looks
                   like it should do. */
                onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
                    if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
                }}
                className="min-w-0 flex-1 bg-transparent border-none py-2 px-3 text-[12px] font-medium focus:outline-none"
            />
            <div className="flex w-7 flex-col border-l border-gray-200">
                <button
                    type="button"
                    onClick={() => step(1)}
                    disabled={atMax}
                    aria-label={`Increase spacing by ${SPACING_STEP_IN} inches`}
                    title={`+${SPACING_STEP_IN}"`}
                    className={`${stepBtn} border-b border-gray-200`}
                >
                    <MdKeyboardArrowUp size={14} />
                </button>
                <button
                    type="button"
                    onClick={() => step(-1)}
                    disabled={atMin}
                    aria-label={`Decrease spacing by ${SPACING_STEP_IN} inches`}
                    title={`-${SPACING_STEP_IN}"`}
                    className={stepBtn}
                >
                    <MdKeyboardArrowDown size={14} />
                </button>
            </div>
        </div>
    );
}

export default function Sidebar({
    isOpen,
    onClose,
    settings,
    onUpdateSetting,
    onOpenLoadModal,
    onOpenOrderHistory,
    onOpenAccountModal,
    onOpenAuthModal,
    onCreateGangSheet,
    hasArtwork,
    onClearArtboard,
    onSignOut,
    isLoggedIn,
    user
}: SidebarProps) {
    // State for sections
    const [sections, setSections] = useState({
        selectedImage: true,
        canvasDisplay: true,
        autoNest: true,
        gangSheets: true,
        account: true,
    });

    const toggleSection = (key: keyof typeof sections) => {
        setSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // On phones, hide the precision controls that can't be operated there:
    // rulers (which are force-hidden on mobile anyway), snap-to-grid, the
    // margin-size selector, and the numeric item-spacing input.
    const isMobile = useIsMobile();

    if (!isOpen) return null;

    return (
        <>
            {/* Overlay */}
            <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

            {/* Sidebar Container */}
            <div className="fixed top-12 right-4 w-[320px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-64px)] bg-white rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col animate-slide-in-right border border-gray-100">

                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <div className="flex items-center gap-2 text-gray-800">
                        <MdSettings size={18} />
                        <span className="text-[14px] font-semibold">Settings</span>
                    </div>
                    <button onClick={onClose} aria-label="Close settings" className="text-gray-500 hover:text-gray-800 transition-colors cursor-pointer">
                        <MdClose size={18} />
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-4 py-2 custom-scrollbar">

                    {/* The selected image's own settings — the same fields as its
                        right-click panel, which a touch screen has no way to open.
                        The image renders them into the slot; see `selectedImageSlot`. */}
                    <div className="border-b border-gray-100 pb-2">
                        <SectionHeader
                            title="Selected Image"
                            expanded={sections.selectedImage}
                            onToggle={() => toggleSection('selectedImage')}
                        />
                        {sections.selectedImage && (
                            <div className="mb-3">
                                <div ref={registerSelectedImageSlot} className="selected-image-slot" />
                                <p className="selected-image-hint text-[12px] leading-relaxed text-gray-500">
                                    Select one image on the sheet to set its copies, size and position here.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Canvas Display Section */}
                    <div className="border-b border-gray-100 pb-2">
                        <SectionHeader
                            title="Canvas Display"
                            expanded={sections.canvasDisplay}
                            onToggle={() => toggleSection('canvasDisplay')}
                        />

                        {sections.canvasDisplay && (
                            <div className="space-y-1 mb-4">
                                {/*
                                  Uncommented. It was commented out because it did
                                  nothing — `showGrid` reached `Artboard` and stopped
                                  there, with no grid renderer anywhere. `CanvasGrid`
                                  now draws the same lattice `snapToGridPoint` rounds
                                  to, so the toggle has something to show.
                                */}
                                <IconRow
                                    icon={MdGridOn}
                                    label="Show Grid"
                                    onClick={() => onUpdateSetting('showGrid', !settings.showGrid)}
                                    action={<Toggle label="Show Grid" checked={settings.showGrid} onChange={() => onUpdateSetting('showGrid', !settings.showGrid)} />}
                                    hint={hasArtwork ? undefined : "Appears on the sheet once you add artwork"}
                                />
                                {!isMobile && (
                                    <IconRow
                                        icon={MdStraighten}
                                        label="Show Rulers"
                                        onClick={() => onUpdateSetting('showRulers', !settings.showRulers)}
                                        action={<Toggle label="Show Rulers" checked={settings.showRulers} onChange={() => onUpdateSetting('showRulers', !settings.showRulers)} />}
                                    />
                                )}
                                <IconRow
                                    icon={MdVisibility}
                                    label="Show Margins"
                                    onClick={() => onUpdateSetting('showMargins', !settings.showMargins)}
                                    action={<Toggle label="Show Margins" checked={settings.showMargins} onChange={() => onUpdateSetting('showMargins', !settings.showMargins)} />}
                                    /*
                                     * The guide is drawn on the sheet, and there is no sheet
                                     * until artwork exists — the empty board shows an upload
                                     * card instead. Without this the toggle looks broken at
                                     * exactly the moment someone first tries it.
                                     */
                                    hint={hasArtwork ? undefined : "Appears on the sheet once you add artwork"}
                                />
                                <IconRow
                                    icon={MdGridView}
                                    label="Snap to Grid"
                                    onClick={() => onUpdateSetting('snapToGrid', !settings.snapToGrid)}
                                    action={<Toggle label="Snap to Grid" checked={settings.snapToGrid} onChange={() => onUpdateSetting('snapToGrid', !settings.snapToGrid)} />}
                                />

                                {/* Preview Background */}
                                <div className="pt-2 pb-1">
                                    <p className="text-[11px] font-semibold text-gray-500 mb-2 tracking-wide uppercase">Preview Background</p>
                                    <div className="grid grid-cols-7 gap-1">
                                        {BG_SWATCHES.map((swatch) => {
                                            const selected = settings.canvasBg === swatch.id;
                                            return (
                                                <button
                                                    key={swatch.id}
                                                    title={swatch.label}
                                                    aria-label={`Preview background: ${swatch.label}`}
                                                    aria-pressed={selected}
                                                    onClick={() => onUpdateSetting('canvasBg', swatch.id)}
                                                    className={`h-6 min-w-[24px] flex-1 rounded-[3px] cursor-pointer transition-all duration-100 focus:outline-none ${selected
                                                            ? 'ring-2 ring-blue-500 ring-offset-[2px] brightness-110'
                                                            : 'hover:ring-1 hover:ring-gray-400 hover:ring-offset-[1px] hover:brightness-105'
                                                        }`}
                                                    style={swatch.style}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Margin Size Dropdown. Hidden on phones until
                                    pieces could be moved there at all; it is a
                                    plain select and works by touch. */}
                                <>
                                    <div className="flex items-center justify-between py-2 mt-2 px-2 -mx-2 rounded-lg hover:bg-gray-50 transition-colors">
                                        <div className="flex items-center gap-3 text-gray-600">
                                            <MdStraighten size={20} className="rotate-45" />
                                            <span className="text-[12px] font-medium">Margin Size</span>
                                        </div>
                                        <div className="relative">
                                            <select
                                                aria-label="Margin size"
                                                value={settings.marginSize}
                                                onChange={(e) => onUpdateSetting('marginSize', parseFloat(e.target.value))}
                                                className="bg-gray-100 text-[12px] py-1.5 pl-3 pr-8 rounded-md border-none focus:outline-none focus:ring-1 focus:ring-black cursor-pointer appearance-none text-gray-700 font-medium w-40"
                                            >
                                                {MARGIN_OPTIONS.map((option) => (
                                                    <option key={option} value={option}>
                                                        {/* Labelled from the constant, so the two cannot
                                                        drift again — this said 0.25 while the editor
                                                        ran at 0.15. */}
                                                        {option}"{option === CANVAS.DEFAULT_MARGIN ? ' (Default)' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                            <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-gray-500">
                                                <MdKeyboardArrowDown size={16} />
                                            </div>
                                        </div>
                                    </div>
                                </>
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
                                        <Toggle label="Auto-Nest" checked={settings.autoNestStickers} onChange={() => onUpdateSetting('autoNestStickers', !settings.autoNestStickers)} />
                                    </div>
                                    <p className="text-[12px] text-gray-500">Arrange efficiently and fill leftover gaps</p>
                                </div>

                                {/* The default for new uploads only. Each image on the
                                    sheet keeps its own setting, changed from its
                                    right-click panel. */}
                                <div className="mt-3 bg-gray-50 rounded-lg p-3 border border-gray-100 hover:bg-gray-100 transition-colors">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-[12px] font-semibold text-slate-800">Auto Crop Uploads</span>
                                        <Toggle label="Auto Crop Uploads" checked={settings.autoCropUploads} onChange={() => onUpdateSetting('autoCropUploads', !settings.autoCropUploads)} />
                                    </div>
                                    <p className="text-[12px] text-gray-500">Trim empty space around new images. Change any image from its right-click menu.</p>
                                </div>


                                {/* Shown on mobile too. The setting applied on a phone
                                    all along — it was only the control that was hidden,
                                    so the spacing could not be changed there. */}
                                <div className="mt-4">
                                    <label className="text-[12px] font-semibold text-slate-700 block mb-2">Item Spacing Inches</label>
                                    <div className="relative">
                                        <SpacingInput
                                            value={settings.spacing}
                                            onChange={(v) => onUpdateSetting('spacing', v)}
                                        />
                                    </div>
                                    <p className="text-[12px] text-gray-500 mt-2">Space between items</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/*
                      Gang Sheets.

                      Nothing here is disabled while signed out. Create and Clear
                      are local — they reset the board in front of you and touch
                      no account — so blocking them stopped a visitor tidying up
                      work they were allowed to start. Save and Load do need an
                      account, and the Editor already prompts for one on click,
                      which says more than a dead button with a tooltip.
                    */}
                    {/* Gang Sheets Section */}
                    <div
                        className="border-b border-gray-100 py-2"
                    >
                        <SectionHeader
                            title="Gang Sheets"
                            expanded={sections.gangSheets}
                            onToggle={() => toggleSection('gangSheets')}
                        />

                        {sections.gangSheets && (
                            <div className="space-y-1 mb-4">
                                <div
                                >
                                    <button
                                        className="flex items-center gap-3 w-full py-2 px-2 -mx-2 rounded-lg text-gray-600 hover:text-slate-900 hover:bg-gray-50 text-left cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={() => { onCreateGangSheet(); onClose(); }}
                                    >
                                        <MdAdd size={20} />
                                        <span className="text-[12px] font-medium">Create GangSheet</span>
                                    </button>
                                </div>
                                <div
                                >
                                    <button
                                        className="flex items-center gap-3 w-full py-2 px-2 -mx-2 rounded-lg text-gray-600 hover:text-slate-900 hover:bg-gray-50 text-left cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={onOpenLoadModal}
                                    >
                                        <MdFolderOpen size={20} />
                                        <span className="text-[12px] font-medium">Load GangSheet</span>
                                    </button>
                                </div>
                                <div
                                >
                                    <button
                                        className="flex items-center gap-3 w-full py-2 px-2 -mx-2 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 text-left cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={() => {
                                            onClearArtboard();
                                            onClose();
                                        }}
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
                                        <button onClick={() => { onClose(); onOpenOrderHistory(); }} className="flex items-center gap-3 w-full py-2 px-2 -mx-2 rounded-lg text-gray-600 hover:text-slate-900 hover:bg-gray-50 text-left cursor-pointer transition-colors">
                                            <MdReceiptLong size={20} />
                                            <span className="text-[12px] font-medium">Order History</span>
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
        </>
    );
}
