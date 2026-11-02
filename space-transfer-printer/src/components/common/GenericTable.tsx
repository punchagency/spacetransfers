import { useState, type ReactNode } from "react";
import { Pagination } from "./Pagination";

interface Column<T> {
  header: string;
  key?: keyof T;
  render?: (item: T, index: number) => ReactNode;
  className?: string;
}

interface GenericTableProps<T> {
  data: T[];
  columns: Column<T>[];
  title?: string;
  itemsPerPage?: number;
  showFooterInfo?: boolean;
  footerLabel?: string;
  onRowClick?: (item: T) => void;
  footerRightContent?: ReactNode;
  /** Shown when there are no rows — e.g. that the data couldn't be loaded, rather than "none". */
  emptyMessage?: ReactNode;
}

export function GenericTable<T>({
  data,
  columns,
  title,
  itemsPerPage = 7,
  showFooterInfo = false,
  footerLabel = "items",
  onRowClick,
  footerRightContent,
  emptyMessage = "No data found.",
}: GenericTableProps<T>) {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(data.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentItems = data.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
      {title && (
        <div className="px-6 py-4 font-semibold text-lg border-b border-gray-100">
          {title}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-gray-50/50 text-xs font-semibold text-[#364153] capitalize tracking-wider">
            <tr>
              {columns.map((col, idx) => (
                <th key={idx} className={`px-6 py-5 whitespace-nowrap ${col.className || ""}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {currentItems.length > 0 ? (
              currentItems.map((item, rowIdx) => (
                <tr
                  key={rowIdx}
                  onClick={() => onRowClick?.(item)}
                  className={`text-sm hover:bg-gray-50 transition-colors group ${
                    onRowClick ? "cursor-pointer" : ""
                  }`}
                >
                  {columns.map((col, colIdx) => (
                    <td
                      key={colIdx}
                      className={`px-6 py-5 whitespace-nowrap ${col.className || ""}`}
                    >
                      {col.render
                        ? col.render(item, rowIdx)
                        : col.key
                          ? (item[col.key] as ReactNode)
                          : null}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-6 py-10 text-center text-gray-500 italic"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-6 py-4 relative flex items-center justify-center bg-white border-t border-gray-100">
        {showFooterInfo && (
          <span className="text-sm text-gray-500 absolute left-6">
            Showing {currentItems.length} of {data.length} {footerLabel}
          </span>
        )}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
        {footerRightContent && (
          <div className="absolute right-6">{footerRightContent}</div>
        )}
      </div>
    </div>
  );
}
