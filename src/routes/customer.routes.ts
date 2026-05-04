import express from "express";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { UserRoles } from "../models/user.model.js";
import {
  createOrder,
  listOrders,
  getOrderById,
  uploadAsset,
  trimAsset,
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
import {
  createStripePaymentIntent,
  createPaypalOrder,
  capturePaypalOrder
} from "../controllers/payments.controller.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

router.use(authenticate, requireRoles(UserRoles.CUSTOMER));

router.patch("/account", updateAccount);
router.post("/account/logout", logout);
router.post("/orders", createOrder);
router.get("/orders", listOrders);
router.get("/orders/:orderId", getOrderById);
router.get("/orders/:orderId/invoice", downloadInvoice);
router.get("/orders/:orderId/tracking", getOrderTracking);
router.post("/orders/:orderId/reorder", reorder);
router.post("/assets", upload.single("file"), uploadAsset);
router.post("/assets/trim", trimAsset);
router.get("/assets", listAssets);
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
router.post("/payments/paypal/create-order", createPaypalOrder);
router.post("/payments/paypal/capture-order", capturePaypalOrder);

export default router;
