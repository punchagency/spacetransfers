import { useEffect, useMemo, useState } from "react";
import {
  FiAward,
  FiBriefcase,
  FiCheck,
  FiDownload,
  FiEdit2,
  FiExternalLink,
  FiFileText,
  FiGlobe,
  FiHash,
  FiPlus,
  FiTrash2,
  FiUpload,
  FiX,
} from "react-icons/fi";
import { PrinterProfile } from "../../types/profile";
import { apiFetch, getApiBaseUrl } from "../../utils/api";
import { toast } from "react-hot-toast";
import { Modal } from "../common/Modal";

const resolveDocUrl = (url: string): string => {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  const serverOrigin = getApiBaseUrl().replace(/\/api$/, "");
  return `${serverOrigin}${url.startsWith("/") ? "" : "/"}${url}`;
};

interface ProfileBusinessInfoProps {
  profile: PrinterProfile;
  onUpdate: () => void;
}

type Certification = PrinterProfile["certifications"][number];

const BUSINESS_TYPES = [
  "Sole Proprietorship",
  "Partnership",
  "Corporation",
  "LLC",
];

const URL_RE = /^https?:\/\/[^\s]+\.[^\s]+$/i;
const todayISO = () => new Date().toISOString().split("T")[0];

const buildFormFromProfile = (profile: PrinterProfile) => ({
  businessName: profile.businessName || "",
  website: profile.website && profile.website !== "N/A" ? profile.website : "",
  businessDetails: {
    businessType: profile.businessDetails?.businessType || "",
    registrationNumber: profile.businessDetails?.registrationNumber || "",
  },
  certifications: (profile.certifications || []).map((c) => ({
    name: c.name || "",
    authority: c.authority || "",
    date: c.date ? new Date(c.date).toISOString().split("T")[0] : todayISO(),
    expiryDate: c.expiryDate ? new Date(c.expiryDate).toISOString().split("T")[0] : "",
    documentUrl: c.documentUrl || "",
  })),
});

