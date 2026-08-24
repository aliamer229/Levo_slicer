"use client";

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SlicerSettings } from "three-slicer";
import type { ViewportEvent, ViewportProps } from "three-slicer/viewer";
import type { SettingsPanelProps } from "three-slicer/components";

type Locale = "ar" | "en";
type AppStage = "empty" | "modelReady" | "slicing" | "sliceReady" | "preview" | "error";
type Sheet = "setup" | "printer" | "advanced" | "about" | null;
type ProfileId = "bbl-x2d-04" | "bbl-h2d-04";
type QualityId = "fine" | "standard" | "draft";
type StrengthId = "light" | "standard" | "strong";

/** Keeps heavyweight generated artifacts outside React's serializable state. */
const GCODE_ARTIFACTS = new Map<symbol, string>();

interface PrinterProfile {
  id: ProfileId;
  label: string;
  model: string;
  settingId: string;
  width: number;
  depth: number;
  height: number;
  nozzle: number;
  printableArea: [number, number][];
}

interface SliceStats {
  layers?: number;
  filament_mm?: number;
  time_estimate?: number;
  path_segments?: number;
  over_bed?: boolean;
  over_bed_model?: boolean;
  over_bed_x?: number;
  over_bed_y?: number;
  over_bed_z?: number;
  [key: string]: unknown;
}

interface SlicePayload {
  plate: number;
  stats: SliceStats;
  gcode: string;
}

type SliceSummary = Omit<SlicePayload, "gcode">;

interface LevoViewportProps extends ViewportProps {
  /** Runtime import input supported by three-slicer 0.2.2 but omitted from its published declarations. */
  files?: File[];
}

const PROFILES: Record<ProfileId, PrinterProfile> = {
  "bbl-x2d-04": {
    id: "bbl-x2d-04",
    label: "X2D",
    model: "Bambu Lab X2D",
    settingId: "GM045",
    width: 256,
    depth: 256,
    height: 261,
    nozzle: 0.4,
    printableArea: [[0, 0], [256, 0], [256, 256], [0, 256]],
  },
  "bbl-h2d-04": {
    id: "bbl-h2d-04",
    label: "H2D",
    model: "Bambu Lab H2D",
    settingId: "GM033",
    width: 350,
    depth: 320,
    height: 325,
    nozzle: 0.4,
    printableArea: [[0, 0], [350, 0], [350, 320], [0, 320]],
  },
};

const QUALITY: Record<QualityId, { label: string; layer: number }> = {
  fine: { label: "Fine", layer: 0.12 },
  standard: { label: "Standard", layer: 0.2 },
  draft: { label: "Draft", layer: 0.28 },
};

const STRENGTH: Record<StrengthId, { label: string; infill: number; walls: number }> = {
  light: { label: "Light", infill: 10, walls: 2 },
  standard: { label: "Standard", infill: 15, walls: 2 },
  strong: { label: "Strong", infill: 25, walls: 3 },
};

