import type { Response } from "express";

type Client = { res: Response };

const clientsByPrinterId = new Map<string, Set<Client>>();

export const addPrinterNotificationClient = (printerId: string, res: Response) => {
  const set = clientsByPrinterId.get(printerId) ?? new Set<Client>();
  set.add({ res });
  clientsByPrinterId.set(printerId, set);
};

export const removePrinterNotificationClient = (printerId: string, res: Response) => {
  const set = clientsByPrinterId.get(printerId);
  if (!set) return;
  for (const c of set) {
    if (c.res === res) { set.delete(c); break; }
  }
  if (set.size === 0) clientsByPrinterId.delete(printerId);
};

export const publishPrinterNotificationEvent = (printerId: string, event: string, data: any) => {
  const set = clientsByPrinterId.get(printerId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of set) {
    try {
      c.res.write(payload);
    } catch {
      set.delete(c);
    }
  }
  if (set.size === 0) clientsByPrinterId.delete(printerId);
};
