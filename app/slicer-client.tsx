"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SlicerSettings } from "three-slicer";
import type { SettingsPanelProps } from "three-slicer/components";
import type { ViewportEvent, ViewportProps } from "three-slicer/viewer";
import { FILE_PICKER_ACCEPT, extractModelArchive, fileExtension, normalizeModelFile } from "./archive-import";
import { registerExtendedModelLoaders } from "./model-loaders";
import {
  connectNativePrinter,
  detectNativePrinterEnvironment,
  discoverNativePrinters,
  disconnectNativePrinter,
  getNativePrinterStatus,
  sendNativePrintJob,
  type LevoDiscoveredPrinter,
  type LevoNativeEnvironment,
  type LevoPrinterStatus,
} from "./native-printer-bridge";
import { packModelsAcrossPlates } from "./plate-packing";

type Locale = "ar" | "en";
type Sheet = "setup" | "print" | "connect" | "about" | null;
type ProfileId = "bbl-x2d-04" | "bbl-h2d-04";
type QualityId = "fine" | "standard" | "draft";
type StrengthId = "light" | "standard" | "strong";
type EditorStatus = "loading" | "editing" | "slicing" | "ready" | "error";
type CanvasMode = "prepare" | "preview";
type ConnectionMode = "lan" | "cloud" | "usb";
type LanAction = "idle" | "discovering" | "connecting" | "transferring";

