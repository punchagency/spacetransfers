import { Settings } from "../models/settings.model.js";

/** The next order number, "DTF-0277". One counter for every way an order is made. */
export const nextOrderDisplayId = async (): Promise<string> => {
  const counter = await Settings.findOneAndUpdate(
    { key: "order_display_counter" },
    { $inc: { "value.next": 1 } },
    { new: true, upsert: true, runValidators: true },
  ).lean();
  const seq = Number((counter as any)?.value?.next || 1) - 1;
  return `DTF-${String(seq).padStart(4, "0")}`;
};
