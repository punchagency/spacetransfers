export interface AdminShipment {
    carrier: string | null;
    service: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    trackingStatus: string | null;
    estimatedDeliveryAt: string | null;
    labelUrl: string | null;
    labelError: string | null;
    labelRefund: { status: string; requestedAt: string } | null;
}

const REFUND_WORDS: Record<string, string> = {
    submitted: 'refund requested',
    refunded: 'refunded',
    rejected: 'refund rejected by the carrier',
    not_applicable: 'no refund applies',
    failed: "refund couldn't be requested",
};

const day = (value: string | null) =>
    value ? new Date(value).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : null;

/** The shipping label and where the parcel is. Shown once there is any. */
export const OrderShipment = ({ shipment }: { shipment?: AdminShipment | null }) => {
    if (!shipment) return null;
    const eta = shipment.trackingStatus === 'Delivered' ? null : day(shipment.estimatedDeliveryAt);
    return (
        <section aria-labelledby="order-shipment-h" className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
            <h2 id="order-shipment-h" className="text-md font-bold text-gray-900">
                Shipment
            </h2>
            {shipment.labelError && !shipment.labelUrl && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Label not made: {shipment.labelError}</p>
            )}
            <dl className="space-y-3 text-sm">
                {(shipment.carrier || shipment.service) && (
                    <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Carrier</dt>
                        <dd className="text-right font-medium text-gray-900">{[shipment.carrier, shipment.service].filter(Boolean).join(' · ')}</dd>
                    </div>
                )}
                {shipment.trackingNumber && (
                    <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Tracking</dt>
                        <dd className="min-w-0 text-right">
                            {shipment.trackingUrl ? (
                                <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-blue-600 hover:underline">
                                    {shipment.trackingNumber}
                                </a>
                            ) : (
                                <span className="break-all font-mono text-gray-900">{shipment.trackingNumber}</span>
                            )}
                        </dd>
                    </div>
                )}
                {shipment.trackingStatus && (
                    <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">Status</dt>
                        <dd className="text-right font-medium text-gray-900">
                            {shipment.trackingStatus}
                            {eta ? <span className="block text-xs font-normal text-gray-500">Expected {eta}</span> : null}
                        </dd>
                    </div>
                )}
                {shipment.labelRefund && (
                    <div className="flex justify-between gap-3">
                        <dt className="text-gray-500">{shipment.labelUrl ? 'Earlier label' : 'Unused label'}</dt>
                        <dd className="text-right text-gray-900">{REFUND_WORDS[shipment.labelRefund.status] || shipment.labelRefund.status}</dd>
                    </div>
                )}
            </dl>
            {shipment.labelUrl && shipment.labelUrl !== 'generated' && (
                <a
                    href={shipment.labelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                    Open the label
                </a>
            )}
        </section>
    );
};
