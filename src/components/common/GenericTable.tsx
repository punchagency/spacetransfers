import { useMemo, useState, type ReactNode } from "react";
import { Pagination } from "./Pagination";

interface Column<T> {
    header: string;
    key?: keyof T;
    render?: (item: T, index: number) => ReactNode;
    className?: string;
    sortValue?: (item: T) => string | number | null | undefined;
}

interface GenericTableProps<T> {
    data: T[];
    columns: Column<T>[];
    title?: string;
    itemsPerPage?: number;
    showFooterInfo?: boolean;
    footerLabel?: string;
    onRowClick?: (item: T) => void;
    sortable?: boolean;
    defaultSortColumnIndex?: number;
    defaultSortDirection?: "asc" | "desc";
    /**
     * Set when the rows could not be loaded.
     *
     * Without it a failed fetch renders "No data found." — the table asserting
     * there is nothing to show when in truth it does not know. The toast that
     * accompanies the failure fades after a few seconds; the false statement
     * stays on screen. Same failure the approvals queue had, where it showed a
     * green tick and "All caught up!" over a queue it had never managed to read.
     */
    error?: string | null;
}

export function GenericTable<T>({
    data,
    columns,
    title,
    itemsPerPage = 7,
    showFooterInfo = false,
    footerLabel = "items",
    onRowClick,
    sortable = false,
    defaultSortColumnIndex = -1,
    defaultSortDirection = "asc",
    error = null,
}: GenericTableProps<T>) {
    const [currentPage, setCurrentPage] = useState(1);
    const [sortColumnIndex, setSortColumnIndex] = useState(defaultSortColumnIndex);
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">(defaultSortDirection);

    const sortedData = useMemo(() => {
        if (!sortable) return data;
        if (sortColumnIndex < 0 || sortColumnIndex >= columns.length) return data;

        const col = columns[sortColumnIndex];
        const getValue = (item: T) => {
            if (col.sortValue) return col.sortValue(item);
            if (col.key) return item[col.key] as any;
            return null;
        };

        const mapped = data.map((item, idx) => ({
            item,
            idx,
            value: getValue(item),
        }));

        mapped.sort((a, b) => {
            const av = a.value;
            const bv = b.value;
            const dir = sortDirection === "asc" ? 1 : -1;

            if (av == null && bv == null) return a.idx - b.idx;
            if (av == null) return 1;
            if (bv == null) return -1;

            if (typeof av === "number" && typeof bv === "number") {
                return (av - bv) * dir;
            }

            return String(av).localeCompare(String(bv)) * dir;
        });

        return mapped.map((m) => m.item);
    }, [columns, data, sortColumnIndex, sortDirection, sortable]);

    const totalPages = Math.ceil(sortedData.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const currentItems = sortedData.slice(startIndex, startIndex + itemsPerPage);

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
                                <th key={idx} className={`px-6 py-5 ${col.className || ""}`}>
                                    {sortable ? (
                                        <button
                                            type="button"
                                            className="inline-flex items-center gap-2 hover:text-gray-900"
                                            onClick={() => {
                                                setCurrentPage(1);
                                                if (sortColumnIndex !== idx) {
                                                    setSortColumnIndex(idx);
                                                    setSortDirection("asc");
                                                    return;
                                                }
                                                setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
                                            }}
                                        >
                                            <span>{col.header}</span>
                                            {sortColumnIndex === idx ? (
                                                <span className="text-[11px] text-gray-400">
                                                    {sortDirection === "asc" ? "↑" : "↓"}
                                                </span>
                                            ) : null}
                                        </button>
                                    ) : (
                                        col.header
                                    )}
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
                                    className={`text-sm hover:bg-gray-50 transition-colors group ${onRowClick ? "cursor-pointer" : ""
                                        }`}
                                >
                                    {columns.map((col, colIdx) => (
                                        <td key={colIdx} className={`px-6 py-5 ${col.className || ""}`}>
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
                                    className={`px-6 py-10 text-center ${error ? "text-red-600" : "text-gray-500 italic"}`}
                                >
                                    {error
                                        ? `Could not load this table — ${error}`
                                        : "No data found."}
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
            </div>
        </div>
    );
}