interface PrinterProfile {
  id: ProfileId;
  shortName: string;
  model: string;
  presetName: string;
  settingId: string;
  nozzle: number;
  bed: string;
  bedWidth: number;
  bedDepth: number;
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

interface ArchivePlan {
  beforeIds: Set<number>;
  startPlate: number;
  maxPlateCount: number;
}

interface ImportProgressState {
  label: string;
  ratio: number;
  extracted: number;
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
    bedWidth: 256,
    bedDepth: 256,
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
    bedWidth: 350,
    bedDepth: 320,
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
  .tb-btn, .tb-icon, .tb-tabs, .tb-tabs button { background: #20262a; border-color: #343d43; border-radius: 6px; color: #d5dde1; }
  .tb-tabs button.on, .left-rail button.on { background: #91c720; color: #142008; }
  .viewport-col { background: #24292d; }
  .vp-top-toolbar, .plate-bar, .brush-panel, .stats-card, .help-card { background: #171c1f; border-color: #343d43; border-radius: 7px; box-shadow: 0 10px 24px #080a0b; }
  .vp-top-toolbar button:hover:not(:disabled), .left-rail button:hover { background: #2a3237; }
  .sidebar { background: #181d20; color: #dfe5e8; border-color: #343d43; }
  .sidebar-scroll, .side-bottom { background: #181d20; }
  .side-bottom { border-color: #343d43; }
  .side-card { background: #21272b; border-color: #343d43; border-radius: 7px; color: #dfe5e8; box-shadow: none; }
  .sc-head, .sc-info b, .obj-list2 .obj-name, .side-card .view-type-row, .side-card .slice-layer label, .side-card .grad-title, .sc-fold>summary b { color: #e7ecef; }
  .sc-info, .sc-note, .fil-mat, .side-card .role-legend, .side-card .slice-travel, .sc-fold>summary { color: #9ca8ae; }
  .side-card select, .side-card input:not([type="range"]):not([type="checkbox"]):not([type="color"]), .side-card .obj-ext { background: #14181b; color: #edf1f3; border-color: #3b454b; }
  .obj-list2 li.obj-selected, .filament-row.fil-active { background: #29351f; box-shadow: inset 3px 0 #91c720; }
  button, .slice-btn, .export-btn, select, input { border-radius: 6px !important; }
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
    connectPrinter: "ربط الطابعة",
    connectTitle: "طرق ربط الطابعة",
    connectionIntro: "اختر الاتصال المحلي، Bambu Cloud أو USB. يعرض LEVO فقط الإمكانات المتاحة فعليًا على جهازك.",
    lanMethod: "نفس شبكة Wi‑Fi",
    cloudMethod: "السحابة",
    usbMethod: "USB",
    lanTitle: "الاتصال المحلي عبر IP",
    lanHelp: "يعمل من تطبيق LEVO عندما يكون الهاتف والطابعة على الشبكة نفسها وبعد تفعيل LAN Only وDeveloper Mode.",
    appDetected: "تم اكتشاف تطبيق LEVO",
    websiteDetected: "أنت تستخدم موقع LEVO",
    appBridgeReady: "جسر الطابعة المحلي جاهز",
    appBridgePreparing: "اتصال IP متاح داخل تطبيق LEVO فقط. الموقع سيبقى متاحًا للسحابة وUSB.",
    printerIp: "عنوان IP للطابعة",
    printerAccessCode: "Access Code",
    printerSerial: "الرقم التسلسلي (اختياري)",
    rememberPrinter: "حفظ الطابعة بأمان داخل التطبيق",
    discoverPrinters: "البحث عن الطابعات",
    discoveringPrinters: "جارٍ البحث…",
    connectLan: "اتصال آمن",
    connectingLan: "جارٍ الاتصال…",
    disconnectLan: "قطع الاتصال",
    noPrintersFound: "لم يعثر التطبيق على طابعة. أدخل IP وAccess Code يدويًا.",
    connectedPrinter: "متصل",
    selectDiscoveredPrinter: "اختيار هذه الطابعة",
    lanSecurity: "لا تُحفظ بيانات الطابعة في الموقع أو المتصفح. عند اختيار الحفظ، يخزنها التطبيق داخل Keychain/Keystore فقط.",
    lanRequirements: "فعّل LAN Only ثم Developer Mode من شاشة X2D، واسمح لتطبيق LEVO بالوصول إلى الشبكة المحلية.",
    lanUnavailableWeb: "الاتصال المحلي غير مدعوم من Safari. افتح المشروع نفسه داخل تطبيق LEVO لاستخدام IP.",
    lanBridgeIncomplete: "التطبيق موجود، لكن إصدار جسر الطابعة لا يتيح الاتصال بعد.",
    sendLanPrint: "إرسال وبدء الطباعة",
    sendingLanPrint: "جارٍ نقل ملف الطباعة…",
    lanPrintQueued: "استلمت الطابعة المهمة وأكد التطبيق إدراجها للطباعة.",
    cloudTitle: "Bambu Cloud من الهاتف",
    cloudHelp: "صدّر مشروع 3MF، ارفعه Private إلى MakerWorld، ثم أكمل اختيار الطابعة وAMS داخل Bambu Handy.",
    usbTitle: "الطباعة من ذاكرة USB",
    usbHelp: "نزّل ملف Plate بعد التقطيع، انقله إلى ذاكرة USB بنظام FAT32 أو exFAT، ثم ابدأه من شاشة X2D.",
    usbStepOne: "نزّل ملف Plate إلى تطبيق الملفات.",
    usbStepTwo: "انسخه إلى ذاكرة USB باستخدام محول الهاتف.",
    usbStepThree: "أدخل الذاكرة في X2D وراجع الملف من شاشة الطابعة.",
    downloadForUsb: "تنزيل ملف USB",
    usbCompatibility: "ملف G-code الخام متاح الآن؛ حزمة Bambu .gcode.3mf ستبقى محجوبة حتى ينجح فحصها على X2D حقيقية.",
    notConnected: "غير متصل",
    partnerRequired: "يتطلب اعتماد Bambu Lab",
    connectStatus: "الربط السحابي المباشر مقيد رسميًا",
    connectStatusHelp: "تمنع منظومة التفويض الحالية بدء الطباعة السحابية من برنامج طرف ثالث غير معتمد. لن تطلب LEVO كلمة مرور حساب Bambu ولن تستخدم API خاصًا غير موثق.",
    connectNext: "لتفعيل طباعة سحابية مثل Bambu Handy يجب اعتماد LEVO كشريك والحصول على وثائق وبيانات التفويض الرسمية من Bambu Lab.",
    requestPartner: "طلب اعتماد LEVO",
    integrationDocs: "وثائق التكامل الرسمي",
    connectFallback: "المتاح الآن يعمل فعليًا: قطّع الملف ثم نزّل G-code أو 3MF وافتحه في Bambu Connect أو Bambu Studio.",
    printExport: "الطباعة والتصدير",
    printReady: "ملف الطباعة جاهز",
    printReadyHelp: "تم إنشاء G-code للـPlate الحالية ويمكن تنزيله أو مشاركته.",
    downloadGcode: "تنزيل ملف G-code",
    shareFile: "مشاركة الملف",
    shareUnavailable: "المشاركة غير مدعومة في هذا المتصفح؛ تم تنزيل الملف بدلًا منها.",
    exportAll: "تنزيل ملفات كل Plates",
    saveProject: "حفظ مشروع 3MF",
    phonePrint: "الطباعة من الهاتف",
    phonePrintHelp: "مسار يعمل بدون كمبيوتر أو اعتماد شريك: احفظ مشروع 3MF، ارفعه بشكل خاص إلى MakerWorld، ثم ابدأ الطباعة من Bambu Handy.",
    prepareForHandy: "تجهيز ملف Bambu Handy",
    prepareForHandyHelp: "يحفظ مشروع 3MF مع الطابعة والإعدادات الحالية في تطبيق الملفات.",
    handyFileReady: "تم حفظ ملف 3MF في التنزيلات. ارفعه الآن إلى MakerWorld واجعله Private.",
    openMakerWorld: "رفع خاص إلى MakerWorld",
    phoneStepOne: "احفظ ملف 3MF الجاهز على الهاتف.",
    phoneStepTwo: "ارفعه في MakerWorld واختر Private Model.",
    phoneStepThree: "افتح النموذج في Bambu Handy، راجع AMS ثم اضغط Print.",
    phoneRights: "ارفع فقط ملفًا تملكه أو لديك حق استخدامه، واجعله خاصًا إذا لم ترد نشره.",
    phoneConfirmation: "تأكيد الطابعة وAMS وبدء التسخين يتم داخل Bambu Handy؛ LEVO لا يدّعي بدء الطباعة قبل تأكيد التطبيق الرسمي.",
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
    mobilePrintHelp: "على الهاتف: استخدم مسار MakerWorld الخاص أعلاه، أو انقل G-code إلى USB/بطاقة ذاكرة مدعومة.",
    openBambuGuide: "فتح دليل Bambu Connect",
    printSafety: "راجع الطابعة، نوع Plate، الفوهة، الفلمنت وAMS قبل بدء أي طباعة.",
    printNotReady: "قم بتقطيع Plate أولًا لإنشاء ملف الطباعة.",
    imported: "تمت إضافة الملفات إلى المشروع.",
    formats: "STL · OBJ · 3MF · STEP · IGES · BREP · GLB · GLTF · FBX · DAE · 3DS · VRML · OFF · USDZ · KMZ · VTK · VTP · MD2 · AMF · PLY · ZIP",
    formatsShort: "STL · 3MF · STEP · GLB · FBX · ZIP +",
    importing: "جارٍ تحليل الملفات…",
    zipAnalyzing: "جارٍ تحليل ZIP وترتيب المجسمات…",
    zipArranged: "تم توزيع {models} مجسمًا تلقائيًا على {plates} Plate.",
    zipOverflow: "تعذر توزيع {count} مجسمًا لأن المحرر يدعم 9 Plates كحد أقصى؛ بقيت في موضع الاستيراد للمراجعة اليدوية.",
    zipOversized: "يوجد {count} مجسم أكبر من مساحة الطباعة؛ تم توسيطه ويحتاج تصغيرًا أو تقسيمًا.",
    emptyFile: "الملف فارغ:",
    importFailed: "تعذر استيراد الملف أو أن تنسيقه غير معروف.",
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
    directPrintHelp: "التصدير إلى Bambu Connect وBambu Studio يعمل. الطباعة السحابية المباشرة غير مفعلة حتى تمنح Bambu Lab اعتماد الشريك ووثائق التفويض الرسمية.",
    realEditor: "محرر Plate حقيقي",
    realEditorHelp: "تحريك، دوران، تكبير وتصغير، حذف، تكرار، تقسيم، Undo/Redo، دعم عدة Plates وحفظ 3MF.",
    layers: "طبقات",
    missingTools: "حدود المحرك الحالية",
    missingToolsHelp: "ترتيب ZIP على عدة Plates يعمل. Auto Orient وCut وBoolean والنص ثلاثي الأبعاد ما زالت غير منفذة في المحرك ولا يتم تزويرها.",
    newConfirm: "بدء مشروع جديد؟ ستفقد التعديلات غير المحفوظة.",
    fileLimit: "لا يوجد حد ثابت للحجم أو العدد داخل LEVO؛ الملفات تبقى على جهازك، والسعة الفعلية تعتمد على ذاكرة الجهاز والمتصفح.",
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
    connectPrinter: "Connect printer",
    connectTitle: "Printer connection methods",
    connectionIntro: "Choose local Wi-Fi, Bambu Cloud, or USB. LEVO exposes only capabilities that are genuinely available on this device.",
    lanMethod: "Same Wi-Fi",
    cloudMethod: "Cloud",
    usbMethod: "USB",
    lanTitle: "Local IP connection",
    lanHelp: "Works in the LEVO app when the phone and printer share a network and LAN Only plus Developer Mode are enabled.",
    appDetected: "LEVO app detected",
    websiteDetected: "You are using the LEVO website",
    appBridgeReady: "Local printer bridge ready",
    appBridgePreparing: "IP connection is available inside the LEVO app only. The website remains available for cloud and USB workflows.",
    printerIp: "Printer IP address",
    printerAccessCode: "Access Code",
    printerSerial: "Serial number (optional)",
    rememberPrinter: "Store printer securely in the app",
    discoverPrinters: "Find printers",
    discoveringPrinters: "Searching…",
    connectLan: "Secure connect",
    connectingLan: "Connecting…",
    disconnectLan: "Disconnect",
    noPrintersFound: "No printer was found. Enter the IP and Access Code manually.",
    connectedPrinter: "Connected",
    selectDiscoveredPrinter: "Select this printer",
    lanSecurity: "Printer credentials are never stored by the website or browser. If enabled, the app stores them only in Keychain/Keystore.",
    lanRequirements: "Enable LAN Only and Developer Mode on the X2D, then allow LEVO to access the local network.",
    lanUnavailableWeb: "Safari cannot make this local connection. Open the same project in the LEVO app to use IP printing.",
    lanBridgeIncomplete: "The app is present, but this printer-bridge build does not enable connection yet.",
    sendLanPrint: "Send and start print",
    sendingLanPrint: "Transferring the print job…",
    lanPrintQueued: "The printer acknowledged the job and the app confirmed it was queued.",
    cloudTitle: "Bambu Cloud from your phone",
    cloudHelp: "Export the 3MF project, upload it privately to MakerWorld, then confirm the printer and AMS in Bambu Handy.",
    usbTitle: "Print from USB storage",
    usbHelp: "Download the sliced plate, copy it to a FAT32 or exFAT USB drive, then start it from the X2D screen.",
    usbStepOne: "Download the plate file to Files.",
    usbStepTwo: "Copy it to USB storage with your phone adapter.",
    usbStepThree: "Insert the drive into the X2D and review the file on the printer screen.",
    downloadForUsb: "Download USB file",
    usbCompatibility: "Raw G-code is available now; Bambu .gcode.3mf packaging remains gated until it passes a real X2D hardware test.",
    notConnected: "Not connected",
    partnerRequired: "Bambu Lab approval required",
    connectStatus: "Direct cloud control is officially restricted",
    connectStatusHelp: "Bambu's current authorization system blocks print initiation from an unapproved third-party application. LEVO will not ask for your Bambu password or use an undocumented private API.",
    connectNext: "Handy-like cloud printing requires LEVO to become an approved partner and receive Bambu Lab's official authorization documentation and credentials.",
    requestPartner: "Request LEVO partnership",
    integrationDocs: "Official integration docs",
    connectFallback: "Available now and functional: slice, then download G-code or 3MF and open it in Bambu Connect or Bambu Studio.",
    printExport: "Print & export",
    printReady: "Print file ready",
    printReadyHelp: "G-code for the current plate is ready to download or share.",
    downloadGcode: "Download G-code",
    shareFile: "Share file",
    shareUnavailable: "File sharing is unavailable in this browser, so the file was downloaded instead.",
    exportAll: "Download every plate",
    saveProject: "Save 3MF project",
    phonePrint: "Print from your phone",
    phonePrintHelp: "A phone-only path with no computer or partner approval: save the 3MF project, upload it privately to MakerWorld, then start it in Bambu Handy.",
    prepareForHandy: "Prepare for Bambu Handy",
    prepareForHandyHelp: "Saves a 3MF project with the current printer and settings to Files.",
    handyFileReady: "The 3MF was saved to Downloads. Upload it to MakerWorld and keep it Private.",
    openMakerWorld: "Private upload to MakerWorld",
    phoneStepOne: "Save the prepared 3MF to your phone.",
    phoneStepTwo: "Upload it to MakerWorld as a Private Model.",
    phoneStepThree: "Open it in Bambu Handy, verify AMS, then tap Print.",
    phoneRights: "Only upload a file you own or have permission to use, and keep it private if you do not want to publish it.",
    phoneConfirmation: "Printer, AMS and heater confirmation happens in Bambu Handy; LEVO never claims printing started before the official app confirms it.",
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
    mobilePrintHelp: "On mobile, use the private MakerWorld path above, or move G-code to supported USB/removable storage.",
    openBambuGuide: "Open Bambu Connect guide",
    printSafety: "Verify printer, plate, nozzle, filament and AMS before starting any print.",
    printNotReady: "Slice the plate first to create a printable file.",
    imported: "Files were added to the project.",
    formats: "STL · OBJ · 3MF · STEP · IGES · BREP · GLB · GLTF · FBX · DAE · 3DS · VRML · OFF · USDZ · KMZ · VTK · VTP · MD2 · AMF · PLY · ZIP",
    formatsShort: "STL · 3MF · STEP · GLB · FBX · ZIP +",
    importing: "Analyzing files…",
    zipAnalyzing: "Analyzing ZIP and arranging models…",
    zipArranged: "Automatically arranged {models} models across {plates} plates.",
    zipOverflow: "{count} models could not be distributed because the editor supports up to 9 plates; they remain at their imported positions for manual review.",
    zipOversized: "{count} models exceed the build area; they were centered and need scaling or splitting.",
    emptyFile: "Empty file:",
    importFailed: "The file could not be imported or its format is unrecognized.",
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
    directPrintHelp: "Export to Bambu Connect and Bambu Studio works. Direct cloud printing stays disabled until Bambu Lab provides approved-partner authorization and documentation.",
    realEditor: "Real plate editor",
    realEditorHelp: "Move, rotate, scale, delete, duplicate, split, undo/redo, multi-plate editing and 3MF save.",
    layers: "layers",
    missingTools: "Current engine limits",
    missingToolsHelp: "ZIP multi-plate arrangement works. Auto Orient, Cut, Boolean and 3D text are not yet implemented by the engine and are not simulated.",
    newConfirm: "Start a new project? Unsaved edits will be lost.",
    fileLimit: "LEVO sets no fixed file-size or count cap; files stay on your device, while actual capacity depends on browser and device memory.",
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

function FileSelectControl({
  children,
  className,
  disabled = false,
  label,
  onFiles,
}: {
  children: ReactNode;
  className: string;
  disabled?: boolean;
  label: string;
  onFiles: (files: File[]) => void;
}) {
  return (
    <label className={`${className} file-select-control`} aria-disabled={disabled}>
      <input
        className="native-file-input"
        type="file"
        multiple
        disabled={disabled}
        aria-label={label}
        data-supported-formats={FILE_PICKER_ACCEPT}
        onClick={(event) => { event.currentTarget.value = ""; }}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (files.length) onFiles(files);
        }}
      />
      {children}
    </label>
  );
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

function templateText(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, String(value)), template);
}

function snapshotFootprint(snapshot: LevoSceneSnapshot) {
  const positions = snapshot.localPos;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index + 2 < positions.length; index += 3) {
    minX = Math.min(minX, positions[index]);
    maxX = Math.max(maxX, positions[index]);
    minY = Math.min(minY, positions[index + 1]);
    maxY = Math.max(maxY, positions[index + 1]);
    minZ = Math.min(minZ, positions[index + 2]);
    maxZ = Math.max(maxZ, positions[index + 2]);
  }
  const halfX = Math.max(0.005, (maxX - minX) * Math.abs(snapshot.scale.x) / 2);
  const halfY = Math.max(0.005, (maxY - minY) * Math.abs(snapshot.scale.y) / 2);
  const halfZ = Math.max(0.005, (maxZ - minZ) * Math.abs(snapshot.scale.z) / 2);
  const cx = Math.cos(snapshot.rot.x);
  const sx = Math.sin(snapshot.rot.x);
  const cy = Math.cos(snapshot.rot.y);
  const sy = Math.sin(snapshot.rot.y);
  const cz = Math.cos(snapshot.rot.z);
  const sz = Math.sin(snapshot.rot.z);
  const r11 = cy * cz;
  const r12 = sx * sy * cz - cx * sz;
  const r13 = cx * sy * cz + sx * sz;
  const r31 = -sy;
  const r32 = sx * cy;
  const r33 = cx * cy;
  return {
    id: snapshot.id,
    width: 2 * (Math.abs(r11) * halfX + Math.abs(r12) * halfY + Math.abs(r13) * halfZ),
    depth: 2 * (Math.abs(r31) * halfX + Math.abs(r32) * halfY + Math.abs(r33) * halfZ),
  };
}

function nextFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
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
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toolTrayOpen, setToolTrayOpen] = useState(false);
  const [handyProjectReady, setHandyProjectReady] = useState(false);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("lan");
  const [nativeEnvironment, setNativeEnvironment] = useState<LevoNativeEnvironment>({
    native: false,
    platform: "web",
    bridgeVersion: null,
    capabilities: {
      discovery: false,
      lanConnection: false,
      telemetry: false,
      packagePrintJob: false,
      fileTransfer: false,
      startPrint: false,
    },
  });
  const [lanAction, setLanAction] = useState<LanAction>("idle");
  const [lanIp, setLanIp] = useState("");
  const [lanAccessCode, setLanAccessCode] = useState("");
  const [lanSerial, setLanSerial] = useState("");
  const [rememberPrinter, setRememberPrinter] = useState(true);
  const [discoveredPrinters, setDiscoveredPrinters] = useState<LevoDiscoveredPrinter[]>([]);
  const [printerStatus, setPrinterStatus] = useState<LevoPrinterStatus>({ connected: false });
  const [lanMessage, setLanMessage] = useState("");
  const [lanTransferProgress, setLanTransferProgress] = useState(0);
  const [workspaceKey, setWorkspaceKey] = useState(0);
  const [Viewport, setViewport] = useState<React.ComponentType<ViewportProps> | null>(null);
  const [SettingsPanel, setSettingsPanel] = useState<React.ComponentType<SettingsPanelProps> | null>(null);
  const viewportMountRef = useRef<HTMLDivElement>(null);
  const shadowHostRef = useRef<HTMLElement | null>(null);
  const sidebarOpenRef = useRef(false);
  const plateCountRef = useRef(1);
  const archivePlanRef = useRef<ArchivePlan | null>(null);
  const arrangeTimerRef = useRef<number | null>(null);
  const importingRef = useRef(false);
  const profileRequestRef = useRef(0);
  const exportIntentRef = useRef<"bambu-handy" | "native-lan" | null>(null);
  const exportIntentTimerRef = useRef<number | null>(null);
  const machineRef = useRef<SlicerSettings>(fallbackSettings(PROFILES["bbl-x2d-04"]));
  const machineKeysRef = useRef<string[]>([]);
  const [artifactId] = useState(() => Symbol("levo-editor-gcode"));
  const profile = PROFILES[profileId];
  const t = TEXT[locale];
  const requestedPresetKey = `${profileId}:${quality}:${strength}:${support}`;
  const profileLoading = loadedPresetKey !== requestedPresetKey;

  useEffect(() => {
    let active = true;
    registerExtendedModelLoaders()
      .then(() => Promise.all([import("three-slicer/viewer"), import("three-slicer/components")]))
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
    let active = true;
    detectNativePrinterEnvironment().then((environment) => {
      if (!active) return;
      setNativeEnvironment(environment);
      if (!environment.native || !environment.capabilities.lanConnection) setPrinterStatus({ connected: false });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!printerStatus.connected || !nativeEnvironment.capabilities.telemetry) return;
    const refresh = () => {
      getNativePrinterStatus().then(setPrinterStatus)
        .catch(() => undefined);
    };
    const timer = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(timer);
  }, [nativeEnvironment.capabilities.telemetry, printerStatus.connected]);

  useEffect(() => { plateCountRef.current = plateCount; }, [plateCount]);

  useEffect(() => {
    sidebarOpenRef.current = sidebarOpen;
    shadowHostRef.current?.setAttribute("data-levo-sidebar", sidebarOpen ? "open" : "closed");
  }, [sidebarOpen]);

  useEffect(() => () => {
    GCODE_ARTIFACTS.delete(artifactId);
    if (arrangeTimerRef.current !== null) window.clearTimeout(arrangeTimerRef.current);
    if (exportIntentTimerRef.current !== null) window.clearTimeout(exportIntentTimerRef.current);
  }, [artifactId]);

  useEffect(() => {
    const container = viewportMountRef.current;
    if (!container) return;
    let attachedRoot: ShadowRoot | null = null;

    const detach = () => {
      attachedRoot = null;
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
    setHandyProjectReady(false);
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

  const dispatchFilesToEngine = useCallback(async (files: File[]) => {
    let input: HTMLInputElement | null = null;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      input = viewportRoot()?.querySelector<HTMLInputElement>('[data-testid="stl-input"]') ?? null;
      if (input) break;
      await nextFrame();
    }
    if (!input) throw new Error(t.actionUnavailable);
    const engineInput = input;
    engineInput.value = "";
    const dispatchChange = () => engineInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    try {
      if (typeof DataTransfer !== "function") throw new Error("DataTransfer is unavailable");
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(file);
      engineInput.files = transfer.files;
      if (engineInput.files?.length !== files.length) throw new Error("The browser rejected the transferred files");
      dispatchChange();
      return;
    } catch {
      const previousDescriptor = Object.getOwnPropertyDescriptor(engineInput, "files");
      try {
        Object.defineProperty(engineInput, "files", { configurable: true, value: files });
        dispatchChange();
      } finally {
        if (previousDescriptor) Object.defineProperty(engineInput, "files", previousDescriptor);
        else delete (engineInput as unknown as Record<string, unknown>).files;
      }
    }
  }, [t.actionUnavailable, viewportRoot]);

  const ensurePlateCount = useCallback(async (targetCount: number) => {
    const target = Math.max(1, Math.min(9, targetCount));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const root = viewportRoot();
      const current = root?.querySelectorAll('[data-testid^="plate-"]:not([data-testid="plate-add"]):not([data-testid="plate-del"]):not([data-testid="plate-bar"])').length ?? plateCountRef.current;
      if (current >= target) return current;
      const add = root?.querySelector<HTMLButtonElement>('[data-testid="plate-add"]');
      if (!add || add.disabled) return current;
      add.click();
      await nextFrame();
      await nextFrame();
    }
    return plateCountRef.current;
  }, [viewportRoot]);

  const arrangeArchive = useCallback(async () => {
    const plan = archivePlanRef.current;
    if (!plan) return;
    const api = window.__vpApi?.();
    if (!api) return;
    const snapshots = api.sceneSnapshot().filter((snapshot) => !plan.beforeIds.has(snapshot.id));
    if (!snapshots.length) return;
    archivePlanRef.current = null;
    const packing = packModelsAcrossPlates(
      snapshots.map(snapshotFootprint),
      profile.bedWidth,
      profile.bedDepth,
      plan.startPlate,
      plan.maxPlateCount,
    );
    await ensurePlateCount(Math.max(plateCountRef.current, plan.startPlate + packing.platesUsed));
    for (const placement of packing.placements) {
      api.placeObjectOnPlate(placement.id, placement.plate, placement.offsetX, placement.offsetY);
    }
    viewportRoot()?.querySelector<HTMLButtonElement>(`[data-testid="plate-${plan.startPlate}"]`)?.click();
    api.frame();
    const messages = [templateText(t.zipArranged, { models: snapshots.length, plates: packing.platesUsed })];
    if (packing.oversizedCount) messages.push(templateText(t.zipOversized, { count: packing.oversizedCount }));
    if (packing.overflowCount) messages.push(templateText(t.zipOverflow, { count: packing.overflowCount }));
    setNotice(messages.join(" "));
    setImportProgress(null);
    setStatus("editing");
  }, [ensurePlateCount, profile.bedDepth, profile.bedWidth, t.zipArranged, t.zipOverflow, t.zipOversized, viewportRoot]);

  const scheduleArchiveArrangement = useCallback(() => {
    if (!archivePlanRef.current) return;
    if (arrangeTimerRef.current !== null) window.clearTimeout(arrangeTimerRef.current);
    arrangeTimerRef.current = window.setTimeout(() => {
      arrangeTimerRef.current = null;
      void arrangeArchive();
    }, 260);
  }, [arrangeArchive]);

  const importSelectedFiles = useCallback(async (rawFiles: File[]) => {
    if (!rawFiles.length || importingRef.current) return;
    importingRef.current = true;
    setError("");
    setNotice("");
    setToolTrayOpen(false);
    setImportProgress({ label: t.importing, ratio: 0, extracted: 0 });
    let archivePlanned = false;
    try {
      const modelFiles: File[] = [];
      let hasArchive = false;
      for (const rawFile of rawFiles) {
        if (!rawFile.size) throw new Error(`${t.emptyFile} ${rawFile.name}`);
        const file = await normalizeModelFile(rawFile);
        if (fileExtension(file.name) !== "zip") {
          modelFiles.push(file);
          continue;
        }
        hasArchive = true;
        setImportProgress({ label: t.zipAnalyzing, ratio: 0, extracted: modelFiles.length });
        const extracted = await extractModelArchive(file, (archiveProgress) => {
          setImportProgress({
            label: t.zipAnalyzing,
            ratio: archiveProgress.compressedTotal ? archiveProgress.compressedRead / archiveProgress.compressedTotal : 0,
            extracted: archiveProgress.extractedFiles,
          });
        });
        modelFiles.push(...extracted);
      }
      if (!modelFiles.length) throw new Error(t.importFailed);
      if (hasArchive) {
        archivePlanned = true;
        archivePlanRef.current = {
          beforeIds: new Set(objects.map((object) => object.id)),
          startPlate: objects.length ? (plateCountRef.current < 9 ? plateCountRef.current : selectedPlate) : 0,
          maxPlateCount: objects.length && plateCountRef.current >= 9 ? selectedPlate + 1 : 9,
        };
        setImportProgress((current) => ({ label: t.zipAnalyzing, ratio: 1, extracted: current?.extracted ?? modelFiles.length }));
      }
      await dispatchFilesToEngine(modelFiles);
      if (hasArchive && !window.__vpApi?.()) {
        archivePlanRef.current = null;
        archivePlanned = false;
        setNotice(t.imported);
        setImportProgress(null);
      } else if (!hasArchive) {
        setNotice(t.imported);
        setImportProgress(null);
      }
    } catch (reason: unknown) {
      archivePlanRef.current = null;
      archivePlanned = false;
      setImportProgress(null);
      setError(reason instanceof Error ? reason.message : t.importFailed);
      setStatus("error");
    } finally {
      importingRef.current = false;
      if (!archivePlanned) setImportProgress(null);
    }
  }, [dispatchFilesToEngine, objects, selectedPlate, t.emptyFile, t.importFailed, t.imported, t.importing, t.zipAnalyzing]);

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

  const discoverLan = useCallback(async () => {
    if (!nativeEnvironment.capabilities.discovery || lanAction !== "idle") return;
    setLanAction("discovering");
    setLanMessage("");
    try {
      const printers = await discoverNativePrinters();
      setDiscoveredPrinters(printers);
      if (!printers.length) setLanMessage(t.noPrintersFound);
    } catch (reason: unknown) {
      setLanMessage(reason instanceof Error ? reason.message : t.actionUnavailable);
    } finally {
      setLanAction("idle");
    }
  }, [lanAction, nativeEnvironment.capabilities.discovery, t.actionUnavailable, t.noPrintersFound]);

  const connectLan = useCallback(async () => {
    if (!nativeEnvironment.capabilities.lanConnection || lanAction !== "idle") return;
    setLanAction("connecting");
    setLanMessage("");
    try {
      const connected = await connectNativePrinter({
        ip: lanIp,
        accessCode: lanAccessCode,
        serial: lanSerial.trim() || undefined,
        remember: rememberPrinter,
      });
      setPrinterStatus(connected);
      if (connected.connected) {
        setLanAccessCode("");
        setLanMessage(`${t.connectedPrinter}: ${connected.printer?.name ?? connected.printer?.ip ?? lanIp}`);
      }
    } catch (reason: unknown) {
      setPrinterStatus({ connected: false });
      setLanMessage(reason instanceof Error ? reason.message : t.actionUnavailable);
    } finally {
      setLanAction("idle");
    }
  }, [lanAccessCode, lanAction, lanIp, lanSerial, nativeEnvironment.capabilities.lanConnection, rememberPrinter, t.actionUnavailable, t.connectedPrinter]);

  const disconnectLan = useCallback(async () => {
    if (lanAction !== "idle") return;
    setLanAction("connecting");
    try {
      setPrinterStatus(await disconnectNativePrinter());
      setLanMessage("");
    } catch (reason: unknown) {
      setLanMessage(reason instanceof Error ? reason.message : t.actionUnavailable);
    } finally {
      setLanAction("idle");
    }
  }, [lanAction, t.actionUnavailable]);

  const transmitNativePrint = useCallback(async (projectBlob: Blob) => {
    const gcode = GCODE_ARTIFACTS.get(artifactId)?.get(selectedPlate) ?? "";
    if (!gcode) { setLanMessage(t.printNotReady); return; }
    const required = nativeEnvironment.capabilities;
    if (!printerStatus.connected || !required.packagePrintJob || !required.fileTransfer || !required.startPrint) {
      setLanMessage(t.lanBridgeIncomplete);
      return;
    }

    const baseName = `LEVO-${profile.shortName}-plate-${selectedPlate + 1}`;
    const project = new File([projectBlob], `${baseName}.3mf`, { type: "model/3mf" });
    const gcodeFile = new File([gcode], `${baseName}.gcode`, { type: "text/x-gcode" });
    setLanAction("transferring");
    setLanTransferProgress(0);
    setLanMessage("");
    try {
      await sendNativePrintJob({
        project,
        gcode: gcodeFile,
        metadata: {
          name: baseName,
          profileId: profile.id,
          printerModel: profile.model,
          plate: selectedPlate + 1,
          nozzleDiameter: profile.nozzle,
        },
        onProgress: setLanTransferProgress,
      });
      setLanMessage(t.lanPrintQueued);
    } catch (reason: unknown) {
      setLanMessage(reason instanceof Error ? reason.message : t.actionUnavailable);
    } finally {
      setLanAction("idle");
    }
  }, [artifactId, nativeEnvironment.capabilities, printerStatus.connected, profile, selectedPlate, t.actionUnavailable, t.lanBridgeIncomplete, t.lanPrintQueued, t.printNotReady]);

  const handleViewportExport = useCallback<NonNullable<ViewportProps["onExport"]>>((file, filename) => {
    const intent = exportIntentRef.current;
    if (!intent || !filename.toLowerCase().endsWith(".3mf")) return;
    exportIntentRef.current = null;
    if (exportIntentTimerRef.current !== null) {
      window.clearTimeout(exportIntentTimerRef.current);
      exportIntentTimerRef.current = null;
    }
    if (intent === "native-lan") {
      void transmitNativePrint(file);
    } else {
      const phoneFilename = `LEVO-${profile.shortName}-Bambu-Handy.3mf`;
      downloadBlob(file, phoneFilename);
      setHandyProjectReady(true);
      setNotice(t.handyFileReady);
    }
    return true;
  }, [profile.shortName, t.handyFileReady, transmitNativePrint]);

  const prepareForBambuHandy = useCallback(() => {
    setHandyProjectReady(false);
    exportIntentRef.current = "bambu-handy";
    if (!clickControl("save-project", true)) {
      exportIntentRef.current = null;
      setNotice(t.actionUnavailable);
      return;
    }
    if (exportIntentTimerRef.current !== null) window.clearTimeout(exportIntentTimerRef.current);
    exportIntentTimerRef.current = window.setTimeout(() => {
      if (exportIntentRef.current !== "bambu-handy") return;
      exportIntentRef.current = null;
      exportIntentTimerRef.current = null;
      setNotice(t.actionUnavailable);
    }, 30_000);
  }, [clickControl, t.actionUnavailable]);

  const prepareNativePrint = useCallback(() => {
    if (lanAction !== "idle") return;
    exportIntentRef.current = "native-lan";
    if (!clickControl("save-project", true)) {
      exportIntentRef.current = null;
      setLanMessage(t.actionUnavailable);
      return;
    }
    if (exportIntentTimerRef.current !== null) window.clearTimeout(exportIntentTimerRef.current);
    exportIntentTimerRef.current = window.setTimeout(() => {
      if (exportIntentRef.current !== "native-lan") return;
      exportIntentRef.current = null;
      exportIntentTimerRef.current = null;
      setLanMessage(t.actionUnavailable);
    }, 30_000);
  }, [clickControl, lanAction, t.actionUnavailable]);

  const prepareAction = useCallback((testId: string) => {
    if (clickControl(testId, true)) return;
    clickControl("mode-prepare", true);
    window.requestAnimationFrame(() => {
      if (!clickControl(testId, true)) setNotice(t.actionUnavailable);
    });
  }, [clickControl, t.actionUnavailable]);

  const handlePickedFiles = useCallback((files: File[]) => {
    setNotice("");
    setToolTrayOpen(false);
    void importSelectedFiles(files);
  }, [importSelectedFiles]);

  const handleDropFiles = useCallback((event: React.DragEvent<HTMLElement>) => {
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void importSelectedFiles(files);
  }, [importSelectedFiles]);

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
      if (archivePlanRef.current && event.value.some((object) => !archivePlanRef.current?.beforeIds.has(object.id))) {
        scheduleArchiveArrangement();
      }
      if (event.value.length) setStatus((current) => current === "slicing" ? current : "editing");
    } else if (event.type === "plateCount") {
      plateCountRef.current = event.value;
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
  }, [scheduleArchiveArrangement]);

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
    setImportProgress(null);
    archivePlanRef.current = null;
    if (arrangeTimerRef.current !== null) {
      window.clearTimeout(arrangeTimerRef.current);
      arrangeTimerRef.current = null;
    }
    setSidebarOpen(false);
    setToolTrayOpen(false);
    setHandyProjectReady(false);
    exportIntentRef.current = null;
    if (exportIntentTimerRef.current !== null) {
      window.clearTimeout(exportIntentTimerRef.current);
      exportIntentTimerRef.current = null;
    }
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
  const canLanConnect = nativeEnvironment.native && nativeEnvironment.capabilities.lanConnection;
  const canLanPrint = canLanConnect
    && printerStatus.connected
    && nativeEnvironment.capabilities.packagePrintJob
    && nativeEnvironment.capabilities.fileTransfer
    && nativeEnvironment.capabilities.startPrint
    && printReady;
  const sheetTitle = sheet === "about" ? t.about : sheet === "print" ? t.printExport : sheet === "connect" ? t.connectTitle : t.settings;

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
          <FileSelectControl className="import-action" label={t.files} disabled={!Viewport || Boolean(importProgress)} onFiles={handlePickedFiles}><Icon name="file"/><span>{t.files}</span></FileSelectControl>
          <button className="new-project-action" onClick={newProject} title={t.newProject}><Icon name="plus"/><span>{t.newProject}</span></button>
          {printReady && <button className="header-print-action" onClick={openPrintCenter}><Icon name="print"/><span>{t.print}</span></button>}
          <button className="connect-action" onClick={() => setSheet("connect")} title={t.connectPrinter}><Icon name="print"/><span>{t.connectPrinter}</span></button>
          <button className="profile-button" onClick={() => setSheet("setup")} title={t.settings}><b>{profile.shortName}</b><small>{QUALITY[quality].layer.toFixed(2)}</small></button>
          <button className={`panel-button ${sidebarOpen ? "active" : ""}`} onClick={() => setSidebarOpen((value) => !value)} aria-label={t.panel}><Icon name="layers"/></button>
          <button onClick={() => setSheet("about")} aria-label={t.about}><Icon name="info"/></button>
          <button className="language-button" onClick={() => setLocale(locale === "ar" ? "en" : "ar")} aria-label="Change language">{locale === "ar" ? "EN" : "ع"}</button>
        </div>
      </header>

      <section
        className="editor-area"
        aria-busy={Boolean(importProgress)}
        onDragOverCapture={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onDropCapture={handleDropFiles}
      >
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
              onExport={handleViewportExport}
            />
          ) : (
            <div className="editor-loader" aria-live="polite"><span/><strong>{t.loading}</strong><small>{profile.shortName} · {profile.bed}</small></div>
          )}
        </div>

        {Viewport && !objects.length && status !== "error" && <section className="empty-upload-card" aria-label={t.files}>
          <span className="empty-upload-icon"><Icon name="file"/></span>
          <strong>{t.files}</strong>
          <p>{t.formatsShort}</p>
          <FileSelectControl className="empty-upload-action" label={t.add} disabled={Boolean(importProgress)} onFiles={handlePickedFiles}><Icon name="plus"/><span>{t.add}</span></FileSelectControl>
          <small>{t.fileLimit}</small>
        </section>}

        {importProgress && <div className="import-progress" role="status" aria-live="polite">
          <span className="import-spinner"/>
          <div><strong>{importProgress.label}</strong><small>{importProgress.extracted ? `${importProgress.extracted} ${t.objects}` : t.formatsShort}</small></div>
          <progress max="1" value={Math.max(0, Math.min(1, importProgress.ratio))}/>
        </div>}

        {(error || notice) && <div className={`editor-message ${error ? "error" : "notice"}`} role={error ? "alert" : "status"}>
          <span>{error || notice}</span><button onClick={() => { setError(""); setNotice(""); if (status === "error") setStatus("editing"); }} aria-label={t.close}><Icon name="close"/></button>
        </div>}

        {toolTrayOpen && <section className="mobile-tooltray" aria-label={t.editTools}>
          <header><span><strong>{t.editTools}</strong><small>{t.editToolsHelp}</small></span><button onClick={() => setToolTrayOpen(false)} aria-label={t.close}><Icon name="close"/></button></header>
          <div className="mobile-toolgrid">
            <FileSelectControl className="tool-upload-action" label={t.add} disabled={!Viewport || Boolean(importProgress)} onFiles={handlePickedFiles}><Icon name="file"/><span>{t.add}</span></FileSelectControl>
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
          <FileSelectControl className="mobile-nav-item" label={t.files} disabled={!Viewport || Boolean(importProgress)} onFiles={handlePickedFiles}><Icon name="file"/><span>{t.files}</span></FileSelectControl>
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
            <section className={`phone-print-card ${handyProjectReady ? "ready" : ""}`} aria-live="polite">
              <header><span><Icon name="print"/></span><div><strong>{t.phonePrint}</strong><p>{t.phonePrintHelp}</p></div></header>
              <ol className="phone-print-steps">
                <li><b>1</b><span>{t.phoneStepOne}</span></li>
                <li><b>2</b><span>{t.phoneStepTwo}</span></li>
                <li><b>3</b><span>{t.phoneStepThree}</span></li>
              </ol>
              <div className="phone-print-actions">
                <button onClick={prepareForBambuHandy}><Icon name="save"/><span><b>{t.prepareForHandy}</b><small>{t.prepareForHandyHelp}</small></span></button>
                {handyProjectReady && <a href="https://makerworld.com/en/upload" target="_blank" rel="noreferrer"><span>{t.openMakerWorld}</span><Icon name="external"/></a>}
              </div>
              <p className="phone-print-confirmation"><Icon name="check"/><span>{t.phoneConfirmation}</span></p>
              <small className="phone-print-rights">{t.phoneRights}</small>
            </section>
            <div className="print-handoff">
              <span className="handoff-icon"><Icon name="print"/></span>
              <div><strong>{t.officialPrint}</strong><p>{t.officialPrintHelp}</p><p>{t.mobilePrintHelp}</p></div>
              <a href="https://wiki.bambulab.com/en/software/bambu-connect" target="_blank" rel="noreferrer"><span>{t.openBambuGuide}</span><Icon name="external"/></a>
            </div>
            <button className="connection-details-button" onClick={() => setSheet("connect")}><Icon name="print"/><span>{t.connectPrinter}</span><Icon name="external"/></button>
            <p className="print-safety"><Icon name="info"/><span>{t.printSafety}</span></p>
          </div> : sheet === "connect" ? <div className="sheet-body connect-body">
            <p className="connection-intro">{t.connectionIntro}</p>
            <div className="connection-method-tabs" role="tablist" aria-label={t.connectTitle}>
              {(["lan", "cloud", "usb"] as ConnectionMode[]).map((mode) => <button
                key={mode}
                role="tab"
                aria-selected={connectionMode === mode}
                className={connectionMode === mode ? "active" : ""}
                onClick={() => setConnectionMode(mode)}
              ><Icon name={mode === "lan" ? "print" : mode === "cloud" ? "share" : "save"}/><span>{mode === "lan" ? t.lanMethod : mode === "cloud" ? t.cloudMethod : t.usbMethod}</span></button>)}
            </div>

            {connectionMode === "lan" ? <section className="connection-method-panel lan-method-panel">
              <header>
                <span className={canLanConnect ? "available" : "unavailable"}><i/></span>
                <div><strong>{t.lanTitle}</strong><small>{nativeEnvironment.native ? t.appDetected : t.websiteDetected} · {nativeEnvironment.platform.toUpperCase()}</small></div>
              </header>
              <p>{t.lanHelp}</p>
              <div className={`native-bridge-state ${canLanConnect ? "ready" : "blocked"}`}>
                <Icon name={canLanConnect ? "check" : "info"}/>
                <span><b>{canLanConnect ? t.appBridgeReady : t.appBridgePreparing}</b><small>{!nativeEnvironment.native ? t.lanUnavailableWeb : !canLanConnect ? t.lanBridgeIncomplete : t.lanRequirements}</small></span>
              </div>

              {canLanConnect && <>
                <button className="discover-printers-button" onClick={() => void discoverLan()} disabled={lanAction !== "idle" || !nativeEnvironment.capabilities.discovery}>
                  <Icon name="fit"/><span>{lanAction === "discovering" ? t.discoveringPrinters : t.discoverPrinters}</span>
                </button>
                {discoveredPrinters.length > 0 && <div className="discovered-printers">
                  {discoveredPrinters.map((printer) => <button key={printer.id} onClick={() => { setLanIp(printer.ip); setLanSerial(printer.serial ?? ""); }}>
                    <span><b>{printer.name}</b><small>{printer.model ?? profile.model} · {printer.ip}</small></span><em>{t.selectDiscoveredPrinter}</em>
                  </button>)}
                </div>}

                {!printerStatus.connected ? <form className="lan-connection-form" onSubmit={(event) => { event.preventDefault(); void connectLan(); }}>
                  <label><span>{t.printerIp}</span><input dir="ltr" inputMode="decimal" autoCapitalize="none" autoCorrect="off" value={lanIp} onChange={(event) => setLanIp(event.target.value)} placeholder="192.168.1.120" required/></label>
                  <label><span>{t.printerAccessCode}</span><input dir="ltr" type="password" value={lanAccessCode} onChange={(event) => setLanAccessCode(event.target.value)} autoComplete="off" required/></label>
                  <label><span>{t.printerSerial}</span><input dir="ltr" autoCapitalize="characters" autoCorrect="off" value={lanSerial} onChange={(event) => setLanSerial(event.target.value)} /></label>
                  <label className="remember-printer"><input type="checkbox" checked={rememberPrinter} onChange={(event) => setRememberPrinter(event.target.checked)}/><span>{t.rememberPrinter}</span></label>
                  <button className="connect-lan-button" type="submit" disabled={lanAction !== "idle"}><Icon name="print"/><span>{lanAction === "connecting" ? t.connectingLan : t.connectLan}</span></button>
                </form> : <div className="connected-printer-card">
                  <span><Icon name="check"/></span>
                  <div><b>{t.connectedPrinter}</b><strong>{printerStatus.printer?.name ?? printerStatus.printer?.ip ?? lanIp}</strong><small>{printerStatus.state ?? "idle"}</small></div>
                  <button onClick={() => void disconnectLan()} disabled={lanAction !== "idle"}>{t.disconnectLan}</button>
                </div>}

                {printerStatus.connected && <button className="lan-print-button" onClick={prepareNativePrint} disabled={!canLanPrint || lanAction !== "idle"}>
                  <Icon name="print"/><span><b>{lanAction === "transferring" ? t.sendingLanPrint : t.sendLanPrint}</b><small>{profile.shortName} · {t.plate} {selectedPlate + 1}</small></span>
                </button>}
                {lanAction === "transferring" && <progress className="lan-transfer-progress" value={lanTransferProgress} max={1}/>}
                {lanMessage && <p className="lan-message" role="status">{lanMessage}</p>}
              </>}
              <p className="lan-security"><Icon name="info"/><span>{t.lanSecurity}</span></p>
              <a className="method-doc-link" href="https://wiki.bambulab.com/en/software/third-party-integration" target="_blank" rel="noreferrer"><span>{t.integrationDocs}</span><Icon name="external"/></a>
            </section> : connectionMode === "cloud" ? <section className="connection-method-panel cloud-method-panel">
              <header><span className="available"><i/></span><div><strong>{t.cloudTitle}</strong><small>{t.phonePrint}</small></div></header>
              <p>{t.cloudHelp}</p>
              <ol className="phone-print-steps">
                <li><b>1</b><span>{t.phoneStepOne}</span></li>
                <li><b>2</b><span>{t.phoneStepTwo}</span></li>
                <li><b>3</b><span>{t.phoneStepThree}</span></li>
              </ol>
              <div className="phone-print-actions">
                <button onClick={prepareForBambuHandy} disabled={!objects.length}><Icon name="save"/><span><b>{t.prepareForHandy}</b><small>{t.prepareForHandyHelp}</small></span></button>
                {handyProjectReady && <a href="https://makerworld.com/en/upload" target="_blank" rel="noreferrer"><span>{t.openMakerWorld}</span><Icon name="external"/></a>}
              </div>
              <p className="phone-print-confirmation"><Icon name="check"/><span>{t.phoneConfirmation}</span></p>
              <div className="connection-policy"><Icon name="info"/><div><strong>{t.connectStatus}</strong><p>{t.connectStatusHelp}</p><p>{t.connectNext}</p></div></div>
            </section> : <section className="connection-method-panel usb-method-panel">
              <header><span className="available"><i/></span><div><strong>{t.usbTitle}</strong><small>FAT32 · exFAT</small></div></header>
              <p>{t.usbHelp}</p>
              <ol className="phone-print-steps">
                <li><b>1</b><span>{t.usbStepOne}</span></li>
                <li><b>2</b><span>{t.usbStepTwo}</span></li>
                <li><b>3</b><span>{t.usbStepThree}</span></li>
              </ol>
              <button className="usb-download-button" onClick={downloadCurrentGcode} disabled={!printReady}><Icon name="save"/><span><b>{t.downloadForUsb}</b><small>{printReady ? `${profile.shortName} · ${t.plate} ${selectedPlate + 1}` : t.printNotReady}</small></span></button>
              <p className="usb-compatibility"><Icon name="info"/><span>{t.usbCompatibility}</span></p>
            </section>}
          </div> : <div className="sheet-body about-body">
            <div className="capability verified"><i/><span><strong>{t.realEditor}</strong><small>{t.realEditorHelp}</small></span></div>
            <div className="capability partial"><i/><span><strong>{t.missingTools}</strong><small>{t.missingToolsHelp}</small></span></div>
            <div className="capability partial"><i/><span><strong>{t.directPrint}</strong><small>{t.directPrintHelp}</small></span></div>
            <button className="connection-details-button" onClick={() => setSheet("connect")}><Icon name="print"/><span>{t.connectPrinter}</span><Icon name="external"/></button>
            <a href="https://github.com/aliamer229/Levo_slicer" target="_blank" rel="noreferrer">GitHub · AGPL source</a>
          </div>}
        </section>
      </div>}
    </main>
  );
}
