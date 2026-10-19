import { useNavigate } from "react-router-dom";
import { GenericTable } from "../common/GenericTable";
import { AvailabilityBadge } from "./AvailabilityBadge";
import type { Partner } from "../../types/partners";

const getStatusStyles = (status: Partner["status"]) => {
    switch (status) {
        case "Active":
            return "bg-green-50 text-green-700";
        case "Pending":
            return "bg-amber-50 text-amber-600";
        case "Under Review":
            return "bg-amber-50 text-amber-600";
        case "Suspended":
            return "bg-red-50 text-red-700";
        // Grey, not red: a rejected application is closed and needs nothing from
        // anyone. Red is for a partner who was working and has been stopped.
        case "Rejected":
        case "Closed":
            return "bg-gray-100 text-gray-600";
        default:
            return "bg-gray-50 text-gray-600";
    }
};

export const PartnersTable = ({
    partners,
    error = null,
}: {
    partners: Partner[];
    /** Passed straight through so a failed load is not shown as an empty roster. */
    error?: string | null;
}) => {
    const navigate = useNavigate();

    const columns = [
        {
            header: "Partner Name",
            render: (partner: Partner) => (
                <div className="flex flex-col">
                    <span className="font-semibold text-gray-900">{partner.name}</span>
                    <span className="text-xs text-gray-500">{partner.email}</span>
                </div>
            )
        },
        {
            header: "Region Coverage",
            render: (partner: Partner) => (
                <div className="flex flex-wrap gap-1.5">
                    {partner.regions.map((region) => (
                        <span
                            key={region}
                            className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-md text-[11px] font-medium"
                        >
                            {region}
                        </span>
                    ))}
                </div>
            )
        },
        {
            header: "Status",
            render: (partner: Partner) => (
                <div className="flex flex-col items-start gap-1.5">
                    <span
                        className={`px-3 py-1 rounded-full text-[11px] font-semibold ${getStatusStyles(
                            partner.status
                        )}`}
                    >
                        {partner.status}
                    </span>
                    {/*
                      Only for Active partners. Availability decides whether
                      auto-assignment will route work to them, and for a
                      Pending, Suspended or Rejected partner it decides
                      nothing — showing a green "Open" beside "Suspended"
                      would say they are taking work when they cannot.
                    */}
                    {partner.status === "Active" && (
                        <AvailabilityBadge
                            status={partner.availabilityStatus}
                            capacityPaused={partner.capacityPaused}
                            size="sm"
                        />
                    )}
                </div>
            )
        },
        { header: "In Progress", key: "ordersInProgress" as keyof Partner, className: "text-gray-900 font-medium" },
        { header: "Completed", key: "orders" as keyof Partner, className: "text-gray-900 font-medium" },
        {
            header: "Action",
            /*
             * A span, not a button. It never had an onClick — it only worked
             * because the click bubbled to the row's navigate handler, so a
             * stopPropagation above would have killed it silently while it
             * still looked clickable. The row is the control.
             */
            render: () => (
                <span className="text-gray-500 group-hover:text-gray-600 font-medium text-xs uppercase tracking-wide">
                    View
                </span>
            )
        },
    ];

    return (
        <GenericTable
            data={partners}
            error={error}
            columns={columns}
            showFooterInfo={true}
            footerLabel="partners"
            itemsPerPage={5}
            onRowClick={(partner) => navigate(`/dashboard/fulfilment-partners/${partner.id}`)}
        />
    );
};
