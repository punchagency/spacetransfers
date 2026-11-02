import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Modal } from "../common/Modal";
import { SpaceLoader } from "../common/SpaceLoader";
import { getGoogleDriveAccessToken,
  getSavedDriveToken, listGoogleDriveFolders } from "../../utils/drive";

type DriveFolder = { id: string; name: string };

type DriveSaveModalProps = {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  clientId: string | undefined;
  onConnected: (v: { accessToken: string; folderId: string | null }) => void;
};

export const DriveSaveModal = ({
  isOpen,
  onClose,
  fileName,
  clientId,
  onConnected,
}: DriveSaveModalProps) => {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("root");

  const canUseDrive = Boolean(clientId);

  const title = useMemo(() => {
    return (
      <div>
        <div className="text-lg font-bold text-gray-900 leading-none mt-1">Save to Google Drive</div>
        <div className="text-xs text-gray-500 mt-1">File: {fileName}</div>
      </div>
    );
  }, [fileName]);

  useEffect(() => {
    if (!isOpen) {
      setAccessToken(null);
      setFolders([]);
      setLoading(false);
      setSelectedFolderId("root");
      return;
    }
    if (!canUseDrive) return;
    /*
     * Only a saved connection is used on open. Asking Google here opened its
     * window without a click, which browsers block — and the dialog then spun
     * on "Connecting…" forever. Without one, "Connect Google Drive" asks, from
     * the click, where the window is allowed.
     */
    const saved = getSavedDriveToken();
    if (!saved) return;
    setLoading(true);
    setAccessToken(saved);
    listGoogleDriveFolders(saved)
      .then((f) => setFolders(f))
      .catch(() => setAccessToken(null))
      .finally(() => setLoading(false));
  }, [isOpen, canUseDrive, clientId]);

  const connect = async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const t = await getGoogleDriveAccessToken({ clientId, prompt: "consent" });
      setAccessToken(t);
      const f = await listGoogleDriveFolders(t);
      setFolders(f);
    } catch (e: any) {
      toast.error(e?.message || "Failed to connect Google Drive");
    } finally {
      setLoading(false);
    }
  };

  const confirm = () => {
    if (!accessToken) return;
    onConnected({ accessToken, folderId: selectedFolderId === "root" ? null : selectedFolderId });
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[560px] bg-white" title={title}>
      {!canUseDrive ? (
        <div className="space-y-3">
          <div className="text-sm text-gray-700">
            Google Drive is not configured. Set VITE_GOOGLE_CLIENT_ID for this app.
          </div>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      ) : loading ? (
        <div className="py-10">
          <SpaceLoader label="Connecting to Google Drive…" />
        </div>
      ) : (
        <div className="space-y-5">
          {!accessToken ? (
            <div className="space-y-3">
              <div className="text-sm text-gray-700">
                Connect your Google Drive account to choose a destination folder.
              </div>
              <button
                onClick={() => void connect()}
                className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
              >
                Connect Google Drive
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="text-sm font-semibold text-gray-900">Destination folder</div>
                <select
                  value={selectedFolderId}
                  onChange={(e) => setSelectedFolderId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900"
                >
                  <option value="root">My Drive (root)</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-gray-500">Only folders you have access to are shown.</div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirm}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Continue
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

