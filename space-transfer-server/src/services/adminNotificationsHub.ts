import type { Response } from "express";

type Client = {
  res: Response;
};

const clientsByAdminId = new Map<string, Set<Client>>();

export const addAdminNotificationClient = (adminId: string, res: Response) => {
  const set = clientsByAdminId.get(adminId) ?? new Set<Client>();
  set.add({ res });
  clientsByAdminId.set(adminId, set);
};

export const removeAdminNotificationClient = (adminId: string, res: Response) => {
  const set = clientsByAdminId.get(adminId);
  if (!set) return;
  for (const c of set) {
    if (c.res === res) {
      set.delete(c);
      break;
    }
  }
  if (set.size === 0) clientsByAdminId.delete(adminId);
};

export const publishAdminNotificationEvent = (adminId: string, event: string, data: any) => {
  const set = clientsByAdminId.get(adminId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of set) {
    try {
      c.res.write(payload);
    } catch {
      set.delete(c);
    }
  }
  if (set.size === 0) clientsByAdminId.delete(adminId);
};

export const broadcastToAllAdmins = (event: string, data: any) => {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [adminId, set] of clientsByAdminId) {
    for (const c of set) {
      try {
        c.res.write(payload);
      } catch {
        set.delete(c);
      }
    }
    if (set.size === 0) clientsByAdminId.delete(adminId);
  }
};

