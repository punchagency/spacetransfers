import React, { useState } from "react";
import { FiFileText } from "react-icons/fi";
import { FaRegFolderOpen } from "react-icons/fa";
import { FiSearch } from "react-icons/fi";
import { RiDeleteBin5Line } from "react-icons/ri";
import { MdEdit, MdContentCopy } from "react-icons/md";
interface LoadGangSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  designs: Array<{
    id: number;
    title: string;
    time: string;
    size: string;
    thumbnail: string;
  }>;
  onRename?: (id: number, newTitle: string) => void;
  onDuplicate?: (id: number) => void;
  onDelete?: (id: number) => void;
  onLoad?: (id: number) => void;
}

const LoadGangSheetModal: React.FC<LoadGangSheetModalProps> = ({ isOpen, onClose, designs, onRename, onDuplicate, onDelete, onLoad }) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const handleRename = (id: number, currentTitle: string) => {
    setEditingId(id);
    setEditTitle(currentTitle);
  };

  const saveRename = (id: number) => {
    if (onRename && editTitle.trim()) {
      onRename(id, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle("");
  };

  const handleDuplicate = (id: number) => {
    if (onDuplicate) onDuplicate(id);
  };

  const handleDelete = (id: number) => {
    if (onDelete) onDelete(id);
  };

  if (!isOpen) return null;

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-xs">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl mx-4">
        {/* Header */}
        <div className="flex items-center gap-4   px-6 py-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 shadow-md">
            <FaRegFolderOpen className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-[24px] text-gray-900">Gang Sheet Gallery</h2>
            <p className="text-[14px] text-gray-500">
              Browse and manage your saved gang sheets
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="border-b border-[#E2E8F0] px-6 py-4">
          <div className="relative">
            <FiSearch className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search designs..."
              className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-11 pr-4 text-sm text-gray-700 shadow-sm outline-none focus:border-gray-300"
            />
          </div>
        </div>

        {/* Gang Sheet Cards */}
        <div className="p-6 pb-8 flex gap-4 overflow-x-auto min-h-[320px]">
          {designs.length === 0 ? (
            <div className="w-full flex flex-col items-center justify-center text-gray-500">
              <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <FiFileText className="w-12 h-12 text-gray-400" />
              </div>
              <p className="text-lg text-gray-700">No designs found</p>
              <p className="text-sm text-gray-500 mt-1">
                Try adjusting your search or create a new design
              </p>
            </div>
          ) : (
            designs.map((design) => (
              <div
                key={design.id}
                className="w-[260px] flex-shrink-0 overflow-hidden rounded-2xl border-2 border-[#E2E8F0] hover:border-[#155DFC] bg-white shadow-sm cursor-pointer hover:shadow-md transition-all group relative"
                onClick={() => {
                  if (onLoad) {
                    onLoad(design.id);
                    onClose();
                  }
                }}
              >
                <div className="relative h-[200px] bg-[#E9F2F1] overflow-hidden flex items-center justify-center">
                  <img
                    src={design.thumbnail}
                    alt={design.title}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="px-4 py-3 pb-12">
                  {editingId === design.id ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => saveRename(design.id)}
                      onKeyDown={(e) => e.key === 'Enter' && saveRename(design.id)}
                      className="w-full font-medium text-gray-900 border border-blue-500 rounded px-2 py-1 outline-none"
                      autoFocus
                    />
                  ) : (
                    <h3 className="font-medium text-gray-900">{design.title}</h3>
                  )}
                  <div className="mt-1 flex items-center justify-between text-sm text-gray-500">
                    <span>{design.time}</span>
                    <span>{design.size}</span>
                  </div>
                </div>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    className="flex items-center gap-1 text-gray-700 hover:text-gray-900"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRename(design.id, design.title);
                    }}
                  >
                    <MdEdit className="h-4 w-4" />
                    <span className="text-[12px]">Rename</span>
                  </button>
                  <button
                    className="flex items-center gap-1 text-gray-700 hover:text-gray-900"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDuplicate(design.id);
                    }}
                  >
                    <MdContentCopy className="h-4 w-4" />
                    <span className="text-[12px]">Duplicate</span>
                  </button>
                  <button
                    className="hover:text-gray-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(design.id);
                    }}
                  >
                    <RiDeleteBin5Line className="h-4 w-4 text-gray-600" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex bg-[#F8FAFC]  items-center justify-between border-t border-[#E2E8F0] px-6 py-4">
          <p className="text-sm text-gray-500">
            Click on any design to load it
          </p>
          <button
            className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoadGangSheetModal;