const TEXT = {
  ar: {
    project: "مشروع جديد", add: "أضف مجسمًا ثلاثي الأبعاد", addShort: "إضافة مجسم",
    local: "تتم المعالجة محليًا على هذا الجهاز", formats: "STL • OBJ • 3MF • AMF • PLY",
    slice: "تقطيع", slicing: "جارٍ التقطيع…", cancel: "إلغاء", settings: "الإعدادات",
    advanced: "الإعدادات المتقدمة", preview: "معاينة المسار", result: "جاهز للتنزيل",
    download: "تنزيل G-code", print: "طباعة مباشرة",
    printDisabled: "تتطلب حزمة Bambu موثقة وLEVO Bridge", quality: "الجودة", strength: "القوة",
    support: "الدعامات", material: "الخامة", printer: "الطابعة", profileOnly: "ملف تعريف فقط",
    noPrinter: "لا توجد طابعة متصلة", noPrinterHelp: "يمكنك التقطيع والتنزيل دون اتصال الطابعة.",
    off: "إيقاف", auto: "تلقائي", apply: "تم", layers: "طبقة", grams: "غرام",
    time: "الوقت المتوقع", rawWarning: "ملف G-code خام للمعاينة والتنزيل فقط؛ الطباعة المباشرة معطّلة حفاظًا على السلامة.",
    chooseAnother: "اختيار ملف آخر", source: "المصدر المفتوح", about: "حول الحالة الحالية",
    honest: "السلايسر حقيقي داخل المتصفح. ربط Bambu وAMS والطباعة المباشرة غير مفعّل حتى اكتمال التحقق على طابعة حقيقية.",
    error: "تعذر تجهيز هذا الملف", retry: "حاول مرة أخرى", close: "إغلاق",
    stale: "تغيّرت الإعدادات — أعد التقطيع",
  },
  en: {
    project: "New project", add: "Add a 3D model", addShort: "Add model",
    local: "Processed locally on this device", formats: "STL • OBJ • 3MF • AMF • PLY",
    slice: "Slice", slicing: "Slicing…", cancel: "Cancel", settings: "Settings",
    advanced: "Advanced settings", preview: "Toolpath preview", result: "Ready to download",
    download: "Download G-code", print: "Direct print",
    printDisabled: "Requires a verified Bambu package and LEVO Bridge", quality: "Quality", strength: "Strength",
    support: "Support", material: "Material", printer: "Printer", profileOnly: "Profile only",
    noPrinter: "No printer connected", noPrinterHelp: "Slicing and download stay available without a printer.",
    off: "Off", auto: "Auto", apply: "Done", layers: "layers", grams: "g", time: "Estimated time",
    rawWarning: "Raw G-code is available for preview and download only. Direct print is disabled for safety.",
    chooseAnother: "Choose another file", source: "Open source", about: "Current capability status",
    honest: "Browser slicing is real. Bambu connectivity, AMS and direct print remain disabled until real-printer verification is complete.",
    error: "This file could not be prepared", retry: "Try again", close: "Close",
    stale: "Settings changed — slice again",
  },
} as const;

const HIDDEN_PANELS: NonNullable<ViewportProps["panels"]> = {
  topBar: false, gizmoRail: false, objectToolbar: false, paintPanel: false, statsCard: false,
  plateBar: false, emptyHint: false, status: false, sidebar: false, printerCard: false,
  filamentCard: false, objectList: false, previewControls: false, processCard: false,
  sliceBar: false, towerCard: false, bedWarn: true,
};

