import { createContext, useContext, useState, ReactNode } from "react";
import { getUser, updateStoredUser } from "../utils/auth";

/*
 * Two states. "Stopped" existed alongside "Paused" and did exactly the same
 * thing — the assignment gate only asks whether the value is "open" — so it was
 * a choice that changed nothing.
 */
export type AvailabilityStatus = "open" | "paused";

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
  const user = getUser();

  const [name, setNameState] = useState<string>(user?.name || "");
  const [avatarUrl, setAvatarUrlState] = useState<string | null>(resolveAvatarUrl(user?.avatarUrl as string | undefined));
  const [availabilityStatus, setAvailabilityStatusState] = useState<AvailabilityStatus>(
    (user?.availabilityStatus as AvailabilityStatus) || "open"
  );

  const setName = (newName: string) => {
    setNameState(newName);
    updateStoredUser({ name: newName });
  };

  const setAvatarUrl = (url: string) => {
    setAvatarUrlState(url);
    updateStoredUser({ avatarUrl: url });
  };

  const setAvailabilityStatus = (s: AvailabilityStatus) => {
    setAvailabilityStatusState(s);
    updateStoredUser({ availabilityStatus: s });
  };

  return (
    <ProfileContext.Provider value={{ name, setName, avatarUrl, setAvatarUrl, availabilityStatus, setAvailabilityStatus }}>
      {children}
    </ProfileContext.Provider>
  );
};
