import express from "express";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { UserRoles } from "../models/user.model.js";
import { 
  createOrder, 
  listOrders, 
  getOrderById, 
  uploadAsset, 
  updateAccount, 
  logout, 
  listAssets, 
  createDesign, 
  listDesigns, 
  getDesignById, 
  deleteDesign, 
  updateDesign, 
  duplicateDesign, 
  getCartQuote, 
  downloadInvoice, 
  reorder, 
  getOrderTracking 
} from "../controllers/customer.controller.js";
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
router.get("/assets", listAssets);
router.post("/designs", createDesign);
router.get("/designs", listDesigns);
router.get("/designs/:designId", getDesignById);
router.patch("/designs/:designId", updateDesign);
router.delete("/designs/:designId", deleteDesign);
router.post("/designs/:designId/duplicate", duplicateDesign);
router.post("/cart/quote", getCartQuote);

export default router;
