"use client";

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SlicerSettings } from "three-slicer";
import type { SettingsPanelProps } from "three-slicer/components";
import type { ViewportEvent, ViewportProps } from "three-slicer/viewer";

type Locale = "ar" | "en";
type Sheet = "setup" | "about" | null;
type ProfileId = "bbl-x2d-04" | "bbl-h2d-04";
type QualityId = "fine" | "standard" | "draft";
type StrengthId = "light" | "standard" | "strong";
type EditorStatus = "loading" | "editing" | "slicing" | "ready" | "error";
type CanvasMode = "prepare" | "preview";

interface PrinterProfile {
  id: ProfileId;
  shortName: string;
  model: string;
  presetName: string;
  settingId: string;
  nozzle: number;
  bed: string;
  materialPreset: string;
  processPresets: Record<QualityId, string>;
}

interface EditorObject {
  id: number;
  name: string;
  extruder: number;
  visible: boolean;
}

interface SliceStats {
  layers?: number;
  filament_mm?: number;
  time_estimate?: number;
  path_segments?: number;
  over_bed?: boolean;
  over_bed_model?: boolean;
  [key: string]: unknown;
}

interface SlicePayload {
  plate: number;
  stats: SliceStats;
  gcode: string;
}

interface LoadedProfile {
  settings: SlicerSettings;
  machine: SlicerSettings;
  machineKeys: string[];
}

const GCODE_ARTIFACTS = new Map<symbol, Map<number, string>>();

const PROFILES: Record<ProfileId, PrinterProfile> = {
  "bbl-x2d-04": {
    id: "bbl-x2d-04",
    shortName: "X2D",
    model: "Bambu Lab X2D",
    presetName: "Bambu Lab X2D 0.4 nozzle",
    settingId: "GM045",
    nozzle: 0.4,
    bed: "256 × 256 × 260 mm",
    materialPreset: "Bambu PLA Basic @BBL X2D 0.4 nozzle",
    processPresets: {
      fine: "0.12mm High Quality @BBL X2D",
      standard: "0.20mm Standard @BBL X2D",
      draft: "0.24mm Standard @BBL X2D",
    },
  },
  "bbl-h2d-04": {
    id: "bbl-h2d-04",
    shortName: "H2D",
    model: "Bambu Lab H2D",
    presetName: "Bambu Lab H2D 0.4 nozzle",
    settingId: "GM033",
    nozzle: 0.4,
    bed: "350 × 320 × 325 mm",
    materialPreset: "Bambu PLA Basic @BBL H2D",
    processPresets: {
      fine: "0.12mm Fine @BBL H2D",
      standard: "0.20mm Standard @BBL H2D",
      draft: "0.24mm Standard @BBL H2D",
    },
  },
};

const QUALITY: Record<QualityId, { label: string; layer: number }> = {
  fine: { label: "Fine", layer: 0.12 },
  standard: { label: "Standard", layer: 0.2 },
  draft: { label: "Draft", layer: 0.24 },
};

const STRENGTH: Record<StrengthId, { label: string; infill: number; walls: number }> = {
  light: { label: "Light", infill: 10, walls: 2 },
  standard: { label: "Standard", infill: 15, walls: 2 },
  strong: { label: "Strong", infill: 25, walls: 3 },
};

const EDITOR_PANELS = {
  topBar: true,
  gizmoRail: true,
  objectToolbar: true,
  paintPanel: true,
  statsCard: true,
  plateBar: true,
  emptyHint: true,
  status: true,
  sidebar: true,
  printerCard: "readonly",
  filamentCard: true,
  objectList: true,
  previewControls: true,
  processCard: true,
  sliceBar: true,
  towerCard: true,
  resinCard: false,
  bedWarn: true,
} as unknown as NonNullable<ViewportProps["panels"]>;

