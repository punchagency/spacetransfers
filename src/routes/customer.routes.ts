import express from "express";
import { authenticate, maybeAuthenticate, requireRoles } from "../middleware/auth.js";
import { UserRoles } from "../models/user.model.js";
import {
  createOrder,
  listOrders,
  getOrderById,
  uploadAsset,
  trimAsset,
  materializeAsset,
  upscaleAsset,
  aiEditAsset,
  aiEditCapabilities,
  aiEditPlan,
  fadeCheckAsset,
  updateAccount,
  logout,
  listAssets,
  createDesign,
  listDesigns,
  getDesignById,
  deleteDesign,
  updateDesign,
  duplicateDesign,
  searchDesigns,
  getArtboardDraft,
  upsertArtboardDraft,
  clearArtboardDraft,
  getCart,
  updateCart,
  getCartQuote,
  sendGangsheetUtilizationWarning,
  downloadInvoice,
  reorder,
  getOrderTracking
} from "../controllers/customer.controller.js";
import { createStripePaymentIntent } from "../controllers/payments.controller.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

// Asset upload is available to guests (maybeAuthenticate) so unauthenticated
// users still get server-side DPI/trim metadata and the low-DPI warning fires.
router.post("/assets", maybeAuthenticate, upload.single("file"), uploadAsset);
router.post("/assets/trim", maybeAuthenticate, trimAsset);
// Uploads a canvas-produced image and returns its hosted URL, so artboard items
// and every later request carry a reference instead of the artwork itself.
// This is what keeps the cart/order payloads to metadata only.
router.post("/assets/materialize", maybeAuthenticate, materializeAsset);
// AI fade check for an already-uploaded asset — used after edits that change
// the alpha channel (background removal, generative repaint).
router.post("/assets/fade-check", maybeAuthenticate, fadeCheckAsset);
router.post("/assets/upscale", maybeAuthenticate, upscaleAsset);
router.get("/assets/ai-edit/capabilities", maybeAuthenticate, aiEditCapabilities);
router.post("/assets/ai-edit", maybeAuthenticate, aiEditAsset);
// Prompt understanding — text only, no image work, so it is cheap enough to
// call on every submit to decompose multi-step requests before editing starts.
router.post("/assets/ai-edit/plan", maybeAuthenticate, aiEditPlan);
router.get("/assets", maybeAuthenticate, listAssets);

router.use(authenticate, requireRoles(UserRoles.CUSTOMER));

router.patch("/account", updateAccount);
router.post("/account/logout", logout);
router.post("/orders", createOrder);
router.get("/orders", listOrders);
router.get("/orders/:orderId", getOrderById);
router.get("/orders/:orderId/invoice", downloadInvoice);
router.get("/orders/:orderId/tracking", getOrderTracking);
router.post("/orders/:orderId/reorder", reorder);
router.get("/artboard-draft", getArtboardDraft);
router.put("/artboard-draft", upsertArtboardDraft);
router.delete("/artboard-draft", clearArtboardDraft);
router.get("/cart", getCart);
router.put("/cart", updateCart);
router.post("/designs", createDesign);
router.get("/designs", listDesigns);
router.get("/designs/search", searchDesigns);
router.get("/designs/:designId", getDesignById);
router.patch("/designs/:designId", updateDesign);
router.delete("/designs/:designId", deleteDesign);
router.post("/designs/:designId/duplicate", duplicateDesign);
router.post("/cart/quote", getCartQuote);
router.post("/notifications/gangsheet-utilization-warning", sendGangsheetUtilizationWarning);
router.post("/payments/stripe/create-intent", createStripePaymentIntent);

export default router;
