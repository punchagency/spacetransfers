import { FiChevronDown } from "react-icons/fi";

interface SelectInputProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  containerClassName?: string;
}

export const SelectInput = ({
  className,
  containerClassName,
  children,
  ...props
}: SelectInputProps) => {
  return (
    <div className={`relative ${containerClassName || ""}`}>
      <select
        className={`w-full appearance-none pl-4 pr-10 py-2 bg-gray-50 border border-[#F3F3F5] rounded-lg text-sm outline-none cursor-pointer hover:bg-[#F3F3F5] transition-colors text-gray-700 ${
          className || ""
        }`}
        {...props}
      >
        {children}
      </select>
      <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
        <FiChevronDown className="text-gray-500" />
      </div>
    </div>
  );
};
