import { User } from "../models/user.model.js";
import { Asset } from "../models/asset.model.js";
import sharp from "sharp";
import { env } from "../config/env.js";

export const updateAccount = async (req, res, next) => {
  try {
    const { name, defaultShippingAddress, companyName, phone } = req.body;
    const userId = req.user.id;

    const updateData = {};
    if (name) updateData.name = name;
    if (companyName) updateData.companyName = companyName;
    if (phone) updateData.phone = phone;
    if (defaultShippingAddress) updateData.defaultShippingAddress = defaultShippingAddress;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-passwordHash");

    if (!updatedUser) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;                                     
    }

    const userResponse = {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role
    };

    if (updatedUser.companyName) userResponse.companyName = updatedUser.companyName;
    if (updatedUser.phone) userResponse.phone = updatedUser.phone;
    if (updatedUser.defaultShippingAddress) userResponse.defaultShippingAddress = updatedUser.defaultShippingAddress;

    res.json({ user: userResponse });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req, res, next) => {
  try {
    // In a stateless JWT system, logout is handled client-side by discarding the token.
    // However, if we were using cookies or a token blacklist, we would handle that here.
    // For now, we'll just return a success response.
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
};

export const createOrder = async (req, res, next) => {
  try {
    res.status(201).json({ message: "Customer create order blueprint" });
  } catch (error) {
    next(error);
  }
};

export const listOrders = async (req, res, next) => {
  try {
    res.json({ message: "Customer list orders blueprint" });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req, res, next) => {
  try {
    res.json({ message: "Customer get order by id blueprint" });
  } catch (error) {
    next(error);
  }
};

export const uploadAsset = async (req, res, next) => {
  try {
    if (!req.file) {
      const error = new Error("No file uploaded");
      error.statusCode = 400;
      throw error;
    }

    // In a real app, we would upload to S3 or similar and get the URL.
    // Here we'll simulate it by using the local path or a dummy URL.
    // Assuming the upload middleware stores the file in 'uploads/' and sets req.file.path
    
    // For this simulation, we'll create a dummy URL based on the filename
    const port = env.port || 4000;
    const fileUrl = `http://localhost:${port}/uploads/${req.file.filename}`;

    // Get image metadata using sharp
    let widthPx, heightPx, dpi;
    try {
      const metadata = await sharp(req.file.path).metadata();
      widthPx = metadata.width;
      heightPx = metadata.height;
      dpi = metadata.density || 72; // Default to 72 if not present
    } catch (err) {
      // Suppress "unsupported image format" errors (e.g. for PSDs) to avoid noise
      if (err.message && err.message.includes('unsupported image format')) {
        console.log(`Metadata extraction skipped for ${req.file.originalname}: Unsupported format`);
      } else {
        console.error("Error reading image metadata:", err);
      }
    }

    const asset = new Asset({
      user: req.user.id,
      url: fileUrl,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      widthPx,
      heightPx,
      dpi
    });

    await asset.save();

    res.status(201).json({
      id: asset.id,
      url: asset.url,
      originalFilename: asset.originalFilename,
      sizeBytes: asset.sizeBytes,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      dpi: asset.dpi
    });
  } catch (error) {
    next(error);
  } 
};

export const listAssets = async (req, res, next) => {
  try {
    const assets = await Asset.find({ user: req.user.id })
      .sort({ _id: -1 });

    const responseItems = assets.map(asset => ({
      id: asset.id,
      url: asset.url,
      originalFilename: asset.originalFilename,
      sizeBytes: asset.sizeBytes,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      dpi: asset.dpi
    }));

    res.json({
      items: responseItems
    });
  } catch (error) {
    next(error);
  }
};

