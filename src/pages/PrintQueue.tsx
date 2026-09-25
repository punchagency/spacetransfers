import { useEffect, useMemo, useState } from "react";
import { FiHelpCircle, FiEye } from "react-icons/fi";
import { StatusBadge } from "../components/common/StatusBadge";
import { DeadlineCountdown } from "../components/common/DeadlineCountdown";
import { useSearchParams } from "react-router-dom";
import { SpaceLoader } from "../components/common/SpaceLoader";
import { SearchInput } from "../components/common/SearchInput";
import { GenericTable } from "../components/common/GenericTable";
import { JobDetailsModal } from "../components/print/JobDetailsModal";
import type { PrintJob } from "../types/printQueue";
import { apiFetch } from "../utils/api";

export const getTabActiveStyles = (label: string) => {
  switch (label) {
    case "Printing":
      return {
        text: "text-amber-600",
        border: "border-amber-600",
        bg: "bg-amber-100",
        badgeText: "text-amber-600",
      };
    case "Completed":
      return {
        text: "text-green-600",
        border: "border-green-600",
        bg: "bg-green-100",
        badgeText: "text-green-600",
      };
    case "Print Shipping Label":
      return {
        text: "text-emerald-700",
        border: "border-emerald-700",
        bg: "bg-emerald-100",
        badgeText: "text-emerald-700",
      };
    case "Processing":
      return {
        text: "text-indigo-600",
        border: "border-indigo-600",
        bg: "bg-indigo-100",
        badgeText: "text-indigo-600",
      };
    case "Urgent":
      return {
        text: "text-red-500",
        border: "border-red-500",
        bg: "bg-red-100",
        badgeText: "text-red-500",
      };
    case "Pending":
      return {
        text: "text-gray-600",
        border: "border-gray-600",
        bg: "bg-gray-100",
        badgeText: "text-gray-600",
      };
    default:
      return {
        text: "text-blue-600",
        border: "border-blue-600",
        bg: "bg-blue-100",
        badgeText: "text-blue-600",
      };
  }
};

