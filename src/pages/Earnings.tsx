import { useState } from "react";
import {
  FiDownload,
  FiCreditCard,
  FiSearch,
  FiClock,
  FiCheckCircle,
  FiCalendar,
} from "react-icons/fi";
import { HiArrowTrendingUp } from "react-icons/hi2";

import { GenericTable } from "../components/common/GenericTable";
import { JobEarningsModal } from "../components/earnings/JobEarningsModal";
import { RequestPayoutModal } from "../components/earnings/RequestPayoutModal";
import { ConfirmPayoutModal } from "../components/earnings/ConfirmPayoutModal";
import type {
  EarningsJob,
  EarningsJobStatus,
  EarningsTimeFilter,
  EarningsStatCard,
} from "../types/earnings";

const Earnings = () => {
  const [timeFilter, setTimeFilter] = useState<EarningsTimeFilter>("All Time");
  const [selectedJob, setSelectedJob] = useState<EarningsJob | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRequestPayoutModalOpen, setIsRequestPayoutModalOpen] =
    useState(false);
  const [isConfirmPayoutModalOpen, setIsConfirmPayoutModalOpen] =
    useState(false);

  const stats: EarningsStatCard[] = [
    {
      title: "Today's Earnings",
      value: "$2,436",
      trend: "+12%",
      isPositive: true,
    },
    { title: "Paid Out", value: "1,847", trend: "+8%", isPositive: true },
    {
      title: "Pending Orders",
      value: "382",
      trend: "3 jobs pending",
      isWarning: true,
    },
    {
      title: "Total Revenue",
      value: "$45,293",
      trend: "+23%",
      isPositive: true,
    },
  ];

  const jobs: EarningsJob[] = [
    {
      id: "DTF-2401",
      customer: "Sarah Johnson",
      details: { title: "100 Custom T-Shirts", sub: "48 sheets" },
      completed: "Dec 14, 2025",
      amount: "$345.00",
      earning: "$276.00",
      commission: "$69.00",
      status: "Paid" as EarningsJobStatus,
    },
    {
      id: "DTF-2402",
      customer: "Mike Chen",
      details: { title: "50 Hoodies", sub: "72 sheets" },
      completed: "Dec 13, 2025",
      amount: "$520.00",
      earning: "$416.00",
      commission: "$104.00",
      status: "Paid" as EarningsJobStatus,
    },
    {
      id: "DTF-2403",
      customer: "Emma Davis",
      details: { title: "200 Tank Tops", sub: "24 sheets" },
      completed: "Dec 15, 2025",
      amount: "$180.00",
      earning: "$144.00",
      commission: "$36.00",
      status: "Pending" as EarningsJobStatus,
    },
    {
      id: "DTF-2404",
      customer: "Alex Martinez",
      details: { title: "75 Sweatshirts", sub: "36 sheets" },
      completed: "Dec 15, 2025",
      amount: "$425.00",
      earning: "$340.00",
      commission: "$85.00",
      status: "Pending" as EarningsJobStatus,
    },
    {
      id: "DTF-2405",
      customer: "Lisa Thompson",
      details: { title: "150 Polo Shirts", sub: "60 sheets" },
      completed: "Dec 12, 2025",
      amount: "$290.00",
      earning: "$232.00",
      commission: "$58.00",
      status: "Paid" as EarningsJobStatus,
    },
    {
      id: "DTF-2406",
      customer: "James Wilson",
      details: { title: "120 Long Sleeves", sub: "48 sheets" },
      completed: "Dec 14, 2025",
      amount: "$680.00",
      earning: "$544.00",
      commission: "$136.00",
      status: "Scheduled" as EarningsJobStatus,
    },
    {
      id: "DTF-2407",
      customer: "Maria Garcia",
      details: { title: "80 V-Neck Tees", sub: "30 sheets" },
      completed: "Dec 16, 2025",
      amount: "$195.00",
      earning: "$156.00",
      commission: "$39.00",
      status: "Pending" as EarningsJobStatus,
    },
    {
      id: "DTF-2408",
      customer: "David Brown",
      details: { title: "90 Crew Necks", sub: "54 sheets" },
      completed: "Dec 11, 2025",
      amount: "$410.00",
      earning: "$328.00",
      commission: "$82.00",
      status: "Paid" as EarningsJobStatus,
    },
  ];

  const handleJobClick = (job: EarningsJob) => {
    setSelectedJob(job);
    setIsModalOpen(true);
  };

  const columns = [
    {
      header: "Order ID",
      key: "id" as const,
      className: "font-bold text-gray-900",
    },
    {
      header: "Customer",
      key: "customer" as const,
      className: "text-gray-600",
    },
    {
      header: "Job Details",
      render: (job: EarningsJob) => (
        <div className="flex flex-col">
          <span className="text-sm font-medium text-gray-900">
            {job.details.title}
          </span>
          <span className="text-xs text-gray-500">{job.details.sub}</span>
        </div>
      ),
    },
    {
      header: "Completed",
      key: "completed" as const,
      className: "text-gray-600",
    },
    {
      header: "Total Amount",
      key: "amount" as const,
      className: "font-bold text-gray-900",
    },
    {
      header: "Your Earning",
      key: "earning" as const,
      className: "font-bold text-blue-600",
    },
    {
      header: "Commission",
      key: "commission" as const,
      className: "text-gray-500",
    },
    {
      header: "Payout Status",
      render: (job: EarningsJob) => (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
            job.status === "Paid"
              ? "bg-green-50 text-green-700"
              : job.status === "Pending"
                ? "bg-orange-50 text-orange-700"
                : "bg-purple-50 text-purple-700"
          }`}
        >
          {job.status === "Paid" && <FiCheckCircle className="w-3.5 h-3.5" />}
          {job.status === "Pending" && <FiClock className="w-3.5 h-3.5" />}
          {job.status === "Scheduled" && <FiCalendar className="w-3.5 h-3.5" />}
          {job.status}
        </span>
      ),
    },
    {
      header: "Actions",
      className: "text-right",
      render: () => (
        <button className="text-sm font-medium text-gray-500 hover:text-gray-900">
          View
        </button>
      ),
    },
  ];

  const timeFilters: EarningsTimeFilter[] = [
    "Today",
    "This Week",
    "This Month",
    "All Time",
  ];

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-gray-50 -mx-6 -mt-6 px-6 pt-6 pb-4 flex justify-between items-start  ">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Earnings & Payouts
          </h1>
          <p className="text2-gray-500 mt-1">
            Track your earnings and manage payment history
          </p>
        </div>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 font-medium rounded-2xl hover:bg-gray-50 transition-colors">
            <FiDownload className="w-4 h-4" />
            Export
          </button>
          <button
            onClick={() => setIsRequestPayoutModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 border border-transparent text-white font-medium rounded-2xl hover:bg-blue-700 transition-colors"
          >
            <FiCreditCard className="w-4 h-4" />
            Request Payout
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <div
            key={index}
            className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm"
          >
            <h3 className="text-gray-600 font-medium">{stat.title}</h3>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-4xl font-bold text-gray-900 tracking-tight">
                {stat.value}
              </span>
              <span
                className={`flex items-center text-sm font-medium ${
                  stat.isWarning ? "text-orange-500" : "text-green-500"
                }`}
              >
                {stat.trend}
                {stat.isPositive && (
                  <HiArrowTrendingUp className="w-4 h-4 ml-1" />
                )}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Filter & Search */}
      <div className="flex items-center p-2 bg-white rounded-2xl border border-gray-200 shadow-sm h-[72px]">
        <div className="flex items-center p-1.5 bg-[#F3F4F6] rounded-xl ml-2">
          {timeFilters.map((filter) => (
            <button
              key={filter}
              onClick={() => setTimeFilter(filter)}
              className={`px-6 py-2 text-sm font-semibold rounded-lg transition-all ${
                timeFilter === filter
                  ? "bg-[#3B82F6] text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {filter}
            </button>
          ))}
        </div>

        <div className="h-8 w-px bg-gray-200 mx-6"></div>

        <div className="relative flex-1 mr-2">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <FiSearch className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors hover:border-gray-300"
            placeholder="Search by order, customer, or job type..."
          />
        </div>
      </div>

      {/* Job Earnings Table */}
      <GenericTable
        title="Job Earnings"
        data={jobs}
        columns={columns}
        showFooterInfo={true}
        footerLabel="jobs"
        itemsPerPage={10}
        onRowClick={handleJobClick}
        footerRightContent={
          <div className="flex items-center gap-6">
            <div className="text-sm">
              <span className="text-gray-500">Total Earnings: </span>
              <span className="font-bold text-blue-600 text-lg">$2436.00</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-500">Total Commission: </span>
              <span className="font-bold text-gray-900">$609.00</span>
            </div>
          </div>
        }
      />

      <JobEarningsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        job={selectedJob}
      />

      <RequestPayoutModal
        isOpen={isRequestPayoutModalOpen}
        onClose={() => setIsRequestPayoutModalOpen(false)}
        onNext={() => {
          setIsRequestPayoutModalOpen(false);
          setIsConfirmPayoutModalOpen(true);
        }}
        availableAmount="$640.00"
        jobCount={3}
      />

      <ConfirmPayoutModal
        isOpen={isConfirmPayoutModalOpen}
        onClose={() => setIsConfirmPayoutModalOpen(false)}
        onConfirm={() => {
          // Handle final confirmation
          setIsConfirmPayoutModalOpen(false);
        }}
        amount="$ 640.00"
      />
    </div>
  );
};

export default Earnings;
