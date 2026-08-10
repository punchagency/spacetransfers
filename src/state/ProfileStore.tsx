import { createContext, useContext, useState, ReactNode } from "react";

export type AvailabilityStatus = "open" | "paused" | "stopped";

interface ProfileContextValue {
  name: string;
  setName: (name: string) => void;
  avatarUrl: string | null;
  setAvatarUrl: (url: string) => void;
  availabilityStatus: AvailabilityStatus;
  setAvailabilityStatus: (s: AvailabilityStatus) => void;
}

const ProfileContext = createContext<ProfileContextValue>({
  name: "",
  setName: () => {},
  avatarUrl: null,
  setAvatarUrl: () => {},
  availabilityStatus: "open",
  setAvailabilityStatus: () => {},
});

const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:4000/api").replace("/api", "");

const resolveAvatarUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  return url.startsWith("http") ? url : `${API_BASE}${url}`;
};

export const useProfileStore = () => useContext(ProfileContext);

export const ProfileStoreProvider = ({ children }: { children: ReactNode }) => {
  const userStr = localStorage.getItem("printer_user");
  const user = userStr ? JSON.parse(userStr) : null;

  const [name, setNameState] = useState<string>(user?.name || "");
  const [avatarUrl, setAvatarUrlState] = useState<string | null>(resolveAvatarUrl(user?.avatarUrl));
  const [availabilityStatus, setAvailabilityStatusState] = useState<AvailabilityStatus>(
    (user?.availabilityStatus as AvailabilityStatus) || "open"
  );

  const setName = (newName: string) => {
    setNameState(newName);
    const stored = localStorage.getItem("printer_user");
    if (stored) {
      const parsed = JSON.parse(stored);
      parsed.name = newName;
      localStorage.setItem("printer_user", JSON.stringify(parsed));
    }
  };

  const setAvatarUrl = (url: string) => {
    setAvatarUrlState(url);
    const stored = localStorage.getItem("printer_user");
    if (stored) {
      const parsed = JSON.parse(stored);
      parsed.avatarUrl = url;
      localStorage.setItem("printer_user", JSON.stringify(parsed));
    }
  };

  const setAvailabilityStatus = (s: AvailabilityStatus) => {
    setAvailabilityStatusState(s);
    const stored = localStorage.getItem("printer_user");
    if (stored) {
      const parsed = JSON.parse(stored);
      parsed.availabilityStatus = s;
      localStorage.setItem("printer_user", JSON.stringify(parsed));
    }
  };

  return (
    <ProfileContext.Provider value={{ name, setName, avatarUrl, setAvatarUrl, availabilityStatus, setAvailabilityStatus }}>
      {children}
    </ProfileContext.Provider>
  );
};
