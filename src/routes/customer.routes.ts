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
  listAssets,
  createDesign,
  listDesigns,
  getDesignById,
  deleteDesign,
  updateDesign,
  duplicateDesign,
  searchDesigns,
  getCart,
  updateCart,
  getCartQuote,
  getPricingConfig,
  sendGangsheetUtilizationWarning,
  downloadInvoice
} from "../controllers/customer/index.js";
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
// Public pricing rates — the cart is usable before sign-in and must show a
// total that matches what checkout will charge.
router.get("/pricing", maybeAuthenticate, getPricingConfig);

router.use(authenticate, requireRoles(UserRoles.CUSTOMER));

router.post("/orders", createOrder);
router.get("/orders", listOrders);
router.get("/orders/:orderId", getOrderById);
router.get("/orders/:orderId/invoice", downloadInvoice);
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
