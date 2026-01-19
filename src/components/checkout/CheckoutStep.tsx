import React from "react";
import { MdLocationOn, MdCheckCircle } from "react-icons/md";
import { BsPerson } from "react-icons/bs";
import { IoLocationOutline } from "react-icons/io5";
import { IoMdCheckmarkCircleOutline } from "react-icons/io";

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface CheckoutStepProps {
  formData: FormData;
  setFormData: (data: FormData) => void;
}

export default function CheckoutStep({ formData, setFormData }: CheckoutStepProps) {
  return (
    <>
      <div className="bg-white rounded-lg border mb-5 border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <BsPerson className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold">Customer Information</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.firstName}
              onChange={(e) =>
                setFormData({ ...formData, firstName: e.target.value })
              }
              className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                formData.firstName ? "bg-[#F3F3F5]" : "bg-white"
              }`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.lastName}
              onChange={(e) =>
                setFormData({ ...formData, lastName: e.target.value })
              }
              className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                formData.lastName ? "bg-[#F3F3F5]" : "bg-white"
              }`}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">
              Email Address <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) =>
                setFormData({ ...formData, email: e.target.value })
              }
              className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                formData.email ? "bg-[#F3F3F5]" : "bg-white"
              }`}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">
              Phone Number <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
              className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                formData.phone ? "bg-[#F3F3F5]" : "bg-white"
              }`}
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border mb-5 border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <IoLocationOutline className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold">Shipping Address</h3>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Street Address <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.street}
              onChange={(e) =>
                setFormData({ ...formData, street: e.target.value })
              }
              className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                formData.street ? "bg-[#F3F3F5]" : "bg-white"
              }`}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">City <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) =>
                  setFormData({ ...formData, city: e.target.value })
                }
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                  formData.city ? "bg-[#F3F3F5]" : "bg-white"
                }`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                State / Province <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.state}
                onChange={(e) =>
                  setFormData({ ...formData, state: e.target.value })
                }
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                  formData.state ? "bg-[#F3F3F5]" : "bg-white"
                }`}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Postal Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.postalCode}
                onChange={(e) =>
                  setFormData({ ...formData, postalCode: e.target.value })
                }
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                  formData.postalCode ? "bg-[#F3F3F5]" : "bg-white"
                }`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Country <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.country}
                onChange={(e) =>
                  setFormData({ ...formData, country: e.target.value })
                }
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${
                  formData.country ? "bg-[#F3F3F5]" : "bg-white"
                }`}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-normal text-[11px]">Design Validation</h3>
          <span className="text-[11px] bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
            Review Warnings
          </span>
        </div>
        <hr className="border-gray-200 mb-4" />
        <div className="space-y-2">
          <h4 className="font-normal text-[11px]">DTF Printing Guidelines</h4>
          <div className="space-y-2.5 text-sm text-gray-700">
            <div className="flex items-center text-[10px] gap-2">
              <IoMdCheckmarkCircleOutline className="w-4 h-4 text-green-600" />
              <span>Minimum resolution: 150 DPI (300 DPI recommended)</span>
            </div>
            <div className="flex items-center text-[10px] gap-2">
              <IoMdCheckmarkCircleOutline className="w-4 h-4 text-green-600" />
              <span>Maximum print area: 12" x 16" for standard transfers</span>
            </div>
            <div className="flex items-center text-[10px] gap-2">
              <IoMdCheckmarkCircleOutline className="w-4 h-4 text-green-600" />
              <span>
                Supported formats: PNG, PSD, AI, PDF with transparency
              </span>
            </div>
            <div className="flex items-center text-[10px] gap-2">
              <IoMdCheckmarkCircleOutline className="w-4 h-4 text-green-600" />
              <span>Color mode: CMYK preferred, RGB will be converted</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
