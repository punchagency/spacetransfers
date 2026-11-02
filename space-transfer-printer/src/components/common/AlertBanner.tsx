import { FiAlertCircle } from "react-icons/fi";

interface AlertBannerProps {
  title: string;
  message: string;
  variant?: "warning" | "error" | "info" | "success";
}

export const AlertBanner = ({ title, message, variant = "warning" }: AlertBannerProps) => {
  const styles = {
    warning: {
      bg: "bg-orange-50",
      border: "border-orange-200",
      iconColor: "text-orange-600",
      titleColor: "text-orange-900",
      textColor: "text-orange-800",
    },
    error: {
      bg: "bg-red-50",
      border: "border-red-200",
      iconColor: "text-red-600",
      titleColor: "text-red-900",
      textColor: "text-red-800",
    },
    info: {
      bg: "bg-blue-50",
      border: "border-blue-200",
      iconColor: "text-blue-600",
      titleColor: "text-blue-900",
      textColor: "text-blue-800",
    },
    success: {
      bg: "bg-green-50",
      border: "border-green-200",
      iconColor: "text-green-600",
      titleColor: "text-green-900",
      textColor: "text-green-800",
    },
  };

  const style = styles[variant];

  return (
    <div className={`${style.bg} border ${style.border} rounded-xl p-4 flex items-start gap-3`}>
      <FiAlertCircle className={`${style.iconColor} mt-0.5 w-5 h-5 flex-shrink-0`} />
      <div>
        <h3 className={`${style.titleColor} font-semibold text-sm`}>{title}</h3>
        <p className={`${style.textColor} text-sm mt-0.5`}>{message}</p>
      </div>
    </div>
  );
};
