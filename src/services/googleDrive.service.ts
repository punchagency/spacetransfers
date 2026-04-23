import fs from "fs";
import { google } from "googleapis";
import { env } from "../config/env.js";

const hasDriveConfig = () =>
  Boolean(env.googleDriveClientEmail) &&
  Boolean(env.googleDrivePrivateKey) &&
  Boolean(env.googleDriveFolderId);

const getJwtClient = () => {
  const pk = String(env.googleDrivePrivateKey || "").replace(/\\n/g, "\n");
  return new google.auth.JWT({
    email: env.googleDriveClientEmail,
    key: pk,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
};

export const uploadPngToDrive = async ({
  localFilePath,
  fileName,
}: {
  localFilePath: string;
  fileName: string;
}): Promise<{ uploaded: boolean; fileId: string | null; webViewLink: string | null; error: string | null }> => {
  if (!hasDriveConfig()) {
    return { uploaded: false, fileId: null, webViewLink: null, error: "drive_not_configured" };
  }
  if (!fs.existsSync(localFilePath)) {
    return { uploaded: false, fileId: null, webViewLink: null, error: "file_missing" };
  }

  try {
    const auth = getJwtClient();
    const drive = google.drive({ version: "v3", auth });

    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [String(env.googleDriveFolderId)],
        mimeType: "image/png",
      },
      media: {
        mimeType: "image/png",
        body: fs.createReadStream(localFilePath),
      },
      fields: "id, webViewLink",
    });

    return {
      uploaded: true,
      fileId: res.data.id ? String(res.data.id) : null,
      webViewLink: res.data.webViewLink ? String(res.data.webViewLink) : null,
      error: null,
    };
  } catch (e: any) {
    return {
      uploaded: false,
      fileId: null,
      webViewLink: null,
      error: e?.message ? String(e.message) : "drive_upload_failed",
    };
  }
};

