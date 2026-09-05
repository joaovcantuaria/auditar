import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UiState {
  /** Sidebar recolhida (apenas ícones) no desktop. */
  sidebarCollapsed: boolean;
  /** Sidebar aberta como overlay em telas estreitas (mobile/tablet). */
  mobileSidebarOpen: boolean;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
}

/**
 * Estado de UI do shell (colapso da sidebar). O colapso do desktop é
 * persistido; o overlay mobile é sempre efêmero.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileSidebarOpen: false,

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      openMobileSidebar: () => set({ mobileSidebarOpen: true }),
      closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
    }),
    {
      name: 'auditar-ui',
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);
