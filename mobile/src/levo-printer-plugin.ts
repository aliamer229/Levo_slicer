import { Capacitor, registerPlugin } from "@capacitor/core";
import type { LevoPrinterPlugin } from "../../app/native-printer-bridge";

export const LevoPrinter = registerPlugin<LevoPrinterPlugin>("LevoPrinter");

export function exposeLevoNativeRuntime() {
  const existing = window.Capacitor ?? {};
  window.Capacitor = {
    ...existing,
    getPlatform: () => Capacitor.getPlatform(),
    isNativePlatform: () => Capacitor.isNativePlatform(),
    Plugins: { ...(existing.Plugins ?? {}), LevoPrinter },
  };
}