export const ProfileBusinessInfo = ({ profile, onUpdate }: ProfileBusinessInfoProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState(() => buildFormFromProfile(profile));
  const [docPreviewUrl, setDocPreviewUrl] = useState<string | null>(null);
  const [errors, setErrors] = useState<{
    businessName?: string;
    website?: string;
    certs: Record<number, { name?: string; authority?: string; date?: string }>;
  }>({ certs: {} });

  useEffect(() => {
    if (!isEditing) setFormData(buildFormFromProfile(profile));
  }, [profile, isEditing]);

  const validate = () => {
    const next: typeof errors = { certs: {} };
    if (!formData.businessName.trim()) next.businessName = "Business name is required";
    if (formData.website && !URL_RE.test(formData.website.trim())) {
      next.website = "Enter a valid URL (https://example.com)";
    }
    formData.certifications.forEach((c, i) => {
      const ce: { name?: string; authority?: string; date?: string } = {};
      if (!c.name.trim()) ce.name = "Required";
      if (!c.authority.trim()) ce.authority = "Required";
      if (!c.date) ce.date = "Required";
      if (Object.keys(ce).length > 0) next.certs[i] = ce;
    });
    setErrors(next);
    return !next.businessName && !next.website && Object.keys(next.certs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      toast.error("Fix the highlighted fields before saving");
      return;
    }
    try {
      setLoading(true);
      await apiFetch("/printer/profile", {
        method: "PATCH",
        body: JSON.stringify({
          businessName: formData.businessName.trim(),
          website: formData.website.trim(),
          businessDetails: formData.businessDetails,
          certifications: formData.certifications,
        }),
      });
      toast.success("Business information updated");
      setIsEditing(false);
      onUpdate();
    } catch (error: any) {
      toast.error(error.message || "Failed to update information");
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setFormData(buildFormFromProfile(profile));
    setErrors({ certs: {} });
    setIsEditing(false);
  };

  const handleAddCertification = () => {
    setFormData((f) => ({
      ...f,
      certifications: [
        ...f.certifications,
        { name: "", authority: "", date: todayISO(), expiryDate: "", documentUrl: "" },
      ],
    }));
  };

  const handleRemoveCertification = (index: number) => {
    setFormData((f) => ({
      ...f,
      certifications: f.certifications.filter((_, i) => i !== index),
    }));
    setErrors((e) => {
      const next = { ...e.certs };
      delete next[index];
      return { ...e, certs: next };
    });
  };

  const handleCertChange = (index: number, field: keyof Certification, value: string) => {
    setFormData((f) => {
      const certs = [...f.certifications];
      certs[index] = { ...certs[index], [field]: value };
      return { ...f, certifications: certs };
    });
  };

  const handleFileUpload = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const uploadData = new FormData();
    uploadData.append("file", file);
    uploadData.append("type", "certification");

    try {
      toast.loading("Uploading document...", { id: "upload" });
      const result = await apiFetch("/printer/profile/upload", {
        method: "POST",
        body: uploadData,
      });
      handleCertChange(index, "documentUrl", result.url);
      toast.success("Document uploaded", { id: "upload" });
    } catch (error: any) {
      toast.error(error.message || "Upload failed", { id: "upload" });
    }
  };

  const certificationsView = useMemo(
    () => (isEditing ? formData.certifications : profile.certifications || []),
    [isEditing, formData.certifications, profile.certifications],
  );

  return (
    <div className="space-y-6">
      {/* Business Details */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Business Details</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Manage your business identity shown to customers and admins.
            </p>
          </div>
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <FiEdit2 className="w-4 h-4" /> Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={handleCancel}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
              >
                <FiX className="w-4 h-4" /> Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
              >
                <FiCheck className="w-4 h-4" /> {loading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          )}
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
          <Field
            label="Business Name"
            icon={<FiBriefcase className="w-4 h-4" />}
            required
            editing={isEditing}
            error={errors.businessName}
            displayValue={profile.businessName}
            input={
              <input
                type="text"
                value={formData.businessName}
                onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                placeholder="e.g. Punch Print Co."
                className={inputClass(Boolean(errors.businessName))}
              />
            }
          />

          <Field
            label="Website"
            icon={<FiGlobe className="w-4 h-4" />}
            editing={isEditing}
            error={errors.website}
            displayValue={
              profile.website && profile.website !== "N/A" ? (
                <a
                  href={profile.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline truncate inline-block max-w-full"
                >
                  {profile.website}
                </a>
              ) : (
                <span className="text-gray-400">Not provided</span>
              )
            }
            input={
              <input
                type="url"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                placeholder="https://yourcompany.com"
                className={inputClass(Boolean(errors.website))}
              />
            }
          />

          <Field
            label="Business Type"
            icon={<FiBriefcase className="w-4 h-4" />}
            editing={isEditing}
            displayValue={profile.businessDetails?.businessType || (
              <span className="text-gray-400">Not provided</span>
            )}
            input={
              <select
                value={formData.businessDetails.businessType}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    businessDetails: { ...formData.businessDetails, businessType: e.target.value },
                  })
                }
                className={inputClass(false)}
              >
                <option value="">Select type</option>
                {BUSINESS_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            }
          />

          <Field
            label="Registration Number"
            icon={<FiHash className="w-4 h-4" />}
            editing={isEditing}
            displayValue={profile.businessDetails?.registrationNumber || (
              <span className="text-gray-400">Not provided</span>
            )}
            input={
              <input
                type="text"
                value={formData.businessDetails.registrationNumber}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    businessDetails: {
                      ...formData.businessDetails,
                      registrationNumber: e.target.value,
                    },
                  })
                }
                placeholder="e.g. RC-1234567"
                className={inputClass(false)}
              />
            }
          />
        </div>
      </div>

      {/* Certifications */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FiAward className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-base font-semibold text-gray-900">
                Certifications & Accreditations
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Showcase your industry credentials and certifications.
              </p>
            </div>
          </div>
          {isEditing && (
            <button
              onClick={handleAddCertification}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              <FiPlus className="w-4 h-4" /> Add Certification
            </button>
          )}
        </div>

        <div className="p-6 space-y-4">
          {certificationsView.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-10 bg-gray-50 rounded-xl border border-dashed border-gray-200">
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-3">
                <FiAward className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium text-gray-900">No certifications added</p>
              <p className="text-xs text-gray-500 mt-1 max-w-xs">
                Add industry certifications to build trust with customers.
              </p>
              {isEditing && (
                <button
                  onClick={handleAddCertification}
                  className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                >
                  <FiPlus className="w-4 h-4" /> Add your first certification
                </button>
              )}
            </div>
          ) : (
            certificationsView.map((cert, index) =>
              isEditing ? (
                <CertificationEditCard
                  key={index}
                  index={index}
                  cert={formData.certifications[index]}
                  errors={errors.certs[index] || {}}
                  onChange={(field, value) => handleCertChange(index, field, value)}
                  onRemove={() => handleRemoveCertification(index)}
                  onUpload={(e) => handleFileUpload(index, e)}
                  onViewDocument={setDocPreviewUrl}
                />
              ) : (
                <CertificationDisplayCard key={index} cert={cert} onViewDocument={setDocPreviewUrl} />
              ),
            )
          )}
        </div>
      </div>

      {/* Document Preview Modal */}
      <DocumentPreviewModal url={docPreviewUrl} onClose={() => setDocPreviewUrl(null)} />
    </div>
  );
};

