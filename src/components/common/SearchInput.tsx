import { FiSearch } from "react-icons/fi";

interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
  containerClassName?: string;
}

export const SearchInput = ({
  className,
  containerClassName,
  ...props
}: SearchInputProps) => {
  return (
    <div className={`relative ${containerClassName || ""}`}>
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <FiSearch className="text-gray-500" />
      </div>
      <input
        type="text"
        className={`pl-10 pr-4 py-2 bg-gray-50 border border-[#F3F3F5] rounded-lg w-full text-sm outline-none focus:bg-white focus:border-blue-500 transition-all placeholder:text-gray-400 ${
          className || ""
        }`}
        {...props}
      />
    </div>
  );
};