const EDITOR_SHADOW_CSS = `
  .app-shell { direction: ltr; }
  @media (max-width: 899px) {
    .app-shell { font-size: 12px; }
    .topbar { height: 42px; flex-basis: 42px; padding: 0 7px; gap: 5px; }
    .tb-logo, [data-testid="export-stl"] { display: none !important; }
    [data-testid="open-file"], [data-testid="save-project"] { width: 34px; height: 32px; padding: 4px; justify-content: center; }
    [data-testid="open-file"] span, [data-testid="save-project"] span { display: none; }
    .tb-tabs button { padding: 6px 12px; font-size: 11px; }
    .tb-icon { width: 30px; height: 30px; }
    .topbar .tb-left, .topbar .tb-right { gap: 4px; }
    .left-rail { flex-basis: 46px; width: 46px; padding-top: 54px; }
    .left-rail button { width: 38px; height: 38px; }
    .vp-top-toolbar { top: 8px; left: 8px; right: 8px; transform: none; max-width: none; justify-content: flex-start; }
    .vp-top-toolbar button { width: 38px; height: 38px; }
    .vp-top-toolbar button img { width: 20px; height: 20px; }
    .plate-bar { right: 10px; bottom: 138px; }
    .plate-bar button { min-width: 34px; height: 34px; }
    .vp-status { bottom: 126px; left: 58px; right: 8px; font-size: 10px; }
    .bed-warn, .stats-card { left: 56px; bottom: 168px; max-width: calc(100% - 70px); }
    .brush-panel { top: 58px; left: 52px; width: min(250px, calc(100vw - 66px)); }
    .sidebar { position: absolute; z-index: 14; top: 0; right: 0; bottom: 0; width: min(88vw, 390px); flex-basis: auto; box-shadow: -18px 0 44px rgba(0,0,0,.45); }
    :host([data-levo-sidebar="closed"]) .sidebar { display: none; }
    :host([data-levo-sidebar="open"]) .sidebar { display: flex; }
    .sidebar-scroll { padding-bottom: 88px; }
    .side-bottom { position: absolute; left: 0; right: 0; bottom: 0; }
    .help-card { max-width: calc(100vw - 24px); max-height: calc(100dvh - 120px); overflow: auto; }
  }
  @media (min-width: 900px) {
    .sidebar { display: flex !important; }
  }
`;

const TEXT = {
  ar: {
    title: "LEVO Studio",
    newProject: "مشروع جديد",
    printer: "الطابعة",
    settings: "الإعدادات",
    about: "حالة المنصة",
    loading: "جارٍ تحميل محرك التحرير…",
    profileLoading: "تطبيق ملف Orca الأصلي…",
    local: "محلي على جهازك",
    objects: "مجسم",
    plate: "Plate",
    add: "إضافة",
    move: "تحريك",
    rotate: "دوران",
    scale: "تكبير/تصغير",
    duplicate: "تكرار",
    remove: "حذف",
    fit: "إظهار الكل",
    bed: "عرض Plate",
    addPlate: "Plate +",
    panel: "المجسمات والإعدادات",
    prepare: "تجهيز",
    preview: "المسار",
    slice: "تقطيع",
    sliceAll: "تقطيع الكل",
    cancel: "إلغاء",
    save: "حفظ 3MF",
    download: "G-code",
    quality: "الجودة",
    strength: "القوة",
    support: "الدعامات",
    off: "إيقاف",
    auto: "تلقائي",
    apply: "تم",
    advanced: "كل الإعدادات والألوان والمجسمات",
    advancedHelp: "تظهر داخل لوحة المحرر الكاملة.",
    close: "إغلاق",
    directPrint: "الطباعة المباشرة",
    directPrintHelp: "ما زالت معطّلة حتى التحقق من حزمة Bambu والربط على طابعة حقيقية.",
    realEditor: "محرر Plate حقيقي",
    realEditorHelp: "تحريك، دوران، تكبير وتصغير، حذف، تكرار، تقسيم، Undo/Redo، دعم عدة Plates وحفظ 3MF.",
    layers: "طبقات",
    missingTools: "حدود المحرك الحالية",
    missingToolsHelp: "Auto Arrange وAuto Orient وCut وBoolean والنص ثلاثي الأبعاد ما زالت غير منفذة في محرك الويب ولا يتم تزويرها.",
    newConfirm: "بدء مشروع جديد؟ ستفقد التعديلات غير المحفوظة.",
    fileLimit: "حتى 12 ملفًا في المرة، 80 MB لكل ملف و160 MB إجماليًا.",
    actionUnavailable: "هذه الأداة غير متاحة في الوضع الحالي.",
  },
  en: {
    title: "LEVO Studio",
    newProject: "New project",
    printer: "Printer",
    settings: "Settings",
    about: "Platform status",
    loading: "Loading the editing engine…",
    profileLoading: "Applying the original Orca profile…",
    local: "Local on your device",
    objects: "objects",
    plate: "Plate",
    add: "Add",
    move: "Move",
    rotate: "Rotate",
    scale: "Scale",
    duplicate: "Duplicate",
    remove: "Delete",
    fit: "Zoom all",
    bed: "Zoom bed",
    addPlate: "Plate +",
    panel: "Objects & settings",
    prepare: "Prepare",
    preview: "Preview",
    slice: "Slice",
    sliceAll: "Slice all",
    cancel: "Cancel",
    save: "Save 3MF",
    download: "G-code",
    quality: "Quality",
    strength: "Strength",
    support: "Support",
    off: "Off",
    auto: "Auto",
    apply: "Done",
    advanced: "All settings, colors and objects",
    advancedHelp: "Shown inside the complete editor panel.",
    close: "Close",
    directPrint: "Direct print",
    directPrintHelp: "Still disabled until the Bambu package and real-printer connection are verified.",
    realEditor: "Real plate editor",
    realEditorHelp: "Move, rotate, scale, delete, duplicate, split, undo/redo, multi-plate editing and 3MF save.",
    layers: "layers",
    missingTools: "Current engine limits",
    missingToolsHelp: "Auto Arrange, Auto Orient, Cut, Boolean and 3D text are not yet implemented by the web engine and are not simulated.",
    newConfirm: "Start a new project? Unsaved edits will be lost.",
    fileLimit: "Up to 12 files at once, 80 MB each and 160 MB total.",
    actionUnavailable: "This tool is unavailable in the current mode.",
  },
} as const;