const PrintQueue = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const tab = searchParams.get("tab");
    const valid = ["All Jobs", "Pending", "Urgent", "Processing", "Printing", "Print Shipping Label", "Completed"];
    return tab && valid.includes(tab) ? tab : "All Jobs";
  });
  const [selectedJob, setSelectedJob] = useState<PrintJob | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(false);

  const handleRowClick = (job: PrintJob) => {
    setSelectedJob(job);
    setIsModalOpen(true);
  };

  const columns = [
    {
      header: "Order ID",
      key: "id" as keyof PrintJob,
      render: (job: PrintJob) => (
        <span className="font-medium text-gray-900">{job.orderId}</span>
      ),
    },
    {
      header: "Customer",
      key: "customer" as keyof PrintJob,
      className: "text-gray-700",
    },
    {
      header: "Sheet Size",
      key: "sheetSize" as keyof PrintJob,
      className: "text-gray-700",
    },
    {
      header: "Order",
      key: "orderDescription" as keyof PrintJob,
      className: "text-gray-700",
    },
    {
      header: "Status",
      render: (job: PrintJob) => <StatusBadge status={job.status} />,
    },
    {
      header: "Deadline",
      render: (job: PrintJob) => <DeadlineCountdown iso={job.deadline} />,
    },
    {
      header: "Actions",
      render: () => (
        <button className="text-gray-400 hover:text-gray-600 transition-colors">
          <FiEye className="w-5 h-5" />
        </button>
      ),
    },
  ];

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const r = await apiFetch("/printer/print-queue");
      const raw = Array.isArray(r?.jobs) ? r.jobs : [];
      const mapped: PrintJob[] = raw.map((j: any) => {
          const backendStatus = String(j.status || "");
          const priority = String(j.priority || "");
          const status =
            priority === "URGENT"
              ? "Urgent"
              : backendStatus === "PENDING"
              ? "Pending"
              : backendStatus === "PROCESSING"
              ? "Processing"
              : backendStatus === "PRINTING"
              ? "Printing"
              : backendStatus === "QUALITY_CHECK"
              ? "Print Shipping Label"
              : backendStatus === "COMPLETED"
              ? "Completed"
              : "Pending";

          const id = String(j.id || "");

          return {
            id,
            orderId: String(j.orderId || j.displayId || id),
            customer: String(j.customer || ""),
            sheetSize: String(j.sheetSize || ""),
            orderDescription: String(j.orderDescription || ""),
            status: status as any,
            deadline: String(j.deadline || ""),
            createdAt: j.createdAt ? String(j.createdAt) : undefined,
            priority: priority === "URGENT" ? ("Urgent" as any) : undefined,
          };
      });
      setJobs(mapped);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue().catch(() => {});
  }, []);

  useEffect(() => {
    const id = searchParams.get("jobId");
    if (!id) return;
    const found = jobs.find((j) => j.id === id);
    if (found) {
      setSelectedJob(found);
      setIsModalOpen(true);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("jobId");
        return next;
      });
    }
  }, [jobs, searchParams, setSearchParams]);

  const filteredData = useMemo(() => {
    return jobs.filter((job) => {
      if (activeTab === "All Jobs") return true;
      return job.status === activeTab;
    });
  }, [jobs, activeTab]);

  const tabs = useMemo(() => {
    const counts = {
      "All Jobs": jobs.length,
      Pending: jobs.filter((j) => j.status === "Pending").length,
      Urgent: jobs.filter((j) => j.status === "Urgent").length,
      Processing: jobs.filter((j) => j.status === "Processing").length,
      Printing: jobs.filter((j) => j.status === "Printing").length,
      "Print Shipping Label": jobs.filter((j) => j.status === "Print Shipping Label").length,
      Completed: jobs.filter((j) => j.status === "Completed").length,
    };
    return Object.entries(counts).map(([label, count]) => ({ label, count }));
  }, [jobs]);

  return (
    <div className="flex flex-col gap-6">
      {/* Sticky Header Container */}
      <div className="sticky top-0 z-10 bg-gray-50 -mx-4 md:-mx-6 -mt-4 md:-mt-6 px-4 md:px-6 pt-4 md:pt-6 pb-4  ">
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900">Print Queue</h1>
            <button className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors">
              <FiHelpCircle className="w-5 h-5" />
              <span className="font-medium">Help</span>
            </button>
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-200">
            <div className="flex items-center gap-8 overflow-x-auto">
              {tabs.map((tab) => {
                const styles = getTabActiveStyles(tab.label);
                const isActive = activeTab === tab.label;
                return (
                  <button
                    key={tab.label}
                    onClick={() => setActiveTab(tab.label)}
                    className={`pb-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-2 ${
                      isActive
                        ? `${styles.border} ${styles.text}`
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        isActive
                          ? `${styles.bg} ${styles.badgeText}`
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search */}
          <div>
            <SearchInput
              placeholder="Search by order ID or customer name..."
              className="w-full bg-white border-gray-200 py-3"
              containerClassName="max-w-[600px]"
            />
          </div>

          {/* Showing count */}
          <div className="text-gray-500">
            Showing{" "}
            <span className="font-bold text-gray-900">
              {filteredData.length}
            </span>{" "}
            jobs
          </div>
        </div>
      </div>

      {/* Table Card */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <SpaceLoader />
        </div>
      ) : (
        <GenericTable<PrintJob>
          title="Recent Orders"
          data={filteredData}
          columns={columns}
          itemsPerPage={10}
          onRowClick={handleRowClick}
        />
      )}

      <JobDetailsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        job={selectedJob}
        onJobUpdated={() => void fetchQueue()}
      />
    </div>
  );
};

export default PrintQueue;
