import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
});

export type CloudinaryUploadResult = { url: string; publicId: string };

export const uploadBufferToCloudinary = (
  buffer: Buffer,
  folder = "space-transfers/assets",
): Promise<CloudinaryUploadResult> =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        overwrite: false,
        // Prevent Cloudinary from applying any incoming format or quality
        // transformation on upload so the stored file is always the original
        // bytes. "preserve_transparency" keeps the alpha channel on PNG assets.
        flags: "preserve_transparency",
      },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error("Cloudinary upload failed"));
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });

// Inserts Cloudinary transformation into the URL to generate a 200px thumbnail.
export const cloudinaryThumbUrl = (url: string): string =>
  url.replace("/upload/", "/upload/w_200,h_200,c_limit,f_webp/");

export const isCloudinaryUrl = (url: string): boolean =>
  url.includes("res.cloudinary.com");

export { cloudinary };
