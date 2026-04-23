import { FiEye } from "react-icons/fi";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertBanner } from "../components/common/AlertBanner";
import { SpaceLoader } from "../components/common/SpaceLoader";
import { StatCard } from "../components/stats/StatCard";
import { GenericTable } from "../components/common/GenericTable";
import { StatusBadge } from "../components/common/StatusBadge";
import type { DashboardJob } from "../types/dashboard";
import { apiFetch } from "../utils/api";

const Dashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<
    { label: string; value: string; trend: string }[]
  >([]);
  const [urgentJobs, setUrgentJobs] = useState<DashboardJob[]>([]);
  const [assignedJobs, setAssignedJobs] = useState<DashboardJob[]>([]);

  const userName = useMemo(() => {
    try {
      const raw = localStorage.getItem("printer_user");
      if (!raw) return "Printer";
      const u = JSON.parse(raw);
      return String(u?.name || "Printer");
    } catch {
      return "Printer";
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    apiFetch("/printer/dashboard/stats")
      .then((r) => {
        const nextCards = Array.isArray(r?.cards) ? r.cards : [];
        setCards(
          nextCards.map((c: any) => ({
            label: String(c.label || ""),
            value: String(c.value || ""),
            trend: String(c.trend || "0%"),
          }))
        );
        const nextUrgent = Array.isArray(r?.urgentJobs) ? r.urgentJobs : [];
        const nextAssigned = Array.isArray(r?.assignedJobs) ? r.assignedJobs : [];

        setUrgentJobs(nextUrgent);
        setAssignedJobs(nextAssigned);
      })
      .finally(() => setLoading(false));
  }, []);

  const columns = [
    {
      header: "Job ID",
      key: "id" as const,
      className: "font-medium text-gray-900",
    },
    {
      header: "Customer Name",
      key: "customerName" as const,
      className: "text-gray-600",
    },
    { header: "Order", key: "order" as const, className: "text-gray-600" },
    {
      header: "Deadline",
      key: "deadline" as const,
      className: "text-gray-600",
    },
    {
      header: "Status",
      render: (job: DashboardJob) => <StatusBadge status={job.isUrgent ? "Urgent" : job.status} />,
    },
    {
      header: "Action",
      className: "text-center",
      render: () => (
        <div className="flex justify-center">
          <button className="text-gray-500 hover:text-gray-700">
            <FiEye className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-50 -mx-6 -mt-6 px-6 pt-6 pb-4    ">
        <h1 className="text-3xl font-bold text-gray-900">
          Welcome back, {userName}!
        </h1>
        <p className="text-gray-500 mt-1">
          Here's your fulfillment overview for today. You have{" "}
          <span className="text-blue-600 font-medium cursor-pointer hover:underline">
            {assignedJobs.length} jobs
          </span>{" "}
          assigned to you{urgentJobs.length ? ` • ${urgentJobs.length} urgent` : ""}.
        </p>
      </div>

      {/* Alert Banner */}
      {urgentJobs.length > 0 ? (
        <AlertBanner
          title="Urgent Jobs Alert"
          message={`You have ${urgentJobs.length} urgent job${urgentJobs.length === 1 ? "" : "s"} assigned. Please review and start processing to avoid delays.`}
          variant="warning"
        />
      ) : null}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {loading ? (
          <div className="sm:col-span-2 lg:col-span-4 bg-white border border-gray-200 rounded-2xl p-10">
            <SpaceLoader label="Loading dashboard…" />
          </div>
        ) : (
          cards.map((stat, index) => (
            <StatCard
              key={index}
              title={stat.label}
              value={stat.value}
              trend={stat.trend}
            />
          ))
        )}
      </div>

      {/* Assigned Jobs Table */}
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-10">
          <SpaceLoader label="Loading assigned jobs…" />
        </div>
      ) : (
        <GenericTable
          title="Assigned Jobs"
          data={assignedJobs}
          columns={columns}
          itemsPerPage={10}
          onRowClick={(row) => navigate(`/print-queue?jobId=${encodeURIComponent(row.id)}`)}
        />
      )}
    </div>
  );
};

export default Dashboard;
