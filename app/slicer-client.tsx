"use client";

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SlicerSettings } from "three-slicer";
import type { SettingsPanelProps } from "three-slicer/components";
import type { ViewportEvent, ViewportProps } from "three-slicer/viewer";

type Locale = "ar" | "en";
type Sheet = "setup" | "print" | "about" | null;
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
  :host { color-scheme: dark; }
  .app-shell { direction: ltr; background: #111518; color: #dfe5e8; }
  .topbar, .left-rail { background: #151a1d; border-color: #2d353a; }
  .tb-btn, .tb-icon, .tb-tabs, .tb-tabs button { background: #20262a; border-color: #343d43; color: #d5dde1; }
  .tb-tabs button.on, .left-rail button.on { background: #91c720; color: #142008; }
  .viewport-col { background: #24292d; }
  .vp-top-toolbar, .plate-bar, .brush-panel, .stats-card, .help-card { background: #171c1f; border-color: #343d43; box-shadow: 0 12px 28px #080a0b; }
  .vp-top-toolbar button:hover:not(:disabled), .left-rail button:hover { background: #2a3237; }
  .sidebar { background: #181d20; color: #dfe5e8; border-color: #343d43; }
  .sidebar-scroll, .side-bottom { background: #181d20; }
  .side-bottom { border-color: #343d43; }
  .side-card { background: #21272b; border-color: #343d43; color: #dfe5e8; box-shadow: none; }
  .sc-head, .sc-info b, .obj-list2 .obj-name, .side-card .view-type-row, .side-card .slice-layer label, .side-card .grad-title, .sc-fold>summary b { color: #e7ecef; }
  .sc-info, .sc-note, .fil-mat, .side-card .role-legend, .side-card .slice-travel, .sc-fold>summary { color: #9ca8ae; }
  .side-card select, .side-card input:not([type="range"]):not([type="checkbox"]):not([type="color"]), .side-card .obj-ext { background: #14181b; color: #edf1f3; border-color: #3b454b; }
  .obj-list2 li.obj-selected, .filament-row.fil-active { background: #29351f; box-shadow: inset 3px 0 #91c720; }
  .slice-btn { background: #91c720; color: #142008; }
  .export-btn { background: #2a3237; color: #dfe5e8; border-color: #3b454b; }
  .empty-hint { display: none !important; }
  @media (max-width: 899px) {
    .app-shell { font-size: 12px; }
    .topbar, .left-rail, .vp-top-toolbar { display: none !important; }
    .plate-bar { right: 8px; bottom: 76px; padding: 4px; }
    .plate-bar button { min-width: 36px; height: 36px; }
    .vp-status { bottom: 72px; left: 9px; right: 58px; font-size: 10px; }
    .bed-warn, .stats-card { left: 8px; bottom: 116px; max-width: calc(100% - 68px); }
    .brush-panel { top: 8px; left: 8px; width: min(280px, calc(100vw - 16px)); }
    .sidebar { position: absolute; z-index: 14; top: 0; right: 0; bottom: 62px; width: min(94vw, 420px); flex-basis: auto; box-shadow: -16px 0 34px #080a0b; }
    :host([data-levo-sidebar="closed"]) .sidebar { display: none; }
    :host([data-levo-sidebar="open"]) .sidebar { display: flex; }
    .sidebar-scroll { padding: 8px 8px 82px; }
    .side-bottom { position: absolute; left: 0; right: 0; bottom: 0; }
    .help-card { max-width: calc(100vw - 16px); max-height: calc(100dvh - 90px); overflow: auto; }
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
    files: "الملفات",
    tools: "الأدوات",
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
    print: "طباعة",
    printExport: "الطباعة والتصدير",
    printReady: "ملف الطباعة جاهز",
    printReadyHelp: "تم إنشاء G-code للـPlate الحالية ويمكن تنزيله أو مشاركته.",
    downloadGcode: "تنزيل ملف G-code",
    shareFile: "مشاركة الملف",
    shareUnavailable: "المشاركة غير مدعومة في هذا المتصفح؛ تم تنزيل الملف بدلًا منها.",
    exportAll: "تنزيل ملفات كل Plates",
    saveProject: "حفظ مشروع 3MF",
    editTools: "أدوات المجسم",
    editToolsHelp: "كل أوامر التحرير الأساسية بحجم مناسب للمس.",
    undo: "تراجع",
    redo: "إعادة",
    split: "تقسيم",
    onBed: "على Plate",
    paint: "رسم الدعم",
    deleteAll: "حذف الكل",
    deleteAllConfirm: "حذف جميع المجسمات من Plate الحالية؟",
    officialPrint: "المسار الرسمي للطابعة",
    officialPrintHelp: "على الكمبيوتر: نزّل الملف ثم اسحبه إلى Bambu Connect أو Bambu Studio وأكمل اختيار الطابعة وAMS هناك.",
    mobilePrintHelp: "على الهاتف: نزّل أو شارك الملف، ثم انقله إلى كمبيوتر Bambu Connect أو إلى USB/بطاقة ذاكرة مدعومة.",
    openBambuGuide: "فتح دليل Bambu Connect",
    printSafety: "راجع الطابعة، نوع Plate، الفوهة، الفلمنت وAMS قبل بدء أي طباعة.",
    printNotReady: "قم بتقطيع Plate أولًا لإنشاء ملف الطباعة.",
    imported: "تمت إضافة الملفات إلى المشروع.",
    formats: "STL · OBJ · 3MF · AMF · PLY",
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
    directPrintHelp: "التصدير والطباعة عبر Bambu Connect مدعومان. الإرسال الشبكي المباشر من الهاتف يحتاج جسرًا محليًا معتمدًا من Bambu.",
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
    files: "Files",
    tools: "Tools",
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
    print: "Print",
    printExport: "Print & export",
    printReady: "Print file ready",
    printReadyHelp: "G-code for the current plate is ready to download or share.",
    downloadGcode: "Download G-code",
    shareFile: "Share file",
    shareUnavailable: "File sharing is unavailable in this browser, so the file was downloaded instead.",
    exportAll: "Download every plate",
    saveProject: "Save 3MF project",
    editTools: "Object tools",
    editToolsHelp: "Core editing commands in touch-friendly sizes.",
    undo: "Undo",
    redo: "Redo",
    split: "Split",
    onBed: "Place on bed",
    paint: "Support paint",
    deleteAll: "Delete all",
    deleteAllConfirm: "Delete every object on the current plate?",
    officialPrint: "Official printer handoff",
    officialPrintHelp: "On desktop, download the file, drop it into Bambu Connect or Bambu Studio, then confirm the printer and AMS there.",
    mobilePrintHelp: "On mobile, download or share the file, then move it to a Bambu Connect computer or supported USB/memory card.",
    openBambuGuide: "Open Bambu Connect guide",
    printSafety: "Verify printer, plate, nozzle, filament and AMS before starting any print.",
    printNotReady: "Slice the plate first to create a printable file.",
    imported: "Files were added to the project.",
    formats: "STL · OBJ · 3MF · AMF · PLY",
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
    directPrintHelp: "Export and printing through Bambu Connect are supported. Direct phone-to-printer networking needs an approved local Bambu bridge.",
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

function Icon({ name }: { name: "plus" | "file" | "move" | "rotate" | "scale" | "copy" | "trash" | "fit" | "bed" | "layers" | "slice" | "print" | "save" | "share" | "undo" | "redo" | "split" | "paint" | "info" | "settings" | "close" | "check" | "external" }) {
  const paths = {
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    file: <><path d="M5 3h9l5 5v13H5z"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14h6"/></>,
    move: <><path d="M12 2v20"/><path d="m8 6 4-4 4 4"/><path d="m8 18 4 4 4-4"/><path d="M2 12h20"/><path d="m6 8-4 4 4 4"/><path d="m18 8 4 4-4 4"/></>,
    rotate: <><path d="M20 7v5h-5"/><path d="M18.5 16a8 8 0 1 1 .8-8.8L20 12"/></>,
    scale: <><path d="M8 3H3v5"/><path d="m3 3 7 7"/><path d="M16 21h5v-5"/><path d="m21 21-7-7"/></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    trash: <><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 14h10l1-14"/><path d="M10 11v6M14 11v6"/></>,
    fit: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></>,
    bed: <><path d="M3 7h18v12H3z"/><path d="M7 3v4M17 3v4"/><path d="M7 11h10M7 15h6"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/></>,
    slice: <><path d="M4 6h16M4 12h16M4 18h16"/><path d="m8 3 8 18"/></>,
    print: <><path d="M7 8V3h10v5"/><path d="M6 17H4v-7h16v7h-2"/><path d="M7 14h10v7H7z"/><path d="M17 11h.01"/></>,
    save: <><path d="M5 3h12l2 2v16H5z"/><path d="M8 3v6h8V3"/><path d="M8 15h8"/></>,
    share: <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.2M8.7 13.3l6.6 4.2"/></>,
    undo: <><path d="M9 7 4 12l5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/></>,
    redo: <><path d="m15 7 5 5-5 5"/><path d="M19 12h-8a6 6 0 0 0-6 6"/></>,
    split: <><path d="M4 4h7v7H4zM13 13h7v7h-7z"/><path d="m11 11 2 2M14 6h4v4M10 18H6v-4"/></>,
    paint: <><path d="m14 4 6 6-9 9H5v-6z"/><path d="m12 6 6 6M5 19c0 1-1 2-2 2"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    settings: <><path d="M4 7h10M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2M10 17h10"/><circle cx="8" cy="17" r="2"/></>,
    close: <><path d="m6 6 12 12"/><path d="m18 6-12 12"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/></>,
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

function validateFiles(files: File[], existingObjects: number, locale: Locale) {
  const ar = locale === "ar";
  const allowed = new Set(["stl", "obj", "3mf", "amf", "ply"]);
  if (files.length > 12 || existingObjects + files.length > 24) return ar
    ? "يمكن أن يحتوي المشروع على 24 ملفًا كحد أقصى، مع إضافة 12 ملفًا في المرة."
    : "A project can contain up to 24 imported files, with 12 added at once.";
  let total = 0;
  for (const file of files) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!allowed.has(extension)) return ar ? `نوع الملف غير مدعوم: ${file.name}` : `Unsupported file: ${file.name}`;
    if (!file.size) return ar ? `الملف فارغ: ${file.name}` : `Empty file: ${file.name}`;
    if (file.size > 80 * 1024 * 1024) return ar
      ? `${file.name} يتجاوز حد 80 MB للملف الواحد.`
      : `${file.name} exceeds the 80 MB per-file limit.`;
    total += file.size;
  }
  if (total > 160 * 1024 * 1024) return ar
    ? "الملفات المحددة تتجاوز حد 160 MB للدفعة."
    : "The selected files exceed the 160 MB batch limit.";
  return null;
}

function findShadowHost(container: HTMLElement | null) {
  if (!container) return null;
  return Array.from(container.querySelectorAll<HTMLElement>("div")).find((element) => element.shadowRoot?.querySelector(".app-shell")) ?? null;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
  const [toolTrayOpen, setToolTrayOpen] = useState(false);
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
        const validationError = validateFiles(Array.from(input.files), objectCountRef.current, locale);
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
        const validationError = validateFiles(files, objectCountRef.current, locale);
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
  }, [Viewport, locale, workspaceKey]);

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

  const openFiles = useCallback(() => {
    const root = viewportRoot();
    const input = root?.querySelector<HTMLInputElement>('[data-testid="stl-input"]');
    if (input) {
      input.value = "";
      input.click();
      setNotice("");
      setToolTrayOpen(false);
      return;
    }
    if (!clickControl("open-file", true) && !clickControl("empty-pick", true)) setNotice(t.actionUnavailable);
  }, [clickControl, t.actionUnavailable, viewportRoot]);

  const runTool = useCallback((testId: string) => {
    prepareAction(testId);
    setToolTrayOpen(false);
  }, [prepareAction]);

  const deleteAll = useCallback(() => {
    if (!objects.length || !window.confirm(t.deleteAllConfirm)) return;
    runTool("tool-delete-all");
  }, [objects.length, runTool, t.deleteAllConfirm]);

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

  const currentGcode = useCallback(() => GCODE_ARTIFACTS.get(artifactId)?.get(selectedPlate) ?? "", [artifactId, selectedPlate]);

  const currentGcodeFile = useCallback(() => {
    const gcode = currentGcode();
    if (!gcode) return null;
    const name = `LEVO-${profile.shortName}-plate-${selectedPlate + 1}.gcode`;
    return new File([gcode], name, { type: "text/x-gcode" });
  }, [currentGcode, profile.shortName, selectedPlate]);

  const downloadCurrentGcode = useCallback(() => {
    const file = currentGcodeFile();
    if (!file) { setNotice(t.printNotReady); return false; }
    downloadBlob(file, file.name);
    setNotice("");
    return true;
  }, [currentGcodeFile, t.printNotReady]);

  const shareCurrentGcode = useCallback(async () => {
    const file = currentGcodeFile();
    if (!file) { setNotice(t.printNotReady); return; }
    const data: ShareData = { files: [file], title: file.name };
    if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(data))) {
      try {
        await navigator.share(data);
        return;
      } catch (reason: unknown) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
      }
    }
    downloadBlob(file, file.name);
    setNotice(t.shareUnavailable);
  }, [currentGcodeFile, t.printNotReady, t.shareUnavailable]);

  const openPrintCenter = useCallback(() => {
    if (status !== "ready" || !currentGcode()) { setNotice(t.printNotReady); return; }
    setToolTrayOpen(false);
    setSidebarOpen(false);
    setSheet("print");
  }, [currentGcode, status, t.printNotReady]);

  const primaryAction = useCallback(() => {
    if (status === "ready" && currentGcode()) openPrintCenter();
    else triggerSlice(false);
  }, [currentGcode, openPrintCenter, status, triggerSlice]);

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
      if (event.value === "preview") setToolTrayOpen(false);
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
    setToolTrayOpen(false);
    setSheet(null);
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
  const printReady = status === "ready" && Boolean(currentGcode());
  const slicedPlateCount = GCODE_ARTIFACTS.get(artifactId)?.size ?? 0;
  const sheetTitle = sheet === "about" ? t.about : sheet === "print" ? t.printExport : t.settings;

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
          <button className="import-action" onClick={openFiles} title={t.files}><Icon name="file"/><span>{t.files}</span></button>
          <button className="new-project-action" onClick={newProject} title={t.newProject}><Icon name="plus"/><span>{t.newProject}</span></button>
          {printReady && <button className="header-print-action" onClick={openPrintCenter}><Icon name="print"/><span>{t.print}</span></button>}
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

        {Viewport && !objects.length && status !== "error" && <section className="empty-upload-card" aria-label={t.files}>
          <span className="empty-upload-icon"><Icon name="file"/></span>
          <strong>{t.files}</strong>
          <p>{t.formats}</p>
          <button onClick={openFiles}><Icon name="plus"/><span>{t.add}</span></button>
          <small>{t.fileLimit}</small>
        </section>}

        {(error || notice) && <div className={`editor-message ${error ? "error" : "notice"}`} role={error ? "alert" : "status"}>
          <span>{error || notice}</span><button onClick={() => { setError(""); setNotice(""); if (status === "error") setStatus("editing"); }} aria-label={t.close}><Icon name="close"/></button>
        </div>}

        {toolTrayOpen && <section className="mobile-tooltray" aria-label={t.editTools}>
          <header><span><strong>{t.editTools}</strong><small>{t.editToolsHelp}</small></span><button onClick={() => setToolTrayOpen(false)} aria-label={t.close}><Icon name="close"/></button></header>
          <div className="mobile-toolgrid">
            <button onClick={openFiles}><Icon name="file"/><span>{t.add}</span></button>
            <button onClick={() => runTool("gizmo-move")}><Icon name="move"/><span>{t.move}</span></button>
            <button onClick={() => runTool("gizmo-rotate")}><Icon name="rotate"/><span>{t.rotate}</span></button>
            <button onClick={() => runTool("gizmo-scale")}><Icon name="scale"/><span>{t.scale}</span></button>
            <button onClick={() => runTool("tool-duplicate")}><Icon name="copy"/><span>{t.duplicate}</span></button>
            <button className="danger" onClick={() => runTool("tool-delete")}><Icon name="trash"/><span>{t.remove}</span></button>
            <button onClick={() => runTool("tool-split")}><Icon name="split"/><span>{t.split}</span></button>
            <button onClick={() => runTool("tool-onbed")}><Icon name="bed"/><span>{t.onBed}</span></button>
            <button onClick={() => runTool("gizmo-paint")}><Icon name="paint"/><span>{t.paint}</span></button>
            <button onClick={() => { shortcut("z"); setToolTrayOpen(false); }}><Icon name="fit"/><span>{t.fit}</span></button>
            <button onClick={() => { shortcut("b"); setToolTrayOpen(false); }}><Icon name="bed"/><span>{t.bed}</span></button>
            <button onClick={() => { clickControl("undo"); setToolTrayOpen(false); }}><Icon name="undo"/><span>{t.undo}</span></button>
            <button onClick={() => { clickControl("redo"); setToolTrayOpen(false); }}><Icon name="redo"/><span>{t.redo}</span></button>
            <button onClick={() => { clickControl("plate-add"); setToolTrayOpen(false); }}><Icon name="layers"/><span>{t.addPlate}</span></button>
            <button onClick={() => { clickControl("save-project"); setToolTrayOpen(false); }}><Icon name="save"/><span>{t.save}</span></button>
            {plateCount > 1 && <button onClick={() => { triggerSlice(true); setToolTrayOpen(false); }}><Icon name="slice"/><span>{t.sliceAll}</span></button>}
            <button className="danger" onClick={deleteAll}><Icon name="trash"/><span>{t.deleteAll}</span></button>
          </div>
        </section>}

        <div className="mobile-primarybar">
          <button className="mobile-nav-item" onClick={openFiles}><Icon name="file"/><span>{t.files}</span></button>
          <button className={`mobile-nav-item ${toolTrayOpen ? "active" : ""}`} onClick={() => { setSidebarOpen(false); setToolTrayOpen((value) => !value); }} aria-expanded={toolTrayOpen}><Icon name="move"/><span>{t.tools}</span></button>
          <button className={`mobile-primary-action ${status === "slicing" ? "cancel" : ""} ${printReady ? "ready" : ""}`} onClick={primaryAction} disabled={!objects.length}>
            <Icon name={printReady ? "print" : "slice"}/><span>{status === "slicing" ? `${t.cancel} ${Math.round(progress * 100)}%` : printReady ? t.print : t.slice}</span>
          </button>
          <button className={`mobile-nav-item ${canvasMode === "preview" ? "active" : ""}`} onClick={() => clickControl(canvasMode === "preview" ? "mode-prepare" : "mode-preview")} disabled={!objects.length}><Icon name="layers"/><span>{canvasMode === "preview" ? t.prepare : t.preview}</span></button>
          <button className={`mobile-nav-item ${sidebarOpen ? "active" : ""}`} onClick={() => { setToolTrayOpen(false); setSidebarOpen((value) => !value); }}><Icon name="settings"/><span>{t.settings}</span></button>
        </div>
      </section>

      {sheet && <div className="sheet-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setSheet(null); }}>
        <section className="studio-sheet" role="dialog" aria-modal="true" aria-label={sheetTitle}>
          <div className="sheet-handle"/>
          <header><div><strong>{sheetTitle}</strong><span>{profile.shortName} · {profile.nozzle.toFixed(1)} mm · PLA</span></div><button onClick={() => setSheet(null)} aria-label={t.close}><Icon name="close"/></button></header>

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
          </div> : sheet === "print" ? <div className="sheet-body print-body">
            <div className="print-ready-card"><span><Icon name="check"/></span><div><strong>{t.printReady}</strong><small>{t.printReadyHelp}</small></div></div>
            <div className="print-action-grid">
              <button className="print-download" onClick={downloadCurrentGcode}><Icon name="file"/><span><b>{t.downloadGcode}</b><small>{profile.shortName} · {t.plate} {selectedPlate + 1}</small></span></button>
              <button onClick={() => void shareCurrentGcode()}><Icon name="share"/><span><b>{t.shareFile}</b><small>{t.download}</small></span></button>
              <button onClick={() => clickControl("save-project")}><Icon name="save"/><span><b>{t.saveProject}</b><small>{objects.length} {t.objects}</small></span></button>
              {slicedPlateCount > 1 && <button onClick={() => clickControl("export-all")}><Icon name="layers"/><span><b>{t.exportAll}</b><small>{slicedPlateCount} {t.plate}</small></span></button>}
            </div>
            <div className="print-handoff">
              <span className="handoff-icon"><Icon name="print"/></span>
              <div><strong>{t.officialPrint}</strong><p>{t.officialPrintHelp}</p><p>{t.mobilePrintHelp}</p></div>
              <a href="https://wiki.bambulab.com/en/software/bambu-connect" target="_blank" rel="noreferrer"><span>{t.openBambuGuide}</span><Icon name="external"/></a>
            </div>
            <p className="print-safety"><Icon name="info"/><span>{t.printSafety}</span></p>
          </div> : <div className="sheet-body about-body">
            <div className="capability verified"><i/><span><strong>{t.realEditor}</strong><small>{t.realEditorHelp}</small></span></div>
            <div className="capability partial"><i/><span><strong>{t.missingTools}</strong><small>{t.missingToolsHelp}</small></span></div>
            <div className="capability partial"><i/><span><strong>{t.directPrint}</strong><small>{t.directPrintHelp}</small></span></div>
            <a href="https://github.com/aliamer229/Levo_slicer" target="_blank" rel="noreferrer">GitHub · AGPL source</a>
          </div>}
        </section>
      </div>}
    </main>
  );
}
