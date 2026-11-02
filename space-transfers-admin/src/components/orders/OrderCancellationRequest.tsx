export interface AdminCancellationRequest {
    status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
    reason: string | null;
    requestedAt: string | null;
    respondedAt: string | null;
    respondedByName: string | null;
    declineReason: string | null;
}

const when = (value: string | null) =>
    value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

/** The customer's request to cancel, and where it stands with the partner. */
export const OrderCancellationRequest = ({ request }: { request?: AdminCancellationRequest | null }) => {
    if (!request) return null;
    const pending = request.status === 'PENDING';
    return (
        <section
            aria-label="Cancellation request"
            className={`rounded-xl border px-5 py-4 text-sm ${pending ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}
        >
            <p className="font-semibold text-gray-900">
                {pending
                    ? 'The customer asked to cancel. Waiting for the partner to answer.'
                    : request.status === 'DECLINED'
                      ? `The customer asked to cancel. ${request.respondedByName || 'The partner'} declined.`
                      : `The customer asked to cancel. ${request.respondedByName || 'It'} cancelled the order.`}
            </p>
            <p className="mt-0.5 text-xs text-gray-600">
                Asked {when(request.requestedAt)}
                {request.respondedAt ? ` · answered ${when(request.respondedAt)}` : ''}
            </p>
            {request.reason && <p className="mt-2 text-gray-700">Customer: “{request.reason}”</p>}
            {request.declineReason && <p className="mt-1 text-gray-700">Reason given: “{request.declineReason}”</p>}
            {pending && (
                <p className="mt-2 text-xs text-amber-900">
                    The partner can't move the job on until they answer. You can cancel the order yourself with Cancel order above; that settles the request.
                </p>
            )}
        </section>
    );
};