function Icon({ name }: { name: "plus" | "move" | "rotate" | "scale" | "copy" | "trash" | "fit" | "bed" | "layers" | "slice" | "save" | "info" | "settings" | "close" }) {
  const paths = {
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    move: <><path d="M12 2v20"/><path d="m8 6 4-4 4 4"/><path d="m8 18 4 4 4-4"/><path d="M2 12h20"/><path d="m6 8-4 4 4 4"/><path d="m18 8 4 4-4 4"/></>,
    rotate: <><path d="M20 7v5h-5"/><path d="M18.5 16a8 8 0 1 1 .8-8.8L20 12"/></>,
    scale: <><path d="M8 3H3v5"/><path d="m3 3 7 7"/><path d="M16 21h5v-5"/><path d="m21 21-7-7"/></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    trash: <><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 14h10l1-14"/><path d="M10 11v6M14 11v6"/></>,
    fit: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></>,
    bed: <><path d="M3 7h18v12H3z"/><path d="M7 3v4M17 3v4"/><path d="M7 11h10M7 15h6"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/></>,
    slice: <><path d="M4 6h16M4 12h16M4 18h16"/><path d="m8 3 8 18"/></>,
    save: <><path d="M5 3h12l2 2v16H5z"/><path d="M8 3v6h8V3"/><path d="M8 15h8"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    settings: <><path d="M4 7h10M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2M10 17h10"/><circle cx="8" cy="17" r="2"/></>,
    close: <><path d="m6 6 12 12"/><path d="m18 6-12 12"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function fallbackSettings(profile: PrinterProfile): SlicerSettings {
  const isX2D = profile.id === "bbl-x2d-04";
  const width = isX2D ? 256 : 350;
  const depth = isX2D ? 256 : 320;
  return {
    printer_model: profile.model,
    printer_settings_id: profile.presetName,
    nozzle_diameter: [profile.nozzle],
    printable_area: [[0, 0], [width, 0], [width, depth], [0, depth]],
    printable_height: isX2D ? 260 : 325,
    layer_height: 0.2,
    filament_type: ["PLA"],
    filament_diameter: [1.75],
    filament_flow_ratio: [0.98],
    nozzle_temperature: [220],
    eng_plate_temp: [55],
    sparse_infill_density: 15,
    wall_loops: 2,
  };
}

async function loadVerifiedProfile(profile: PrinterProfile, quality: QualityId, strength: StrengthId, support: boolean): Promise<LoadedProfile> {
  const api = await import("three-slicer/settings");
  const machine = api.printerSettings(profile.presetName) ?? fallbackSettings(profile);
  const processApi = await api.processPresets();
  const processName = profile.processPresets[quality];
  const process = processApi.settingsFor(processName) ?? {};
  const filamentApi = await api.filamentPresets();
  const filament = filamentApi.settingsFor(profile.materialPreset) ?? {};
  const identity: SlicerSettings = {
    printer_model: profile.model,
    printer_settings_id: profile.presetName,
    print_settings_id: processName,
    filament_settings_id: [profile.materialPreset],
  };
  const lockedMachine = { ...machine, ...identity };
  const combined: SlicerSettings = {
    ...machine,
    ...process,
    ...filament,
    ...identity,
    sparse_infill_density: STRENGTH[strength].infill,
    wall_loops: STRENGTH[strength].walls,
    enable_support: support,
    support_type: "normal(auto)",
  };
  if (profile.id === "bbl-x2d-04") combined.printable_height = 260;
  return { settings: combined, machine: lockedMachine, machineKeys: [...api.printerKeys, "printer_model", "printer_settings_id"] };
}

function validateFiles(files: File[], existingObjects: number) {
  const allowed = new Set(["stl", "obj", "3mf", "amf", "ply"]);
  if (files.length > 12 || existingObjects + files.length > 24) return "A project can contain up to 24 imported files, with 12 added at once.";
  let total = 0;
  for (const file of files) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!allowed.has(extension)) return `Unsupported file: ${file.name}`;
    if (!file.size) return `Empty file: ${file.name}`;
    if (file.size > 80 * 1024 * 1024) return `${file.name} exceeds the 80 MB per-file limit.`;
    total += file.size;
  }
  if (total > 160 * 1024 * 1024) return "The selected files exceed the 160 MB batch limit.";
  return null;
}

