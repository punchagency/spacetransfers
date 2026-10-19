import { RiArrowDropLeftLine, RiArrowDropRightLine } from "react-icons/ri";

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

export const Pagination = ({ currentPage, totalPages, onPageChange }: PaginationProps) => {
    if (totalPages <= 0) return null;

    const handlePrevious = () => {
        if (currentPage > 1) {
            onPageChange(currentPage - 1);
        }
    };

    const handleNext = () => {
        if (currentPage < totalPages) {
            onPageChange(currentPage + 1);
        }
    };

    const getPageNumbers = () => {
        const pages = [];
        for (let i = 1; i <= totalPages; i++) {
            pages.push(i);
        }
        return pages;
    };

    return (
        <div className="flex items-center justify-center gap-2 p-4">
            <button
                onClick={handlePrevious}
                disabled={currentPage === 1}
                className={`p-2 hover:text-gray-600 ${currentPage === 1 ? "text-gray-300 cursor-not-allowed" : "text-gray-500 cursor-pointer"
                    }`}
            >
                <span className="sr-only">Previous</span>
                <RiArrowDropLeftLine size={30} />
            </button>

            {getPageNumbers().map((page) => (
                <button
                    key={page}
                    onClick={() => onPageChange(page)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-medium transition-colors
            ${currentPage === page
                            ? "bg-gray-600 text-white"
                            : "text-gray-600 hover:bg-gray-50 bg-white"
                        }
          `}
                >
                    {page}
                </button>
            ))}

            <button
                onClick={handleNext}
                disabled={currentPage === totalPages}
                className={`p-2 hover:text-gray-600 ${currentPage === totalPages ? "text-gray-300 cursor-not-allowed" : "text-gray-500 cursor-pointer"
                    }`}
            >
                <span className="sr-only">Next</span>
                <RiArrowDropRightLine size={30} />
            </button>
        </div>
    );
};