// ── helpers ──────────────────────────────────────────────────────────────────

const inputClass = (hasError: boolean) =>
  `mt-1 block w-full rounded-lg border px-3 py-2 text-sm transition-shadow focus:outline-none focus:ring-2 ${
    hasError
      ? "border-red-300 focus:border-red-500 focus:ring-red-100"
      : "border-gray-300 focus:border-blue-500 focus:ring-blue-100"
  }`;

interface FieldProps {
  label: string;
  icon?: React.ReactNode;
  required?: boolean;
  editing: boolean;
  error?: string;
  displayValue: React.ReactNode;
  input: React.ReactNode;
}

const Field = ({ label, icon, required, editing, error, displayValue, input }: FieldProps) => (
  <div>
    <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
      {label}
      {required && <span className="text-red-500 normal-case">*</span>}
    </label>
    {editing ? (
      <>
        {input}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </>
    ) : (
      <div className="mt-1 flex items-center gap-2 text-sm font-medium text-gray-900">
        {icon && <span className="text-gray-400">{icon}</span>}
        <span className="truncate">{displayValue}</span>
      </div>
    )}
  </div>
);

interface CertificationDisplayProps {
  cert: Certification;
  onViewDocument: (url: string) => void;
}

const CertificationDisplayCard = ({ cert, onViewDocument }: CertificationDisplayProps) => (
  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl border border-gray-100 bg-gray-50/50">
    <div className="flex items-center gap-4 flex-1 min-w-0">
      <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
        <FiFileText size={22} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">{cert.name}</div>
        <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2">
          <span>Issued by {cert.authority}</span>
          <span className="text-gray-300">·</span>
          <span>{new Date(cert.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
          {cert.expiryDate && (
            <>
              <span className="text-gray-300">·</span>
              <span>Expires {new Date(cert.expiryDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
            </>
          )}
        </div>
      </div>
    </div>
    {cert.documentUrl && (
      <button
        onClick={() => onViewDocument(cert.documentUrl!)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
      >
        <FiFileText className="w-3.5 h-3.5" /> View Documents
      </button>
    )}
  </div>
);

interface CertificationEditCardProps {
  index: number;
  cert: { name: string; authority: string; date: string; expiryDate: string; documentUrl: string };
  errors: { name?: string; authority?: string; date?: string };
  onChange: (field: keyof Certification, value: string) => void;
  onRemove: () => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onViewDocument: (url: string) => void;
}

const CertificationEditCard = ({
  index,
  cert,
  errors,
  onChange,
  onRemove,
  onUpload,
  onViewDocument,
}: CertificationEditCardProps) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4">
    <div className="flex items-center justify-between mb-3">
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
        Certification #{index + 1}
      </span>
      <button
        onClick={onRemove}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
        title="Remove certification"
      >
        <FiTrash2 className="w-3.5 h-3.5" /> Remove
      </button>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Name <span className="text-red-500 normal-case">*</span>
        </label>
        <input
          type="text"
          placeholder="e.g. ISO 9001 Certified"
          value={cert.name}
          onChange={(e) => onChange("name", e.target.value)}
          className={inputClass(Boolean(errors.name))}
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Issuing Authority <span className="text-red-500 normal-case">*</span>
        </label>
        <input
          type="text"
          placeholder="e.g. International Organization for Standardization"
          value={cert.authority}
          onChange={(e) => onChange("authority", e.target.value)}
          className={inputClass(Boolean(errors.authority))}
        />
        {errors.authority && <p className="mt-1 text-xs text-red-600">{errors.authority}</p>}
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Issue Date <span className="text-red-500 normal-case">*</span>
        </label>
        <input
          type="date"
          value={cert.date}
          onChange={(e) => onChange("date", e.target.value)}
          className={inputClass(Boolean(errors.date))}
        />
        {errors.date && <p className="mt-1 text-xs text-red-600">{errors.date}</p>}
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Expiry Date <span className="text-gray-400 normal-case font-normal">(optional)</span>
        </label>
        <input
          type="date"
          value={cert.expiryDate}
          onChange={(e) => onChange("expiryDate", e.target.value)}
          className={inputClass(false)}
        />
      </div>
    </div>
    <div className="mt-4 flex items-center justify-between gap-3 pt-3 border-t border-gray-100">
      <div className="text-xs text-gray-500">
        {cert.documentUrl ? (
          <button
            type="button"
            onClick={() => onViewDocument(cert.documentUrl)}
            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700"
          >
            <FiFileText className="w-3.5 h-3.5" /> View attached document
          </button>
        ) : (
          <span className="text-gray-400">No document attached</span>
        )}
      </div>
      <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer">
        <FiUpload className="w-3.5 h-3.5" />
        {cert.documentUrl ? "Replace" : "Upload"} Document
        <input type="file" className="hidden" onChange={onUpload} accept=".pdf,.png,.jpg,.jpeg" />
      </label>
    </div>
  </div>
);

// ── Document Preview Modal ────────────────────────────────────────────────────

interface DocumentPreviewModalProps {
  url: string | null;
  onClose: () => void;
}

const DocumentPreviewModal = ({ url, onClose }: DocumentPreviewModalProps) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(false);

  const absoluteUrl = url ? resolveDocUrl(url) : null;
  const isPdf = url ? /\.pdf(\?|$)/i.test(url) : false;
  const isImage = url ? /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url) : false;

  useEffect(() => {
    if (!absoluteUrl) return;
    setBlobUrl(null);
    setLoadError(false);
    setLoading(true);

    fetch(absoluteUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        setBlobUrl(URL.createObjectURL(blob));
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));

    return () => {
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [absoluteUrl]);

  if (!url || !absoluteUrl) return null;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      className="max-w-3xl"
      title={
        <div className="flex items-center gap-2">
          <FiFileText className="w-4 h-4 text-blue-600" />
          <span className="text-base font-semibold text-gray-900">Document Preview</span>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2">
          <button
            disabled={!blobUrl}
            onClick={() => {
              if (!blobUrl) return;
              const filename = absoluteUrl.split("/").pop() || "document";
              const a = document.createElement("a");
              a.href = blobUrl;
              a.download = filename;
              a.click();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FiDownload className="w-3.5 h-3.5" /> Download
          </button>
          <a
            href={absoluteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FiExternalLink className="w-3.5 h-3.5" /> Open in tab
          </a>
        </div>

        {/* Preview area */}
        <div className="rounded-xl overflow-hidden bg-gray-50 border border-gray-100 flex items-center justify-center" style={{ height: "60vh" }}>
          {loading && (
            <div className="flex flex-col items-center gap-3 text-gray-400">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              <span className="text-xs">Loading document…</span>
            </div>
          )}

          {!loading && loadError && (
            <div className="flex flex-col items-center gap-4 text-center px-6">
              <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
                <FiFileText className="w-8 h-8 text-red-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Could not load document</p>
                <p className="text-xs text-gray-500 mt-1">Try downloading or opening it in a new tab.</p>
              </div>
            </div>
          )}

          {!loading && !loadError && blobUrl && isPdf && (
            <iframe
              src={blobUrl}
              className="w-full h-full border-0"
              title="Document preview"
            />
          )}

          {!loading && !loadError && blobUrl && isImage && (
            <div className="w-full h-full flex items-center justify-center p-6">
              <img
                src={blobUrl}
                alt="Document"
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}

          {!loading && !loadError && blobUrl && !isPdf && !isImage && (
            <div className="flex flex-col items-center gap-4 text-center px-6">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center">
                <FiFileText className="w-8 h-8 text-blue-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Preview not available for this file type</p>
                <p className="text-xs text-gray-500 mt-1">Use Download or Open in tab to view it.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
