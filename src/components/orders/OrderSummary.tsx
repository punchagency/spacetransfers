import { useEffect, useMemo, useRef, useState } from "react";
import { FiMail, FiPhone, FiMapPin, FiImage, FiUser } from "react-icons/fi";
import { apiFetch } from "../../utils/api";

interface OrderSummaryProps {
    order: {
        customer: {
            name?: string;
            firstName?: string;
            lastName?: string;
            email: string;
            phone?: string;
        };
        shippingAddress?: {
            street: string;
            city: string;
            state: string;
            postalCode: string;
            country: string;
            region?: string;
        };
        items: Array<{
            name: string;
            quantity: number;
            size?: string;
            price?: number;
            options?: any;
            fileUrl?: string;
        }>;
        gangsheetItems?: Array<{
            name: string;
            sku: string;
            quantity: number;
            size: string;
            color: string;
            customAttributes?: Record<string, any>;
            fileUrl?: string | null;
        }>;
        preview?: {
            designId?: string;
            sheetSize?: string;
            fileUrl?: string | null;
            sheetWidthIn?: number | null;
            sheetHeightIn?: number | null;
            artboardItems?: Array<{
                id: number;
                assetId: string;
                croppedUrl?: string;
                autoCrop?: boolean;
                widthIn: number;
                heightIn: number;
                posX: number;
                posY: number;
                rotation: number;
                copies: number;
                linked: boolean;
            }> | null;
        };
    };
}