function findShadowHost(container: HTMLElement | null) {
  if (!container) return null;
  return Array.from(container.querySelectorAll<HTMLElement>("div")).find((element) => element.shadowRoot?.querySelector(".app-shell")) ?? null;
}

export default function SlicerClient() {
  const [locale, setLocale] = useState<Locale>("ar");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [profileId, setProfileId] = useState<ProfileId>("bbl-x2d-04");
  const [quality, setQuality] = useState<QualityId>("standard");
  const [strength, setStrength] = useState<StrengthId>("standard");
  const [support, setSupport] = useState(false);
  const [settings, setSettings] = useState<SlicerSettings>(() => fallbackSettings(PROFILES["bbl-x2d-04"]));
  const [loadedPresetKey, setLoadedPresetKey] = useState("");
  const [status, setStatus] = useState<EditorStatus>("loading");
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("prepare");
  const [objects, setObjects] = useState<EditorObject[]>([]);
  const [plateCount, setPlateCount] = useState(1);
  const [selectedPlate, setSelectedPlate] = useState(0);
  const [progress, setProgress] = useState(0);
  const [layerCount, setLayerCount] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [Viewport, setViewport] = useState<React.ComponentType<ViewportProps> | null>(null);
  const [SettingsPanel, setSettingsPanel] = useState<React.ComponentType<SettingsPanelProps> | null>(null);
  const viewportMountRef = useRef<HTMLDivElement>(null);
  const shadowHostRef = useRef<HTMLElement | null>(null);
  const objectCountRef = useRef(0);
  const sidebarOpenRef = useRef(false);
  const profileRequestRef = useRef(0);
  const machineRef = useRef<SlicerSettings>(fallbackSettings(PROFILES["bbl-x2d-04"]));
  const machineKeysRef = useRef<string[]>([]);
  const [artifactId] = useState(() => Symbol("levo-editor-gcode"));
  const profile = PROFILES[profileId];
  const t = TEXT[locale];
  const requestedPresetKey = `${profileId}:${quality}:${strength}:${support}`;
  const profileLoading = loadedPresetKey !== requestedPresetKey;

  useEffect(() => {
    let active = true;
    Promise.all([import("three-slicer/viewer"), import("three-slicer/components")])
      .then(([viewerModule, componentsModule]) => {
        if (!active) return;
        setViewport(() => viewerModule.default);
        setSettingsPanel(() => componentsModule.default);
        setStatus("editing");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "The editor engine could not be loaded.");
        setStatus("error");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const requestId = profileRequestRef.current + 1;
    profileRequestRef.current = requestId;
    loadVerifiedProfile(profile, quality, strength, support)
      .then((loaded) => {
        if (profileRequestRef.current !== requestId) return;
        machineRef.current = loaded.machine;
        machineKeysRef.current = loaded.machineKeys;
        setSettings(loaded.settings);
        GCODE_ARTIFACTS.get(artifactId)?.clear();
        setLoadedPresetKey(requestedPresetKey);
        setNotice("");
      })
      .catch((reason: unknown) => {
        if (profileRequestRef.current !== requestId) return;
        setLoadedPresetKey(requestedPresetKey);
        setError(reason instanceof Error ? reason.message : "The verified profile could not be loaded.");
      });
  }, [artifactId, profile, quality, requestedPresetKey, strength, support]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  useEffect(() => {
    objectCountRef.current = objects.length;
  }, [objects.length]);

  useEffect(() => {
    sidebarOpenRef.current = sidebarOpen;
    shadowHostRef.current?.setAttribute("data-levo-sidebar", sidebarOpen ? "open" : "closed");
  }, [sidebarOpen]);

  useEffect(() => () => { GCODE_ARTIFACTS.delete(artifactId); }, [artifactId]);

  useEffect(() => {
    const container = viewportMountRef.current;
    if (!container) return;
    let attachedRoot: ShadowRoot | null = null;
    let changeListener: ((event: Event) => void) | null = null;
    let dropListener: ((event: Event) => void) | null = null;

    const detach = () => {
      if (attachedRoot && changeListener) attachedRoot.removeEventListener("change", changeListener, true);
      if (attachedRoot && dropListener) attachedRoot.removeEventListener("drop", dropListener, true);
      attachedRoot = null;
      changeListener = null;
      dropListener = null;
    };

    const attach = () => {
      const host = findShadowHost(container);
      const root = host?.shadowRoot ?? null;
      if (!host || !root || root === attachedRoot) return;
      detach();
      shadowHostRef.current = host;
      host.setAttribute("data-levo-sidebar", sidebarOpenRef.current ? "open" : "closed");
      let style = root.querySelector<HTMLStyleElement>("style[data-levo-mobile]");
      if (!style) {
        style = document.createElement("style");
        style.dataset.levoMobile = "";
        root.append(style);
      }
      style.textContent = EDITOR_SHADOW_CSS;

      changeListener = (event) => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.dataset.testid !== "stl-input" || !input.files) return;
        const validationError = validateFiles(Array.from(input.files), objectCountRef.current);
        if (!validationError) { setError(""); return; }
        event.stopImmediatePropagation();
        input.value = "";
        setError(validationError);
        setStatus("error");
      };
      dropListener = (event) => {
        const dropEvent = event as DragEvent;
        const files = Array.from(dropEvent.dataTransfer?.files ?? []);
        if (!files.length) return;
        const validationError = validateFiles(files, objectCountRef.current);
        if (!validationError) { setError(""); return; }
        event.preventDefault();
        event.stopImmediatePropagation();
        setError(validationError);
        setStatus("error");
      };
      root.addEventListener("change", changeListener, true);
      root.addEventListener("drop", dropListener, true);
      attachedRoot = root;
    };

    attach();
    const observer = new MutationObserver(attach);
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      detach();
      if (shadowHostRef.current && container.contains(shadowHostRef.current)) shadowHostRef.current = null;
    };
  }, [Viewport, workspaceKey]);

  const clearGeneratedOutput = useCallback(() => {
    GCODE_ARTIFACTS.get(artifactId)?.clear();
    setProgress(0);
    setStatus((current) => current === "loading" ? current : "editing");
  }, [artifactId]);

  const setEditorSettings: Dispatch<SetStateAction<SlicerSettings>> = useCallback((next) => {
    setSettings((current) => {
      const proposed = typeof next === "function" ? next(current) : next;
      const locked = { ...proposed };
      const lockedRecord = locked as Record<string, unknown>;
      const machineRecord = machineRef.current as Record<string, unknown>;
      for (const key of machineKeysRef.current) {
        if (Object.prototype.hasOwnProperty.call(machineRecord, key)) lockedRecord[key] = machineRecord[key];
        else delete lockedRecord[key];
      }
      return locked;
    });
    clearGeneratedOutput();
  }, [clearGeneratedOutput]);

  const viewportRoot = useCallback(() => {
    const host = shadowHostRef.current ?? findShadowHost(viewportMountRef.current);
    if (host) shadowHostRef.current = host;
    return host?.shadowRoot ?? null;
  }, []);

  const clickControl = useCallback((testId: string, silent = false) => {
    const root = viewportRoot();
    const element = root?.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (!element || (element instanceof HTMLButtonElement && element.disabled)) {
      if (!silent) setNotice(t.actionUnavailable);
      return false;
    }
    element.click();
    setNotice("");
    return true;
  }, [t.actionUnavailable, viewportRoot]);

  const prepareAction = useCallback((testId: string) => {
    if (clickControl(testId, true)) return;
    clickControl("mode-prepare", true);
    window.requestAnimationFrame(() => {
      if (!clickControl(testId, true)) setNotice(t.actionUnavailable);
    });
  }, [clickControl, t.actionUnavailable]);

  const shortcut = useCallback((key: string) => {
    const shell = viewportRoot()?.querySelector<HTMLElement>(".app-shell");
    if (!shell) { setNotice(t.actionUnavailable); return; }
    shell.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    setNotice("");
  }, [t.actionUnavailable, viewportRoot]);

  const triggerSlice = useCallback((allPlates = false) => {
    const root = viewportRoot();
    const button = root?.querySelector<HTMLButtonElement>('[data-testid="slice-btn"]');
    if (!root || !button || button.disabled) { setNotice(t.actionUnavailable); return; }
    if (status === "slicing" || plateCount === 1) { button.click(); return; }
    button.click();
    window.requestAnimationFrame(() => {
      root.querySelector<HTMLButtonElement>(`[data-testid="slice-${allPlates ? "all" : "current"}"]`)?.click();
    });
  }, [plateCount, status, t.actionUnavailable, viewportRoot]);

  const handleEvent = useCallback((event: ViewportEvent) => {
    if (event.type === "objects") {
      setObjects(event.value);
      if (event.value.length) setStatus((current) => current === "slicing" ? current : "editing");
    } else if (event.type === "plateCount") {
      setPlateCount(event.value);
    } else if (event.type === "selectedPlate") {
      setSelectedPlate(event.value);
    } else if (event.type === "canvasMode") {
      setCanvasMode(event.value);
    } else if (event.type === "slicing") {
      setStatus(event.value ? "slicing" : "editing");
      if (!event.value) setProgress(0);
    } else if (event.type === "progress") {
      setProgress(Math.max(0, Math.min(1, event.value)));
    } else if (event.type === "layerCount") {
      setLayerCount(event.value);
    } else if (event.type === "notice") {
      setNotice(event.value);
    } else if (event.type === "error") {
      setError(event.value);
      setStatus("error");
    }
  }, []);

  const handleSliced = useCallback((payload: SlicePayload) => {
    let artifacts = GCODE_ARTIFACTS.get(artifactId);
    if (!artifacts) {
      artifacts = new Map();
      GCODE_ARTIFACTS.set(artifactId, artifacts);
    }
    artifacts.set(payload.plate, payload.gcode);
    if (payload.stats.over_bed || payload.stats.over_bed_model) {
      setError(`${profile.shortName}: the model or generated path exceeds the selected build volume.`);
      setStatus("error");
      return;
    }
    setError("");
    setProgress(1);
    setStatus("ready");
  }, [artifactId, profile.shortName]);

  const newProject = useCallback(() => {
    if (objects.length && !window.confirm(t.newConfirm)) return;
    GCODE_ARTIFACTS.get(artifactId)?.clear();
    setObjects([]);
    setPlateCount(1);
    setSelectedPlate(0);
    setCanvasMode("prepare");
    setProgress(0);
    setLayerCount(0);
    setNotice("");
    setError("");
    setSidebarOpen(false);
    setStatus("editing");
    setWorkspaceKey((value) => value + 1);
  }, [artifactId, objects.length, t.newConfirm]);

  const processPanel = useMemo(() => SettingsPanel ? (
    <SettingsPanel settings={settings} setSettings={setEditorSettings} embedded only={{ builder: "TabPrint::build" }} />
  ) : null, [SettingsPanel, setEditorSettings, settings]);

  const motionPanel = useMemo(() => SettingsPanel ? (
    <SettingsPanel settings={settings} setSettings={setEditorSettings} embedded only={{ builder: "TabPrinter::build_kinematics_page" }} />
  ) : null, [SettingsPanel, setEditorSettings, settings]);

  const filamentPanel = useMemo(() => SettingsPanel ? ((filamentSettings: SlicerSettings, setFilamentSettings: Dispatch<SetStateAction<SlicerSettings>>) => (
    <SettingsPanel settings={filamentSettings} setSettings={setFilamentSettings} embedded only={{ builder: "TabFilament::build" }} />
  )) : null, [SettingsPanel]);

  const statusLabel = status === "slicing" ? `${Math.round(progress * 100)}%` : status === "ready" ? `${layerCount || "✓"} ${t.layers}` : t.local;

  return (
    <main className="studio-app" dir={locale === "ar" ? "rtl" : "ltr"}>
      <header className="studio-header">
        <button className="studio-brand" onClick={() => setSheet("about")} aria-label={t.about}><span>LE</span></button>
        <div className="studio-project">
          <strong>{t.title}</strong>
          <span>{objects.length ? `${objects.length} ${t.objects} · ${t.plate} ${selectedPlate + 1}/${plateCount}` : t.newProject}</span>
        </div>
        <div className="studio-status" data-status={status}><i/><span>{profileLoading ? t.profileLoading : statusLabel}</span></div>
        <div className="studio-actions">
          <button onClick={newProject} title={t.newProject}><Icon name="plus"/><span>{t.newProject}</span></button>
          <button className="profile-button" onClick={() => setSheet("setup")} title={t.settings}><b>{profile.shortName}</b><small>{QUALITY[quality].layer.toFixed(2)}</small></button>
          <button className={`panel-button ${sidebarOpen ? "active" : ""}`} onClick={() => setSidebarOpen((value) => !value)} aria-label={t.panel}><Icon name="layers"/></button>
          <button onClick={() => setSheet("about")} aria-label={t.about}><Icon name="info"/></button>
          <button className="language-button" onClick={() => setLocale(locale === "ar" ? "en" : "ar")} aria-label="Change language">{locale === "ar" ? "EN" : "ع"}</button>
        </div>
      </header>

      <section className="editor-area">
        <div className="viewport-mount" ref={viewportMountRef}>
          {Viewport ? (
            <Viewport
              key={workspaceKey}
              settings={settings}
              setSettings={setEditorSettings}
              processPanel={processPanel}
              motionPanel={motionPanel}
              filamentPanel={filamentPanel}
              panels={EDITOR_PANELS}
              features={{ warmup: false, logs: false }}
              defaultExtruderColors={["#303438", "#f3f4f4", "#9ad51f", "#3a8dff"]}
              onEvent={handleEvent}
              onSliced={(payload) => handleSliced(payload as SlicePayload)}
            />
          ) : (
            <div className="editor-loader" aria-live="polite"><span/><strong>{t.loading}</strong><small>{profile.shortName} · {profile.bed}</small></div>
          )}
        </div>

        {(error || notice) && <div className={`editor-message ${error ? "error" : "notice"}`} role={error ? "alert" : "status"}>
          <span>{error || notice}</span><button onClick={() => { setError(""); setNotice(""); if (status === "error") setStatus("editing"); }} aria-label={t.close}><Icon name="close"/></button>
        </div>}

        <nav className="mobile-toolstrip" aria-label="Object tools">
          <button onClick={() => prepareAction("tool-add")}><Icon name="plus"/><span>{t.add}</span></button>
          <button onClick={() => prepareAction("gizmo-move")}><Icon name="move"/><span>{t.move}</span></button>
          <button onClick={() => prepareAction("gizmo-rotate")}><Icon name="rotate"/><span>{t.rotate}</span></button>
          <button onClick={() => prepareAction("gizmo-scale")}><Icon name="scale"/><span>{t.scale}</span></button>
          <button onClick={() => prepareAction("tool-duplicate")}><Icon name="copy"/><span>{t.duplicate}</span></button>
          <button className="danger" onClick={() => prepareAction("tool-delete")}><Icon name="trash"/><span>{t.remove}</span></button>
          <button onClick={() => shortcut("z")}><Icon name="fit"/><span>{t.fit}</span></button>
          <button onClick={() => shortcut("b")}><Icon name="bed"/><span>{t.bed}</span></button>
          <button onClick={() => clickControl("plate-add")}><Icon name="layers"/><span>{t.addPlate}</span></button>
        </nav>

        <div className="mobile-primarybar">
          <div className="mode-switch" role="tablist">
            <button className={canvasMode === "prepare" ? "active" : ""} onClick={() => clickControl("mode-prepare")} role="tab">{t.prepare}</button>
            <button className={canvasMode === "preview" ? "active" : ""} onClick={() => clickControl("mode-preview")} role="tab">{t.preview}</button>
          </div>
          <button className="mobile-save" onClick={() => clickControl("save-project")} aria-label={t.save}><Icon name="save"/></button>
          <button className={`mobile-slice ${status === "slicing" ? "cancel" : ""}`} onClick={() => triggerSlice(false)} disabled={!objects.length}>
            <Icon name="slice"/><span>{status === "slicing" ? `${t.cancel} ${Math.round(progress * 100)}%` : t.slice}</span>
          </button>
          {plateCount > 1 && <button className="mobile-slice-all" onClick={() => triggerSlice(true)} disabled={!objects.length || status === "slicing"}>{t.sliceAll}</button>}
          <button className="mobile-panel" onClick={() => setSidebarOpen((value) => !value)} aria-label={t.panel}><Icon name="settings"/></button>
        </div>
      </section>

      {sheet && <div className="sheet-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setSheet(null); }}>
        <section className="studio-sheet" role="dialog" aria-modal="true" aria-label={sheet === "about" ? t.about : t.settings}>
          <div className="sheet-handle"/>
          <header><div><strong>{sheet === "about" ? t.about : t.settings}</strong><span>{profile.shortName} · {profile.nozzle.toFixed(1)} mm · PLA</span></div><button onClick={() => setSheet(null)} aria-label={t.close}><Icon name="close"/></button></header>

          {sheet === "setup" ? <div className="sheet-body setup-body">
            <fieldset><legend>{t.printer}</legend><div className="profile-grid">
              {(Object.keys(PROFILES) as ProfileId[]).map((id) => <button key={id} className={profileId === id ? "active" : ""} onClick={() => setProfileId(id)}><strong>{PROFILES[id].model}</strong><span>{PROFILES[id].bed}</span><small>{PROFILES[id].settingId} · 0.4 mm</small></button>)}
            </div></fieldset>
            <fieldset><legend>{t.quality}</legend><div className="segmented-control">
              {(Object.keys(QUALITY) as QualityId[]).map((id) => <button key={id} className={quality === id ? "active" : ""} onClick={() => setQuality(id)}><strong>{QUALITY[id].label}</strong><span>{QUALITY[id].layer.toFixed(2)} mm</span></button>)}
            </div></fieldset>
            <fieldset><legend>{t.strength}</legend><div className="segmented-control">
              {(Object.keys(STRENGTH) as StrengthId[]).map((id) => <button key={id} className={strength === id ? "active" : ""} onClick={() => setStrength(id)}><strong>{STRENGTH[id].label}</strong><span>{STRENGTH[id].infill}% · {STRENGTH[id].walls} walls</span></button>)}
            </div></fieldset>
            <div className="support-row"><span><strong>{t.support}</strong><small>{support ? t.auto : t.off}</small></span><button className={`switch ${support ? "on" : ""}`} role="switch" aria-checked={support} onClick={() => setSupport((value) => !value)}><i/></button></div>
            <button className="advanced-button" onClick={() => { setSheet(null); setSidebarOpen(true); }}><span><Icon name="settings"/><b>{t.advanced}</b><small>{t.advancedHelp}</small></span><Icon name="layers"/></button>
            <p className="file-limit">{t.fileLimit}</p>
            <button className="sheet-done" onClick={() => setSheet(null)}>{t.apply}</button>
          </div> : <div className="sheet-body about-body">
            <div className="capability verified"><i/><span><strong>{t.realEditor}</strong><small>{t.realEditorHelp}</small></span></div>
            <div className="capability partial"><i/><span><strong>{t.missingTools}</strong><small>{t.missingToolsHelp}</small></span></div>
            <div className="capability disabled"><i/><span><strong>{t.directPrint}</strong><small>{t.directPrintHelp}</small></span></div>
            <a href="https://github.com/aliamer229/Levo_slicer" target="_blank" rel="noreferrer">GitHub · AGPL source</a>
          </div>}
        </section>
      </div>}
    </main>
  );
}
