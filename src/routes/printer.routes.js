import express from "express";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { UserRoles } from "../models/user.model.js";
import { listPrintQueue, updateJobStatus, listPrinterOrders, getPrinterEarnings } from "../controllers/printer.controller.js";

const router = express.Router();

router.use(authenticate, requireRoles(UserRoles.PRINTER));

router.get("/print-queue", listPrintQueue);
router.patch("/print-queue/:jobId/status", updateJobStatus);
router.get("/orders", listPrinterOrders);
router.get("/earnings", getPrinterEarnings);

export default router;

