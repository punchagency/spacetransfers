import { createContext, useContext, useState, ReactNode } from "react";

interface ProfileContextValue {
  name: string;
  setName: (name: string) => void;
  avatarUrl: string | null;
  setAvatarUrl: (url: string) => void;
}

const ProfileContext = createContext<ProfileContextValue>({
  name: "",
  setName: () => {},
  avatarUrl: null,
  setAvatarUrl: () => {},
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

  return (
    <ProfileContext.Provider value={{ name, setName, avatarUrl, setAvatarUrl }}>
      {children}
    </ProfileContext.Provider>
  );
};
