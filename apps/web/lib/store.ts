import { create } from "zustand";

/**
 * Small client-side UI store. Server state lives in React Query; this only
 * holds ephemeral interface state that several components share.
 */
interface UiState {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
}));