export const OrderSummary = ({ order }: OrderSummaryProps) => {
    const { customer, shippingAddress, items } = order;
    const displayName = customer.name
        || `${customer.firstName || ''} ${customer.lastName || ''}`.trim()
        || 'N/A';
    const gangsheetItems = Array.isArray(order.gangsheetItems) ? order.gangsheetItems : [];
    const artboardItems = Array.isArray(order.preview?.artboardItems) ? order.preview?.artboardItems : null;
    const derivedGangsheetItems = gangsheetItems.length === 0 && artboardItems
        ? artboardItems.map((it) => {
            const rawSku = typeof it.assetId === 'string' ? it.assetId : '';
            const sku = rawSku ? rawSku.split('/').filter(Boolean).slice(-1)[0] : `ITEM-${it.id}`;
            const baseName = sku ? sku.replace(/\.[a-z0-9]+$/i, '') : `Artwork ${it.id}`;
            return {
                name: baseName || `Artwork ${it.id}`,
                sku,
                quantity: typeof it.copies === 'number' ? it.copies : 1,
                size: (typeof it.widthIn === 'number' && typeof it.heightIn === 'number')
                    ? `${it.widthIn.toFixed(2)}" × ${it.heightIn.toFixed(2)}"`
                    : 'N/A',
                color: 'N/A',
                customAttributes: {
                    linked: Boolean(it.linked),
                    autoCrop: it.autoCrop !== false,
                    rotation: typeof it.rotation === 'number' ? it.rotation : 0
                },
                fileUrl: it.croppedUrl || it.assetId || null
            };
        })
        : [];
    const rawEffectiveItems = gangsheetItems.length > 0 ? gangsheetItems : derivedGangsheetItems;

    // Consolidate duplicate items by SKU and Size
    const consolidatedMap = rawEffectiveItems.reduce((acc, item) => {
        const key = `${item.sku}-${item.size}`;
        if (!acc[key]) {
            acc[key] = { ...item };
        } else {
            acc[key].quantity += item.quantity;
            // Optionally merge custom attributes if they differ, but for now we assume they are the same
        }
        return acc;
    }, {} as Record<string, typeof rawEffectiveItems[0]>);

    const effectiveGangsheetItems = Object.values(consolidatedMap);

    const GANGSHEET_PAGE_SIZE = 15;
    const [gangsheetPage, setGangsheetPage] = useState(0);
    const gangsheetPageCount = Math.max(1, Math.ceil(effectiveGangsheetItems.length / GANGSHEET_PAGE_SIZE));
    // The order refreshes on a 5s poll, so the list can shrink under a reader
    // sitting on a later page. Clamp rather than render an empty page.
    const safeGangsheetPage = Math.min(gangsheetPage, gangsheetPageCount - 1);
    const gangsheetStart = safeGangsheetPage * GANGSHEET_PAGE_SIZE;
    const visibleGangsheetItems = effectiveGangsheetItems.slice(
        gangsheetStart,
        gangsheetStart + GANGSHEET_PAGE_SIZE,
    );

    const orderId = typeof (order as any)?.id === "string" ? String((order as any).id) : null;
    const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
    const [previewSheet, setPreviewSheet] = useState<{ widthIn: number | null; heightIn: number | null }>({
        widthIn: null,
        heightIn: null,
    });

    const VIEWPORT_SIZE_IN = 23.5;
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const [viewportPx, setViewportPx] = useState(0);

    useEffect(() => {
        const el = viewportRef.current;
        if (!el) return;
        const update = () => setViewportPx(el.clientWidth);
        update();
        if (typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => update());
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        if (!orderId) return;
        let alive = true;

        const fetchPreview = async () => {
            try {
                const r = await apiFetch(`/admin/orders/${encodeURIComponent(orderId)}/gangsheet/preview?resolution=150`);
                if (!alive) return;
                setPreviewDataUrl(typeof r?.previewDataUrl === "string" ? r.previewDataUrl : null);
                setPreviewSheet({
                    widthIn: typeof r?.sheetWidthIn === "number" ? r.sheetWidthIn : null,
                    heightIn: typeof r?.sheetHeightIn === "number" ? r.sheetHeightIn : null,
                });
            } catch {
                if (!alive) return;
                setPreviewDataUrl(null);
                setPreviewSheet({ widthIn: null, heightIn: null });
            }
        };

        fetchPreview();
        const intervalId = window.setInterval(() => void fetchPreview(), 5000);
        return () => {
            alive = false;
            window.clearInterval(intervalId);
        };
    }, [orderId]);

    const dims = useMemo(() => {
        const w =
            typeof previewSheet.widthIn === "number" && Number.isFinite(previewSheet.widthIn) && previewSheet.widthIn > 0
                ? previewSheet.widthIn
                : VIEWPORT_SIZE_IN;
        const h =
            typeof previewSheet.heightIn === "number" && Number.isFinite(previewSheet.heightIn) && previewSheet.heightIn > 0
                ? previewSheet.heightIn
                : VIEWPORT_SIZE_IN;
        return {
            sheetWIn: w,
            sheetHIn: h,
            innerWIn: Math.max(w, VIEWPORT_SIZE_IN),
            innerHIn: Math.max(h, VIEWPORT_SIZE_IN),
        };
    }, [previewSheet.heightIn, previewSheet.widthIn]);

    const pxPerIn = viewportPx > 0 ? viewportPx / VIEWPORT_SIZE_IN : 0;
    const innerStyle = pxPerIn
        ? { width: dims.innerWIn * pxPerIn, height: dims.innerHIn * pxPerIn }
        : { width: "100%", height: "100%" };
    const imgStyle = pxPerIn
        ? { width: dims.sheetWIn * pxPerIn, height: dims.sheetHIn * pxPerIn }
        : { width: "100%", height: "100%" };

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Order Summary</h2>

            {/* Customer Info */}
            <div className="mb-8">
                <h3 className="text-sm font-medium text-gray-500 mb-4 uppercase tracking-wide">
                    Customer Information
                </h3>
                <div className="space-y-3">
                    <div className="flex items-center gap-3 text-gray-600">
                        <FiUser className="w-4 h-4 shrink-0" />
                        <span className="font-semibold text-gray-900">{displayName}</span>
                    </div>
                    <div className="flex items-center gap-3 text-gray-600">
                        <FiMail className="w-4 h-4 shrink-0" />
                        <span>{customer.email}</span>
                    </div>
                    {customer.phone && customer.phone !== 'N/A' && (
                        <div className="flex items-center gap-3 text-gray-600">
                            <FiPhone className="w-4 h-4 shrink-0" />
                            <span>{customer.phone}</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="border-t border-gray-100 my-6"></div>

            {/* Shipping Address */}
            <div className="mb-8">
                <div className="flex justify-between items-start mb-4">
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                        Shipping Address
                    </h3>
                    {shippingAddress?.region && shippingAddress.region !== 'Unknown' && (
                        <span className="text-blue-600 text-sm font-medium bg-blue-50 px-2 py-1 rounded">
                            {shippingAddress.region}
                        </span>
                    )}
                </div>
                <div className="flex items-start gap-3 text-gray-600">
                    <FiMapPin className="w-4 h-4 mt-1 shrink-0" />
                    {shippingAddress && shippingAddress.street && shippingAddress.street !== 'N/A' ? (
                        <div>
                            <p>{shippingAddress.street}</p>
                            <p>{shippingAddress.city}, {shippingAddress.state} {shippingAddress.postalCode}</p>
                            <p className="text-xs text-gray-400 mt-1 uppercase">{shippingAddress.country}</p>
                        </div>
                    ) : (
                        <p className="italic text-gray-400">No shipping address provided</p>
                    )}
                </div>
            </div>

            <div className="border-t border-gray-100 my-6"></div>

            {/* Items Ordered */}
            <div className="mb-8">
                {(() => {
                    const consolidatedItems = items.reduce((acc, item) => {
                        const key = `${item.name}-${item.size || 'default'}-${item.price || 0}`;
                        if (!acc[key]) {
                            acc[key] = { ...item };
                        } else {
                            acc[key].quantity += item.quantity;
                        }
                        return acc;
                    }, {} as Record<string, typeof items[0]>);
                    const displayItems = Object.values(consolidatedItems);

                    return (
                        <>
                            <h3 className="text-sm font-medium text-gray-500 mb-4 uppercase tracking-wide">
                                Items Ordered ({displayItems.length} Unique)
                            </h3>
                            <div className="space-y-4">
                                {displayItems.map((item, index) => (
                                    <div key={index} className="flex items-center gap-4 bg-gray-50 p-4 rounded-lg border border-gray-100">
                                        <div className="w-12 h-12 bg-white rounded border border-gray-200 flex items-center justify-center text-gray-400 overflow-hidden shrink-0">
                                            {item.fileUrl ? (
                                                <img src={item.fileUrl} alt={item.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <FiImage className="w-6 h-6" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-gray-900 truncate">{item.name}</p>
                                            <p className="text-sm text-gray-500">
                                                Qty: <span className="font-bold text-blue-600">{item.quantity}</span>
                                                {item.size && item.size !== 'Custom' && <span className="ml-2">· {item.size}</span>}
                                            </p>
                                        </div>
                                        {item.price != null && (
                                            <div className="text-right shrink-0">
                                                <p className="text-sm font-semibold text-gray-900">${(item.price * item.quantity).toFixed(2)}</p>
                                                {item.quantity > 1 && (
                                                    <p className="text-[10px] text-gray-400">${item.price.toFixed(2)} each</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </>
                    );
                })()}

                {effectiveGangsheetItems.length > 0 && (
                    <div className="mt-6">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                Gangsheet Contents ({effectiveGangsheetItems.length} Unique Items)
                            </h4>
                            {gangsheetPageCount > 1 && (
                                <span className="text-xs text-gray-400">
                                    Showing {gangsheetStart + 1}–{gangsheetStart + visibleGangsheetItems.length}
                                </span>
                            )}
                        </div>
                        <div className="space-y-3">
                            {visibleGangsheetItems.map((it, idx) => (
                                // Absolute index, not the page-local one: two
                                // pages can otherwise produce the same key for
                                // different rows, and React reuses the previous
                                // page's DOM — showing the wrong thumbnail.
                                <div key={`${it.sku}-${gangsheetStart + idx}`} className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                                    <div className="flex items-start gap-4">
                                        <div className="w-12 h-12 bg-white rounded border border-gray-200 flex items-center justify-center text-gray-400 overflow-hidden shrink-0">
                                            {it.fileUrl ? (
                                                <img src={it.fileUrl} alt={it.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <FiImage className="w-6 h-6" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="font-medium text-gray-900 truncate">
                                                    {it.name}
                                                </p>
                                                <span className="text-xs text-gray-500 shrink-0">{it.sku}</span>
                                            </div>
                                            <div className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-600">
                                                <div>
                                                    <span className="text-gray-400">Total Qty:</span>{" "}
                                                    <span className="font-bold text-blue-600">{it.quantity}</span>
                                                </div>
                                                <div><span className="text-gray-400">Size:</span> {it.size}</div>
                                                <div><span className="text-gray-400">Color:</span> {it.color}</div>
                                                <div>
                                                    <span className="text-gray-400">Attrs:</span>{" "}
                                                    {it.customAttributes ? Object.entries(it.customAttributes).map(([k, v]) => `${k}:${String(v)}`).join(", ") : "N/A"}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/*
                          A busy sheet carries hundreds of unique graphics — this
                          order has 306 — and every one was rendered at once, so
                          reaching anything below the list meant scrolling past
                          all of them. Paged rather than virtualised: the list is
                          long, not infinite, and paging keeps the page height
                          predictable without pulling in a windowing library.
                        */}
                        {gangsheetPageCount > 1 && (
                            <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-gray-100">
                                <button
                                    type="button"
                                    onClick={() => setGangsheetPage(Math.max(0, safeGangsheetPage - 1))}
                                    disabled={safeGangsheetPage === 0}
                                    className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Previous
                                </button>
                                <span className="text-xs text-gray-500 tabular-nums">
                                    Page {safeGangsheetPage + 1} of {gangsheetPageCount}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setGangsheetPage(Math.min(gangsheetPageCount - 1, safeGangsheetPage + 1))}
                                    disabled={safeGangsheetPage >= gangsheetPageCount - 1}
                                    className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Next
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="border-t border-gray-100 my-6"></div>

            {/* Gangsheet Preview */}
            <div>
                <h3 className="text-sm font-medium text-gray-500 mb-4 uppercase tracking-wide">
                    Gangsheet Preview
                </h3>
                {order.preview?.sheetSize && (
                    <p className="text-xs text-gray-400 mb-3">
                        Sheet size: <span className="font-medium text-gray-600">{order.preview.sheetSize}</span>
                    </p>
                )}
                <div className="w-full flex justify-center">
                    <div className="w-full max-w-[520px]">
                        <div ref={viewportRef} className="relative w-full aspect-square border border-gray-200 rounded-xl bg-gray-50 overflow-auto">
                            <div className="relative bg-white" style={innerStyle}>
                                <div
                                    className="absolute inset-0 opacity-20"
                                    style={{
                                        backgroundImage: `linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)`,
                                        backgroundSize: "20px 20px",
                                        backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
                                    }}
                                />

                                {previewDataUrl ? (
                                    <img src={previewDataUrl} alt="Gangsheet preview" className="absolute top-0 left-0" style={imgStyle} />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
                                        Preview unavailable
                                    </div>
                                )}

                                <div className="absolute inset-0 border border-red-200 pointer-events-none" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