function Icon({ name }: { name: "plus" | "sliders" | "chevron" | "cube" | "download" | "eye" | "close" }) {
  const paths = {
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    sliders: <><path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2"/><path d="M10 17h10"/><circle cx="8" cy="17" r="2"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.3 7.7 7.7 4.4 7.7-4.4"/><path d="M12 12.1V21"/></>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
    eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
    close: <><path d="m6 6 12 12"/><path d="m18 6-12 12"/></>,
  };
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function buildSettings(profile: PrinterProfile, quality: QualityId, strength: StrengthId, support: boolean): SlicerSettings {
  const strengthPreset = STRENGTH[strength];
  return {
    printer_model: profile.model,
    printer_settings_id: `${profile.model} ${profile.nozzle} nozzle`,
    nozzle_diameter: [profile.nozzle],
    printable_area: profile.printableArea,
    printable_height: profile.height,
    layer_height: QUALITY[quality].layer,
    initial_layer_print_height: 0.2,
    filament_type: ["PLA"],
    filament_diameter: [1.75],
    filament_flow_ratio: [0.98],
    filament_max_volumetric_speed: [12],
    nozzle_temperature: [220],
    nozzle_temperature_initial_layer: [220],
    eng_plate_temp: [55],
    eng_plate_temp_initial_layer: [55],
    sparse_infill_density: strengthPreset.infill,
    wall_loops: strengthPreset.walls,
    enable_support: support,
    support_type: "normal(auto)",
    support_style: "default",
    default_acceleration: profile.id === "bbl-x2d-04" ? 10000 : 8000,
    initial_layer_speed: 50,
    inner_wall_speed: 300,
    outer_wall_speed: 200,
    sparse_infill_speed: profile.id === "bbl-x2d-04" ? 270 : 350,
    travel_speed: 1000,
  };
}

function formatTime(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(1, Math.round((seconds % 3600) / 60));
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function filamentWeight(lengthMm?: number) {
  if (!lengthMm || !Number.isFinite(lengthMm)) return null;
  const radiusMm = 1.75 / 2;
  const volumeCm3 = (Math.PI * radiusMm * radiusMm * lengthMm) / 1000;
  return volumeCm3 * 1.24;
}

function validateModelFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const allowed = new Set(["stl", "obj", "3mf", "amf", "ply"]);
  if (!allowed.has(extension)) return "Unsupported file type.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > 80 * 1024 * 1024) return "This model is larger than the 80 MB mobile safety limit.";
  return null;
}

export default function SlicerClient() {
  const [locale, setLocale] = useState<Locale>("ar");
  const [stage, setStage] = useState<AppStage>("empty");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [model, setModel] = useState<File | null>(null);
  const [profileId, setProfileId] = useState<ProfileId>("bbl-x2d-04");
  const [quality, setQuality] = useState<QualityId>("standard");
  const [strength, setStrength] = useState<StrengthId>("standard");
  const [support, setSupport] = useState(false);
  const [settings, setSettings] = useState<SlicerSettings>(() => buildSettings(PROFILES["bbl-x2d-04"], "standard", "standard", false));
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SliceSummary | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [runId, setRunId] = useState(0);
  const [shouldSlice, setShouldSlice] = useState(false);
  const [revision, setRevision] = useState(0);
  const [Viewport, setViewport] = useState<React.ComponentType<LevoViewportProps> | null>(null);
  const [SettingsPanel, setSettingsPanel] = useState<React.ComponentType<SettingsPanelProps> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeJob = useRef<{ runId: number; revision: number } | null>(null);
  const [artifactId] = useState(() => Symbol("levo-gcode"));
  const t = TEXT[locale];
  const profile = PROFILES[profileId];

  useEffect(() => {
    if (!model) return;
    let live = true;
    import("three-slicer/viewer").then((module) => { if (live) setViewport(() => module.default); });
    return () => { live = false; };
  }, [model]);

  useEffect(() => {
    if (sheet !== "advanced" || SettingsPanel) return;
    let live = true;
    import("three-slicer/components").then((module) => { if (live) setSettingsPanel(() => module.default); });
    return () => { live = false; };
  }, [sheet, SettingsPanel]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  useEffect(() => () => { GCODE_ARTIFACTS.delete(artifactId); }, [artifactId]);

  const invalidateSlice = useCallback((message = "") => {
    setRevision((value) => value + 1);
    setResult(null);
    GCODE_ARTIFACTS.delete(artifactId);
    setProgress(0);
    setShouldSlice(false);
    setNotice(message);
    setStage((current) => current === "empty" ? current : "modelReady");
  }, [artifactId]);

  const applyPresetSettings = useCallback((nextProfile: ProfileId, nextQuality: QualityId, nextStrength: StrengthId, nextSupport: boolean) => {
    setSettings(buildSettings(PROFILES[nextProfile], nextQuality, nextStrength, nextSupport));
    invalidateSlice(result ? t.stale : "");
  }, [invalidateSlice, result, t.stale]);

  const updateAdvancedSettings: Dispatch<SetStateAction<SlicerSettings>> = useCallback((next) => {
    setSettings((current) => typeof next === "function" ? next(current) : next);
    invalidateSlice(result ? t.stale : "");
  }, [invalidateSlice, result, t.stale]);

  const onFile = useCallback((file: File | undefined) => {
    if (!file) return;
    const validationError = validateModelFile(file);
    if (validationError) {
      setError(validationError);
      setStage("error");
      return;
    }
    setModel(file);
    setError(""); setNotice(""); setResult(null); setProgress(0); setShouldSlice(false);
    GCODE_ARTIFACTS.delete(artifactId);
    setRevision((value) => value + 1);
    setRunId((value) => value + 1);
    setStage("modelReady");
  }, [artifactId]);

  const startSlice = useCallback(() => {
    if (!model || stage === "slicing") return;
    const nextRun = runId + 1;
    activeJob.current = { runId: nextRun, revision };
    setRunId(nextRun); setShouldSlice(true); setProgress(0); setNotice(""); setError(""); setStage("slicing");
  }, [model, revision, runId, stage]);

  const cancelSlice = useCallback(() => {
    activeJob.current = null;
    setShouldSlice(false); setRunId((value) => value + 1); setProgress(0); setStage("modelReady");
  }, []);

  const handleEvent = useCallback((jobRun: number, jobRevision: number, event: ViewportEvent) => {
    const job = activeJob.current;
    if (shouldSlice && (!job || job.runId !== jobRun || job.revision !== jobRevision)) return;
    if (event.type === "progress") setProgress(Math.max(0, Math.min(1, event.value)));
    else if (event.type === "slicing" && event.value) setStage("slicing");
    else if (event.type === "error") { setError(event.value); setStage("error"); }
    else if (event.type === "notice") setNotice(event.value);
  }, [shouldSlice]);

  const handleSliced = useCallback((jobRun: number, jobRevision: number, payload: SlicePayload) => {
    const job = activeJob.current;
    if (!job || job.runId !== jobRun || job.revision !== jobRevision || jobRevision !== revision) return;
    if (payload.stats.over_bed || payload.stats.over_bed_model) {
      const overflow = [
        payload.stats.over_bed_x ? `X +${payload.stats.over_bed_x.toFixed(1)} mm` : "",
        payload.stats.over_bed_y ? `Y +${payload.stats.over_bed_y.toFixed(1)} mm` : "",
        payload.stats.over_bed_z ? `Z +${payload.stats.over_bed_z.toFixed(1)} mm` : "",
      ].filter(Boolean).join(" · ");
      setError(`Model or toolpath exceeds the ${profile.label} build volume${overflow ? `: ${overflow}` : "."}`);
      setResult(null); setShouldSlice(false); setStage("error");
      return;
    }
    GCODE_ARTIFACTS.set(artifactId, payload.gcode);
    setResult({ plate: payload.plate, stats: payload.stats });
    setShouldSlice(false); setProgress(1); setStage("sliceReady");
  }, [artifactId, profile.label, revision]);

  const downloadGcode = useCallback(() => {
    const gcode = GCODE_ARTIFACTS.get(artifactId);
    if (!gcode || !model) return;
    const base = model.name.replace(/\.[^.]+$/, "");
    const blob = new Blob([gcode], { type: "text/x-gcode;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${base}-${profile.label.toLowerCase()}.gcode`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [artifactId, model, profile.label]);

  const weight = useMemo(() => filamentWeight(result?.stats.filament_mm), [result]);
  const openPicker = () => inputRef.current?.click();

  return (
    <main className="levo-app" dir={locale === "ar" ? "rtl" : "ltr"}>
      <input ref={inputRef} className="visually-hidden" type="file" accept=".stl,.obj,.3mf,.amf,.ply" onChange={(event) => {
        onFile(event.target.files?.[0]);
        event.target.value = "";
      }} />

      <header className="topbar">
        <button className="icon-button brand-mark" aria-label={t.about} onClick={() => setSheet("about")}><span>LE</span></button>
        <div className="project-title"><strong>LEVO Slicer</strong><span>{model?.name ?? t.project}</span></div>
        <div className="top-actions">
          <button className="language-button" onClick={() => setLocale(locale === "ar" ? "en" : "ar")} aria-label="Change language">{locale === "ar" ? "EN" : "ع"}</button>
          <button className="printer-pill" onClick={() => setSheet("printer")} aria-label={t.printer}><span>{profile.label}</span><i aria-hidden="true" /></button>
        </div>
      </header>

      <section className={`workspace ${stage === "empty" ? "is-empty" : ""}`}>
        {stage === "empty" ? (
          <div className="empty-state">
            <div className="model-orbit" aria-hidden="true"><div className="orbit-ring"/><div className="cube-icon"><Icon name="cube"/></div></div>
            <h1>LEVO Slicer</h1>
            <p>{locale === "ar" ? "اطبع من هاتفك بسهولة." : "Print from your phone."}</p>
            <button className="primary-button add-button" onClick={openPicker}><Icon name="plus"/><span>{t.add}</span></button>
            <span className="format-line">{t.formats}</span>
            <span className="privacy-line"><i aria-hidden="true"/>{t.local}</span>
          </div>
        ) : (
          <>
            <div className="viewer-frame" aria-label="3D workspace">
              {Viewport && model ? (
                stage === "preview" && result ? (
                  <Viewport key={`preview-${runId}`} gcode={GCODE_ARTIFACTS.get(artifactId)} settings={settings} setSettings={setSettings}
                    panels={HIDDEN_PANELS} features={{ shortcuts: false, warmup: false, logs: false }} defaultExtruderColors={["#2b2f31"]}/>
                ) : (
                  <Viewport key={`model-${runId}`} files={[model]} settings={settings} setSettings={setSettings}
                    panels={HIDDEN_PANELS} features={{ shortcuts: false, logs: false }} defaultExtruderColors={["#2b2f31"]}
                    defaultAutoSlice={shouldSlice} onEvent={(event) => handleEvent(runId, revision, event)}
                    onSliced={(payload) => handleSliced(runId, revision, payload as SlicePayload)}/>
                )
              ) : (
                <div className="engine-loading"><span/><p>{locale === "ar" ? "جارٍ تحميل مساحة العمل…" : "Loading workspace…"}</p></div>
              )}
              {stage === "preview" && <button className="floating-back" onClick={() => setStage("sliceReady")}>{locale === "ar" ? "النتيجة" : "Result"}</button>}
              {stage === "slicing" && (
                <div className="slice-overlay" aria-live="polite">
                  <div className="progress-ring" style={{ "--progress": `${progress * 360}deg` } as React.CSSProperties}><span>{Math.round(progress * 100)}%</span></div>
                  <strong>{t.slicing}</strong><button onClick={cancelSlice}>{t.cancel}</button>
                </div>
              )}
            </div>

            {stage !== "preview" && (
              <section className="control-dock">
                <button className="summary-row" onClick={() => setSheet("setup")}>
                  <span className="summary-dot"/><span>{profile.label}</span><span>•</span><span>{profile.nozzle.toFixed(1)}</span><span>•</span><span>PLA</span><span>•</span><span>{QUALITY[quality].layer.toFixed(2)}</span>
                  <span className="summary-settings"><Icon name="sliders"/></span>
                </button>
                {notice && <p className="inline-notice">{notice}</p>}

                {stage === "sliceReady" && result ? (
                  <div className="result-panel">
                    <div className="result-heading"><span className="ready-dot"/><strong>{t.result}</strong></div>
                    <div className="metric-grid">
                      <div className="metric primary-metric"><span>{t.time}</span><strong>{formatTime(result.stats.time_estimate)}</strong></div>
                      <div className="metric"><span>Filament</span><strong>{weight ? `${weight.toFixed(1)} ${t.grams}` : "—"}</strong></div>
                      <div className="metric"><span>Layer</span><strong>{result.stats.layers ?? "—"} {t.layers}</strong></div>
                    </div>
                    <div className="result-actions">
                      <button className="secondary-button" onClick={() => setStage("preview")}><Icon name="eye"/>{t.preview}</button>
                      <button className="primary-button" onClick={downloadGcode}><Icon name="download"/>{t.download}</button>
                    </div>
                    <button className="disabled-print" disabled title={t.printDisabled}><span>{t.print}</span><small>{t.printDisabled}</small></button>
                    <p className="safety-note">{t.rawWarning}</p>
                  </div>
                ) : stage === "error" ? (
                  <div className="error-panel" role="alert">
                    <strong>{t.error}</strong><p>{error}</p><div>
                      <button className="secondary-button" onClick={openPicker}>{t.chooseAnother}</button>
                      {model && <button className="primary-button" onClick={() => { setError(""); setStage("modelReady"); }}>{t.retry}</button>}
                    </div>
                  </div>
                ) : (
                  <div className="primary-row">
                    <button className="secondary-icon-button" onClick={openPicker} aria-label={t.addShort}><Icon name="plus"/></button>
                    <button className="primary-button slice-button" onClick={startSlice} disabled={!Viewport || stage === "slicing"}>
                      <span>{t.slice}</span><small>{QUALITY[quality].label} • {QUALITY[quality].layer.toFixed(2)} mm</small>
                    </button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </section>

      {sheet && (
        <div className="sheet-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setSheet(null); }}>
          <section className={`bottom-sheet ${sheet === "advanced" ? "advanced-sheet" : ""}`} role="dialog" aria-modal="true" aria-label={t.settings}>
            <div className="sheet-handle"/>
            <header className="sheet-header">
              <div><strong>{sheet === "printer" ? t.printer : sheet === "advanced" ? t.advanced : sheet === "about" ? t.about : t.settings}</strong>
                {sheet === "setup" && <span>{profile.label} • PLA • {QUALITY[quality].layer.toFixed(2)} mm</span>}</div>
              <button className="icon-button" onClick={() => setSheet(null)} aria-label={t.close}><Icon name="close"/></button>
            </header>

            {sheet === "setup" && (
              <div className="sheet-content setup-list">
                <button className="setting-row" onClick={() => setSheet("printer")}><span><i className="setting-icon printer-icon"/>{t.printer}</span><b>{profile.label}</b><Icon name="chevron"/></button>
                <fieldset className="setting-group"><legend>{t.quality}</legend><div className="segmented-control">
                  {(Object.keys(QUALITY) as QualityId[]).map((item) => <button key={item} className={quality === item ? "active" : ""} onClick={() => {
                    setQuality(item); applyPresetSettings(profileId, item, strength, support);
                  }}><span>{QUALITY[item].label}</span><small>{QUALITY[item].layer.toFixed(2)} mm</small></button>)}
                </div></fieldset>
                <fieldset className="setting-group"><legend>{t.strength}</legend><div className="segmented-control">
                  {(Object.keys(STRENGTH) as StrengthId[]).map((item) => <button key={item} className={strength === item ? "active" : ""} onClick={() => {
                    setStrength(item); applyPresetSettings(profileId, quality, item, support);
                  }}><span>{STRENGTH[item].label}</span><small>{STRENGTH[item].infill}%</small></button>)}
                </div></fieldset>
                <div className="toggle-row"><span><b>{t.support}</b><small>{support ? t.auto : t.off}</small></span>
                  <button className={`toggle ${support ? "on" : ""}`} role="switch" aria-checked={support} onClick={() => {
                    const next = !support; setSupport(next); applyPresetSettings(profileId, quality, strength, next);
                  }}><i/></button>
                </div>
                <button className="advanced-link" onClick={() => setSheet("advanced")}><span><Icon name="sliders"/>{t.advanced}</span><Icon name="chevron"/></button>
                <button className="primary-button sheet-done" onClick={() => setSheet(null)}>{t.apply}</button>
              </div>
            )}

            {sheet === "printer" && (
              <div className="sheet-content printer-list">
                <div className="connection-card"><div className="printer-illustration"><Icon name="cube"/></div><span><strong>{t.noPrinter}</strong><small>{t.noPrinterHelp}</small></span></div>
                {(Object.keys(PROFILES) as ProfileId[]).map((id) => {
                  const item = PROFILES[id];
                  return <button key={id} className={`printer-card ${profileId === id ? "selected" : ""}`} onClick={() => {
                    setProfileId(id); applyPresetSettings(id, quality, strength, support);
                  }}><span className="printer-thumb"><Icon name="cube"/></span><span className="printer-copy"><strong>{item.model}</strong><small>{item.width} × {item.depth} × {item.height} mm • {item.nozzle.toFixed(1)} mm</small></span><span className="profile-state">{t.profileOnly}</span></button>;
                })}
                <p className="source-note">Profiles are pinned to verified OrcaSlicer BBL definitions (GM045 / GM033). Physical connection is intentionally unavailable in this build.</p>
              </div>
            )}

            {sheet === "advanced" && (
              <div className="advanced-content"><p>Real Orca-style schema settings. Any change invalidates the existing slice.</p>
                {SettingsPanel ? <SettingsPanel settings={settings} setSettings={updateAdvancedSettings} embedded/> : <div className="engine-loading compact"><span/><p>Loading settings…</p></div>}
              </div>
            )}

            {sheet === "about" && (
              <div className="sheet-content about-content">
                <div className="capability-card verified"><span/><div><strong>Browser slicer</strong><small>Real WASM engine, worker progress, G-code and toolpath preview</small></div></div>
                <div className="capability-card partial"><span/><div><strong>Bambu profiles</strong><small>Verified X2D/H2D profile values; raw G-code download only</small></div></div>
                <div className="capability-card disabled"><span/><div><strong>Direct print & AMS</strong><small>Disabled until Bridge, package validation and real-printer testing are complete</small></div></div>
                <p>{t.honest}</p><a className="source-link" href="https://github.com/aliamer229/Levo_slicer" target="_blank" rel="noreferrer">{t.source}</a>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
