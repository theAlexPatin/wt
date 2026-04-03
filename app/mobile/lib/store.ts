import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Device } from "./types";

interface AppState {
  devices: Device[];
  pushToken: string | null;
  recentSkills: string[];
  addDevice: (device: Omit<Device, "id">) => void;
  removeDevice: (id: string) => void;
  setPushToken: (token: string) => void;
  addRecentSkill: (name: string) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      devices: [],
      pushToken: null,
      recentSkills: [],
      addDevice: (device) =>
        set((state) => {
          const existing = state.devices.find((d) => d.host === device.host);
          if (existing) {
            // Update name/port if re-scanned
            return {
              devices: state.devices.map((d) =>
                d.host === device.host ? { ...d, ...device } : d
              ),
            };
          }
          return {
            devices: [
              ...state.devices,
              { ...device, id: Date.now().toString(36) },
            ],
          };
        }),
      removeDevice: (id) =>
        set((state) => ({
          devices: state.devices.filter((d) => d.id !== id),
        })),
      setPushToken: (token) => set({ pushToken: token }),
      addRecentSkill: (name) =>
        set((state) => ({
          recentSkills: [name, ...state.recentSkills.filter((s) => s !== name)].slice(0, 4),
        })),
    }),
    {
      name: "wt-companion-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
