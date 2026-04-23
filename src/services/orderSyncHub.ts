import type { Response } from "express";

type Client = {
  res: Response;
};

const clientsByOrderId = new Map<string, Set<Client>>();

export const addOrderClient = (orderId: string, res: Response) => {
  const set = clientsByOrderId.get(orderId) ?? new Set<Client>();
  set.add({ res });
  clientsByOrderId.set(orderId, set);
};

export const removeOrderClient = (orderId: string, res: Response) => {
  const set = clientsByOrderId.get(orderId);
  if (!set) return;
  for (const c of set) {
    if (c.res === res) {
      set.delete(c);
      break;
    }
  }
  if (set.size === 0) clientsByOrderId.delete(orderId);
};

export const publishOrderEvent = (orderId: string, event: string, data: any) => {
  const set = clientsByOrderId.get(orderId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of set) {
    try {
      c.res.write(payload);
    } catch {
      set.delete(c);
    }
  }
  if (set.size === 0) clientsByOrderId.delete(orderId);
};

