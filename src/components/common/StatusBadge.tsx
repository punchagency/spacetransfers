interface StatusBadgeProps {
  status: string;
}

export const StatusBadge = ({ status }: StatusBadgeProps) => {
  const getStatusStyles = (status: string) => {
    switch (status) {
      case "Urgent":
        return "bg-[#DC2626] text-white";
      case "Printing":
        return "bg-amber-600 text-white";
      case "Quality Check":
        return "bg-emerald-700 text-white";
      case "Processing":
        return "bg-blue-600 text-white";
      case "Pending":
        return "bg-blue-50 text-blue-600";
      case "Completed":
        return "bg-green-600 text-white";
      case "Cancelled":
        return "bg-gray-200 text-gray-700";
      default:
        return "bg-gray-100 text-gray-600";
    }
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusStyles(
        status
      )}`}
    >
      {status}
    </span>
  );
};
