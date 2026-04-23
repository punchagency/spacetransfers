import { FiArrowLeft, FiEdit3 } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import type { PartnerHeaderProps } from '../../types/partners';

export const PartnerHeader = ({ name, email, status, onEdit }: PartnerHeaderProps) => {
    const navigate = useNavigate();

    return (
        <div className="space-y-6">
            {/* Sticky Header */}
            <div className="flex flex-col gap-4 sticky top-0 bg-gray-50 z-20 -mt-6 -mx-6 px-6 pt-6 pb-4">
                <button
                    onClick={() => navigate('/fulfilment-partners')}
                    className="flex items-center gap-2 text-black hover:text-gray-900 w-fit"
                >
                    <FiArrowLeft />
                    <span className="font-medium text-[20px]">Fulfilment Partners Details</span>
                </button>
            </div>

            {/* Top Summary Card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 flex justify-between items-center">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <h1 className="text-[16px] font-semibold text-gray-900">
                            Fulfillment Partner: <span className="font-bold">{name}</span>
                        </h1>
                        <div className={`w-2.5 h-2.5 rounded-full ${status === 'Active' ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                    </div>
                    <p className="text-gray-500 text-[16px]">{email}</p>
                </div>
                <button
                    onClick={onEdit}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
                >
                    <FiEdit3 className="w-4 h-4" />
                    <span>Edit Partner</span>
                </button>
            </div>
        </div>
    );
};
