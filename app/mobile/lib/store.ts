import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Device, Session } from "./types";

interface AppState {
  devices: Device[];
  addDevice: (device: Omit<Device, "id">) => void;
  removeDevice: (id: string) => void;
  updateDevice: (id: string, updates: Partial<Omit<Device, "id">>) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      devices: [],
      addDevice: (device) =>
        set((state) => ({
          devices: [
            ...state.devices,
            { ...device, id: Date.now().toString(36) },
          ],
        })),
      removeDevice: (id) =>
        set((state) => ({
          devices: state.devices.filter((d) => d.id !== id),
        })),
      updateDevice: (id, updates) =>
        set((state) => ({
          devices: state.devices.map((d) =>
            d.id === id ? { ...d, ...updates } : d
          ),
        })),
    }),
    {
      name: "wt-companion-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
