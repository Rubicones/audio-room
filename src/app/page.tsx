"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DefaultLoadingManager } from "three";
import * as Tone from "tone";
import toast from "react-hot-toast";
import {
  disposeAudioEngine,
  getTrackAcousticData,
  getTrackDiagnostics,
  isTrackLoaded,
  getTrackLoadingState,
  type TrackAcousticData,
  toggleTransport,
  waitForToneLoaded,
} from "@/components/canvas/audioEngine";
import { CameraView } from "@/components/canvas/CameraRig";
import { SceneCanvas } from "@/components/canvas/SceneCanvas";
import {
  TrackStoreProvider,
  useTrackStore,
} from "@/components/canvas/TrackStore";
import {
  ACOUSTIC_MATERIALS,
  type RoomMaterialPreset,
} from "@/components/canvas/acousticMaterials";
import {
  type Track,
  type ObstacleType,
  type TrackConfig,
} from "@/components/canvas/types";
import { ROOM_CENTER_POSITION } from "@/components/canvas/obstacleConstants";
import { PlayerBar } from "@/components/ui/PlayerBar";
import { SketchSlider } from "@/components/ui/SketchSlider";
import { useAuthStore } from "@/components/auth/AuthStore";
import { PreviewLoginActions } from "@/components/auth/PreviewLoginActions";
import { clearAuthReturnTo, readAuthReturnTo } from "@/lib/authReturnTo";
import { ProjectsDashboard } from "@/components/projects/ProjectsDashboard";
import type { ProjectListItem } from "@/components/projects/types";
import { supabase } from "@/lib/supabaseClient";
import {
  deserializeProjectConfig,
  serializeProjectConfig,
  type ProjectConfigJSON,
} from "@/lib/projectConfig";
import { Landing } from "./Landing";
import { appToast } from "@/lib/appToast";
import {
  getProjectIdFromPath,
  getProjectSharePath,
  isProjectSharePath,
} from "@/lib/projectRoute";
import { getProjectCardSummary } from "@/lib/projectCardSummary";
import styles from "./page.module.css";

const PALETTE = ["#E16A6A", "#E5B94A", "#5BC489", "#7B5BE6", "#4A90E2", "#E07A5F"];
const OBSTACLE_TYPE_OPTIONS: Array<{ id: ObstacleType; label: string }> = [
  { id: "cylinder", label: "Cylinder" },
  { id: "box", label: "Box" },
  { id: "wall-with-window", label: "Wall with Window" },
];

// All stems in `public/demo_track/` — loaded when the user clicks
// "Set up the demo track".
const DEMO_TRACK_FILES = [
  "vocal.webm",
  "vocal 2.webm",
  "guitar.webm",
  "guitar 2.webm",
  "guitarpiano.webm",
  "guitarpiano 2.webm",
  "bass.webm",
  "kick.webm",
  "snare.webm",
  "snare 2.webm",
  "overheads.webm",
  "overheads 2.webm",
] as const;
const AUDIO_BUCKET = "audio";

type ProjectRow = {
  id: string;
  title: string;
  updated_at: string;
  config: ProjectConfigJSON;
};

function toProjectListItem(project: ProjectRow): ProjectListItem {
  return {
    id: project.id,
    title: project.title,
    updated_at: project.updated_at,
    ...getProjectCardSummary(project.config),
  };
}

type AppPhase =
  | "initializing"
  | "unauthenticated"
  | "onboarding"
  | "dashboard"
  | "projectLoading"
  | "workspace";

function extractAudioObjectPath(audioUrl: string): string | null {
  try {
    const parsed = new URL(audioUrl);
    const patterns = [
      "/storage/v1/object/public/audio/",
      "/storage/v1/object/sign/audio/",
      "/storage/v1/object/authenticated/audio/",
    ];
    for (const prefix of patterns) {
      const idx = parsed.pathname.indexOf(prefix);
      if (idx === -1) continue;
      const raw = parsed.pathname.slice(idx + prefix.length);
      if (!raw) return null;
      return decodeURIComponent(raw);
    }
    return null;
  } catch {
    return null;
  }
}

function buildDemoTracks(startIndex: number): TrackConfig[] {
  return DEMO_TRACK_FILES.map((file, idx) => ({
    name: file.replace(/\.[^/.]+$/, ""),
    color: PALETTE[(startIndex + idx) % PALETTE.length],
    audioUrl: `/demo_track/${encodeURIComponent(file)}`,
  }));
}

function RotationDial({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const dialRef = useRef<HTMLDivElement | null>(null);

  const setFromClientPoint = (clientX: number, clientY: number) => {
    const dial = dialRef.current;
    if (!dial) return;
    const rect = dial.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const next = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    onChange(next);
  };

  const rad = (value * Math.PI) / 180;
  const orbit = 12;
  const dotX = Math.sin(rad) * orbit;
  const dotY = -Math.cos(rad) * orbit;

  return (
    <div className={styles.rotationDialWrap}>
      <div
        ref={dialRef}
        className={styles.rotationDial}
        onPointerDown={(event) => {
          const target = event.currentTarget;
          target.setPointerCapture(event.pointerId);
          setFromClientPoint(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          const target = event.currentTarget;
          if (!target.hasPointerCapture(event.pointerId)) return;
          setFromClientPoint(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          const target = event.currentTarget;
          if (target.hasPointerCapture(event.pointerId)) {
            target.releasePointerCapture(event.pointerId);
          }
        }}
      >
        <span
          className={styles.rotationDialDot}
          style={{
            transform: `translate(calc(-50% + ${dotX}px), calc(-50% + ${dotY}px))`,
          }}
        />
      </div>
      <span className={styles.rotationDialValue}>{Math.round(value)}deg</span>
    </div>
  );
}

const TOOLTIP_DELAY_MS = 300;

function HelpTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const timerRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const popW = 240;
    const popH = 120;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const canRight = rect.right + 10 + popW < vw - 8;
    const left = canRight ? rect.right + 10 : Math.max(8, rect.left - popW - 10);
    const top = rect.top + popH + 8 < vh ? rect.top : Math.max(8, rect.bottom - popH);
    setPopoverStyle({ left, top, width: Math.min(popW, vw - 16), position: "fixed" });
  };

  const showDelayed = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      updatePosition();
      setOpen(true);
    }, TOOLTIP_DELAY_MS);
  };

  const hide = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setOpen(false);
  };

  useEffect(() => {
    const onResize = () => {
      if (open) updatePosition();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [open]);

  return (
    <span className={styles.helpWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.helpTrigger}
        aria-label="Show explanation"
        onMouseEnter={showDelayed}
        onMouseLeave={hide}
        onFocus={showDelayed}
        onBlur={hide}
        onClick={() => {
          if (!open) updatePosition();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      {open ? (
        <span className={styles.helpBubble} style={popoverStyle}>
          {text}
        </span>
      ) : null}
    </span>
  );
}

type SummaryItemProps = {
  label: string;
  value: string;
  onCopy: (label: string, value: string) => void;
};

function SummaryItem({ label, value, onCopy }: SummaryItemProps) {
  return (
    <div className={styles.summaryRow}>
      <span className={styles.summaryKey}>{label}</span>
      <span className={styles.summaryValue}>{value}</span>
      <button
        type="button"
        className={styles.copyBtn}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        onClick={() => onCopy(label, value)}
      >
        copy
      </button>
    </div>
  );
}

function renderSummaryRows(
  data: TrackAcousticData,
  onCopy: (label: string, value: string) => void
) {
  return (
    <>
      <SummaryItem
        label="Gain"
        value={Number.isFinite(data.gainDb) ? `${data.gainDb.toFixed(1)} dB` : "-inf dB"}
        onCopy={onCopy}
      />
      <SummaryItem label="Panning" value={data.panningText} onCopy={onCopy} />
      <SummaryItem label="EQ/Filter" value={`${data.filterHz} Hz`} onCopy={onCopy} />
      <SummaryItem
        label="Reverb Send"
        value={`${data.reverbSendPct}% wet / ${data.dryPct}% dry`}
        onCopy={onCopy}
      />
      <SummaryItem label="Occluded" value={data.occluded ? "Yes" : "No"} onCopy={onCopy} />
    </>
  );
}

function MixerPage() {
  const { user, session, isLoading } = useAuthStore();
  const sessionUserId = session?.user?.id ?? null;
  const router = useRouter();
  const pathname = usePathname();
  const projectIdFromPath = useMemo(() => getProjectIdFromPath(pathname), [pathname]);
  const username = String(
    user?.user_metadata?.username ??
      user?.user_metadata?.preferred_username ??
      user?.user_metadata?.name ??
      user?.user_metadata?.full_name ??
      ""
  ).trim();
  const avatarFallbackLetter = (username || user?.email || "U").charAt(0).toUpperCase();
  const {
    tracks,
    obstacles,
    roomScale,
    acousticSettings,
    addTracks,
    addObstacle,
    removeObstacle,
    updateObstacle,
    removeTrack,
    updateTrackName,
    toggleTrackMute,
    toggleTrackSolo,
    updateTrackAudioUrl,
    setRoomScale,
    setRoomMaterial,
    setEnableRoomReverb,
    setEnableAirAbsorption,
    setShowAttenuationZones,
    setShowAcousticShadows,
    setShowCriticalDistance,
    setTrackGainDb,
    toggleTrackDirectivity,
    toggleTrackShadows,
    setTrackRotationDeg,
    setObstacleRotationDeg,
    replaceProjectState,
    resetProjectState,
  } = useTrackStore();
  const [view, setView] = useState<CameraView>("isometric");
  const [isPlaying, setIsPlaying] = useState(false);
  const [appPhase, setAppPhase] = useState<AppPhase>("initializing");
  const [isAppInitializing, setIsAppInitializing] = useState(true);
  const [startMode, setStartMode] = useState<"clean" | "demo" | null>(null);
  const [listenerPosition, setListenerPosition] = useState<[number, number, number]>([0, 0.5, 0]);
  const [listenerRotationDeg] = useState(0);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isBootReady, setIsBootReady] = useState(false);
  const [transportLoading, setTransportLoading] = useState(false);
  const [trackBuffersLoading, setTrackBuffersLoading] = useState(false);
  const [demoQueued, setDemoQueued] = useState(false);
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);
  const [zoomSteps, setZoomSteps] = useState(0);
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);
  const [summaryTrackId, setSummaryTrackId] = useState<string | null>(null);
  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);
  const [expandedTrackIds, setExpandedTrackIds] = useState<Record<string, boolean>>({});
  const [liveTrackData, setLiveTrackData] = useState<Record<string, TrackAcousticData>>({});
  const [trackLoadedMap, setTrackLoadedMap] = useState<Record<string, boolean>>({});
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [activeObstacleId, setActiveObstacleId] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentProjectOwnerId, setCurrentProjectOwnerId] = useState<string | null>(null);
  const [currentProjectTitle, setCurrentProjectTitle] = useState("Untitled project");
  const [projectTitleBusy, setProjectTitleBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isDemoScene, setIsDemoScene] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const [pendingUploadsCount, setPendingUploadsCount] = useState(0);
  const demoAutoStartedRef = useRef(false);
  const previousTrackCountRef = useRef(0);
  const saveDebounceRef = useRef<number | null>(null);
  const loadingProjectRef = useRef(false);
  const loadedProjectIdRef = useRef<string | null>(null);
  const creatingProjectRef = useRef(false);
  const profileWrapRef = useRef<HTMLDivElement | null>(null);
  const workspaceActive = appPhase === "workspace";
  const isReadOnlyPreview = Boolean(
    currentProjectId &&
      currentProjectOwnerId &&
      currentProjectOwnerId !== sessionUserId
  );
  const isProjectEditable = !isReadOnlyPreview && !isDemoScene;
  const replaceUrlWithProjectId = useCallback((projectId: string) => {
    if (typeof window === "undefined") return;
    const nextPath = getProjectSharePath(projectId);
    if (window.location.pathname === nextPath) return;
    window.history.replaceState(window.history.state, "", nextPath);
  }, []);


  const runTransition = (update: () => void) => {
    const doc = document as Document & {
      startViewTransition?: (callback: () => void) => void;
    };
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => {
        update();
      });
      return;
    }
    update();
  };

  const currentProjectConfig = useMemo(
    () =>
      serializeProjectConfig({
        roomScale,
        roomMaterial: acousticSettings.roomMaterial,
        showShadows: acousticSettings.showAcousticShadows,
        showAttenuation: acousticSettings.showAttenuationZones,
        showCriticalDistance: acousticSettings.showCriticalDistance,
        airAbsorptionEnabled: acousticSettings.enableAirAbsorption,
        listenerPosition,
        listenerRotationDeg,
        obstacles,
        tracks,
      }),
    [
      roomScale,
      acousticSettings.roomMaterial,
      acousticSettings.showAcousticShadows,
      acousticSettings.showAttenuationZones,
      acousticSettings.showCriticalDistance,
      acousticSettings.enableAirAbsorption,
      listenerPosition,
      listenerRotationDeg,
      obstacles,
      tracks,
    ]
  );
  const hasPendingBlobTrackUrl = useMemo(
    () => tracks.some((track) => typeof track.audioUrl === "string" && track.audioUrl.startsWith("blob:")),
    [tracks]
  );
  const pendingBlobTracksCount = useMemo(
    () =>
      tracks.filter(
        (track) => typeof track.audioUrl === "string" && track.audioUrl.startsWith("blob:")
      ).length,
    [tracks]
  );
  const syncStatusText = useMemo(() => {
    if (pendingUploadsCount > 0) {
      return `Uploading ${pendingUploadsCount} track${pendingUploadsCount === 1 ? "" : "s"}...`;
    }
    if (pendingBlobTracksCount > 0) {
      return `${pendingBlobTracksCount} track${pendingBlobTracksCount === 1 ? "" : "s"} local only`;
    }
    if (saveState === "saving") return "Saving...";
    if (saveState === "saved") return "Saved";
    if (saveState === "error") return "Save failed";
    return "";
  }, [pendingBlobTracksCount, pendingUploadsCount, saveState]);
  const persistedProjectConfig = useMemo<ProjectConfigJSON>(() => {
    if (!hasPendingBlobTrackUrl) return currentProjectConfig;
    return {
      ...currentProjectConfig,
      tracks: currentProjectConfig.tracks.filter(
        (track) => typeof track.audioUrl === "string" && !track.audioUrl.startsWith("blob:")
      ),
    };
  }, [currentProjectConfig, hasPendingBlobTrackUrl]);
  const resolveTrackPlaybackUrls = useCallback(
    async (projectTracks: Track[]) => {
      if (!supabase) return projectTracks;
      const resolved = await Promise.all(
        projectTracks.map(async (track) => {
          if (!track.audioUrl || track.audioUrl.startsWith("blob:")) return track;
          const objectPath = extractAudioObjectPath(track.audioUrl);
          if (!objectPath) return track;
          const { data, error } = await supabase.storage
            .from(AUDIO_BUCKET)
            .createSignedUrl(objectPath, 60 * 60 * 8);
          if (error || !data?.signedUrl) return track;
          return { ...track, audioUrl: data.signedUrl };
        })
      );
      return resolved;
    },
    []
  );

  const refreshProjects = useCallback(async (): Promise<ProjectRow[]> => {
    if (!supabase || !sessionUserId) return [];
    setProjectsLoading(true);
    const { data, error } = await supabase
      .from("projects")
      .select("id,title,config,updated_at")
      .eq("user_id", sessionUserId)
      .order("updated_at", { ascending: false });
    if (error) {
      setProfileError(error.message);
      setProjectsLoading(false);
      return [];
    }
    const next = (data ?? []) as ProjectRow[];
    setProjects(next);
    setProjectsLoading(false);
    return next;
  }, [sessionUserId]);

  const performProjectSave = useCallback(
    async (overrideConfig?: ProjectConfigJSON) => {
      if (!supabase || !currentProjectId || !isProjectEditable || isHydrating) return false;
      setSaveState("saving");
      const { error } = await supabase
        .from("projects")
        .update({ config: overrideConfig ?? persistedProjectConfig, updated_at: new Date().toISOString() })
        .eq("id", currentProjectId);
      if (error) {
        setSaveState("error");
        setProfileError(error.message);
        toast.error(error.message);
        return false;
      }
      setSaveState("saved");
      return true;
    },
    [currentProjectId, isProjectEditable, isHydrating, persistedProjectConfig]
  );

  const ensurePersistedProject = useCallback(
    async (preferredTitle?: string) => {
      if (!supabase || !sessionUserId || !isProjectEditable || isHydrating) return null;
      if (currentProjectId) return currentProjectId;
      if (creatingProjectRef.current) return null;
      creatingProjectRef.current = true;
      const fallbackTitle =
        preferredTitle?.trim() ||
        currentProjectTitle.trim() ||
        persistedProjectConfig.tracks[0]?.name?.trim() ||
        tracks[0]?.name?.trim() ||
        "Untitled project";
      try {
        const { data, error } = await supabase
          .from("projects")
          .insert({
            user_id: sessionUserId,
            title: fallbackTitle,
            config: persistedProjectConfig,
          })
          .select("id,title,config,updated_at")
          .single();
        if (error || !data) {
          const message = error?.message ?? "Could not create project";
          setProfileError(message);
          toast.error(message);
          return null;
        }
        setCurrentProjectId(data.id);
        setCurrentProjectTitle(data.title || fallbackTitle);
        setIsDemoScene(false);
        replaceUrlWithProjectId(data.id);
        setSaveState("saved");
        void refreshProjects();
        return data.id;
      } finally {
        creatingProjectRef.current = false;
      }
    },
    [
      currentProjectId,
      currentProjectTitle,
      isProjectEditable,
      isHydrating,
      persistedProjectConfig,
      refreshProjects,
      replaceUrlWithProjectId,
      sessionUserId,
      tracks,
    ]
  );

  useEffect(() => () => disposeAudioEngine(), []);

  useEffect(() => {
    const updateScreen = () => setIsNarrowScreen(window.innerWidth <= 900);
    updateScreen();
    window.addEventListener("resize", updateScreen);
    return () => window.removeEventListener("resize", updateScreen);
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (profileWrapRef.current?.contains(target)) return;
      setProfileMenuOpen(false);
      setChangePasswordOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [profileMenuOpen]);

  useEffect(() => {
    let active = true;
    if (isLoading) return () => {
      active = false;
    };
    const initialize = async () => {
      setIsAppInitializing(true);
      if (!supabase) {
        if (!active) return;
        setAppPhase("unauthenticated");
        setIsAppInitializing(false);
        return;
      }

      if (projectIdFromPath) {
        if (loadedProjectIdRef.current === projectIdFromPath) {
          if (active) {
            setAppPhase("workspace");
            setIsAppInitializing(false);
          }
          return;
        }
        loadingProjectRef.current = true;
        if (active) setAppPhase("projectLoading");
        const { data, error } = await supabase
          .from("projects")
          .select("id,title,config,updated_at,user_id")
          .eq("id", projectIdFromPath)
          .single();
        if (!active) return;
        if (error || !data) {
          loadingProjectRef.current = false;
          loadedProjectIdRef.current = null;
          setIsHydrating(false);
          router.replace("/");
          if (sessionUserId) {
            const rows = await refreshProjects();
            if (!active) return;
            setAppPhase(rows.length > 0 ? "dashboard" : "onboarding");
          } else {
            setAppPhase("unauthenticated");
          }
          setIsAppInitializing(false);
          return;
        }
        setIsHydrating(true);
        try {
          const hydrated = deserializeProjectConfig(data.config as ProjectConfigJSON);
          const hydratedTracks = await resolveTrackPlaybackUrls(hydrated.tracks);
          replaceProjectState({
            tracks: hydratedTracks,
            roomScale: hydrated.roomScale,
            obstacles: hydrated.obstacles,
            acousticSettings: {
              roomMaterial: hydrated.roomMaterial,
              enableAirAbsorption: hydrated.airAbsorptionEnabled,
              showAcousticShadows: hydrated.showShadows,
              showAttenuationZones: hydrated.showAttenuation,
              showCriticalDistance: hydrated.showCriticalDistance,
            },
          });
          setListenerPosition(hydrated.listenerPosition);
          setCurrentProjectId(data.id);
          setCurrentProjectOwnerId(data.user_id);
          setCurrentProjectTitle(data.title || "Untitled project");
          setIsDemoScene(false);
          setSaveState("saved");
          setIsBootReady(false);
          previousTrackCountRef.current = hydratedTracks.length;
          loadedProjectIdRef.current = projectIdFromPath;
          loadingProjectRef.current = false;
          setAppPhase("workspace");
          setIsAppInitializing(false);
        } finally {
          setIsHydrating(false);
        }
        return;
      }

      if (!sessionUserId) {
        if (!active) return;
        setAppPhase("unauthenticated");
        setCurrentProjectId(null);
        setCurrentProjectOwnerId(null);
        setCurrentProjectTitle("Untitled project");
        setSaveState("idle");
        setIsAppInitializing(false);
        return;
      }

      const rows = await refreshProjects();
      if (!active) return;
      setAppPhase(rows.length > 0 ? "dashboard" : "onboarding");
      setIsAppInitializing(false);
    };
    void initialize();
    return () => {
      active = false;
    };
  }, [isLoading, projectIdFromPath, refreshProjects, replaceProjectState, resolveTrackPlaybackUrls, router, sessionUserId]);

  useEffect(() => {
    if (!sessionUserId || typeof window === "undefined") return;
    const returnTo = readAuthReturnTo();
    if (!returnTo) return;
    try {
      const returnUrl = new URL(returnTo, window.location.origin);
      const onHome = !getProjectIdFromPath(pathname);
      if (onHome && returnUrl.pathname !== "/") {
        clearAuthReturnTo();
        router.replace(`${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`);
      }
    } catch {
      clearAuthReturnTo();
    }
  }, [pathname, router, sessionUserId]);

  useEffect(() => {
    if (!supabase || !sessionUserId || currentProjectId || !isProjectEditable || isHydrating) return;
    if (persistedProjectConfig.tracks.length === 0) return;
    const firstTrackName =
      persistedProjectConfig.tracks[0]?.name?.trim() ||
      tracks[0]?.name?.trim() ||
      "Untitled project";
    void ensurePersistedProject(firstTrackName);
  }, [
    currentProjectId,
    ensurePersistedProject,
    isProjectEditable,
    isHydrating,
    persistedProjectConfig.tracks,
    sessionUserId,
    tracks,
  ]);

  useEffect(() => {
    if (!currentProjectId) return;
    if (!isProjectEditable || isHydrating) return;
    if (loadingProjectRef.current) return;
    setSaveState("saving");
    if (saveDebounceRef.current) {
      window.clearTimeout(saveDebounceRef.current);
    }
    saveDebounceRef.current = window.setTimeout(() => {
      void performProjectSave();
    }, 1500);
    return () => {
      if (saveDebounceRef.current) {
        window.clearTimeout(saveDebounceRef.current);
      }
    };
  }, [currentProjectConfig, currentProjectId, isProjectEditable, isHydrating, performProjectSave]);

  useEffect(() => {
    if (!workspaceActive) return;
    let resolvedAssets = false;
    let resolvedTone = false;

    const markReady = () => {
      if (resolvedAssets && resolvedTone) setIsBootReady(true);
    };

    const previousOnProgress = DefaultLoadingManager.onProgress;
    const previousOnLoad = DefaultLoadingManager.onLoad;
    const previousOnError = DefaultLoadingManager.onError;

    DefaultLoadingManager.onProgress = (_url, loaded, total) => {
      const ratio = total > 0 ? loaded / total : 1;
      setLoadingProgress(Math.round(ratio * 100));
    };
    DefaultLoadingManager.onLoad = () => {
      resolvedAssets = true;
      setLoadingProgress(100);
      markReady();
    };
    DefaultLoadingManager.onError = () => {
      resolvedAssets = true;
      markReady();
    };

    if (
      (DefaultLoadingManager as unknown as { isLoading?: boolean }).isLoading !==
      true
    ) {
      resolvedAssets = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- boot phase mirrors loader completion
      setLoadingProgress(100);
    }

    waitForToneLoaded().finally(() => {
      resolvedTone = true;
      markReady();
    });

    markReady();

    return () => {
      DefaultLoadingManager.onProgress = previousOnProgress;
      DefaultLoadingManager.onLoad = previousOnLoad;
      DefaultLoadingManager.onError = previousOnError;
    };
  }, [workspaceActive]);

  const startApp = async (mode: "clean" | "demo") => {
    await Tone.start();
    loadedProjectIdRef.current = null;
    resetProjectState();
    setProfileError("");
    setListenerPosition([0, 0.5, 0]);
    setIsBootReady(false);
    setAppPhase("workspace");
    setIsDemoScene(mode === "demo");
    setStartMode(mode);
    setCurrentProjectId(null);
    setCurrentProjectOwnerId(null);
    setCurrentProjectTitle("Untitled project");
    setSaveState("idle");
    router.replace("/");
    if (mode === "demo") {
      setTrackBuffersLoading(true);
      addTracks(buildDemoTracks(0));
      setDemoQueued(true);
    }
  };

  const openProjectsDashboard = useCallback(async () => {
    disposeAudioEngine();
    loadedProjectIdRef.current = null;
    runTransition(() => {
      setAppPhase("dashboard");
      setStartMode(null);
      setDemoQueued(false);
      setIsPlaying(false);
      setIsBootReady(false);
      setProfileMenuOpen(false);
      setChangePasswordOpen(false);
      setCurrentProjectId(null);
      setCurrentProjectOwnerId(null);
      setIsDemoScene(false);
      setSaveState("idle");
      setProfileError("");
      resetProjectState();
      setListenerPosition([0, 0.5, 0]);
    });
    router.replace("/");
    await refreshProjects();
  }, [refreshProjects, resetProjectState, router]);

  const loadProject = useCallback(
    async (project: ProjectRow) => {
      setIsHydrating(true);
      try {
        const hydrated = deserializeProjectConfig(project.config);
        const hydratedTracks = await resolveTrackPlaybackUrls(hydrated.tracks);
        replaceProjectState({
          tracks: hydratedTracks,
          roomScale: hydrated.roomScale,
          obstacles: hydrated.obstacles,
          acousticSettings: {
            roomMaterial: hydrated.roomMaterial,
            enableAirAbsorption: hydrated.airAbsorptionEnabled,
            showAcousticShadows: hydrated.showShadows,
            showAttenuationZones: hydrated.showAttenuation,
            showCriticalDistance: hydrated.showCriticalDistance,
          },
        });
        setListenerPosition(hydrated.listenerPosition);
        setCurrentProjectId(project.id);
        setCurrentProjectOwnerId(sessionUserId);
        setCurrentProjectTitle(project.title || "Untitled project");
        setIsBootReady(false);
        setAppPhase("workspace");
        setIsDemoScene(false);
        setSaveState("saved");
        previousTrackCountRef.current = hydratedTracks.length;
        loadedProjectIdRef.current = project.id;
        replaceUrlWithProjectId(project.id);
      } finally {
        setIsHydrating(false);
      }
    },
    [replaceProjectState, replaceUrlWithProjectId, resolveTrackPlaybackUrls, sessionUserId]
  );

  const handleShareProject = async (projectId?: string) => {
    const id = projectId ?? currentProjectId;
    if (!id || typeof window === "undefined") return;
    const shareUrl = `${window.location.origin}${getProjectSharePath(id)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      appToast.info("link copied to clipboard");
    } catch {
      appToast.error("could not copy link");
    }
  };

  const handleCloneToWorkspace = async () => {
    if (!supabase || !sessionUserId || !currentProjectId || !persistedProjectConfig) return;
    const clonedTitle = `${(currentProjectTitle || "Untitled project").trim()} (Copy)`;
    const clonedConfig = JSON.parse(JSON.stringify(persistedProjectConfig)) as ProjectConfigJSON;
    setIsHydrating(true);
    try {
      const { data, error } = await supabase
        .from("projects")
        .insert({
          user_id: sessionUserId,
          title: clonedTitle,
          config: clonedConfig,
        })
        .select("id,title,config,updated_at,user_id")
        .single();
      if (error || !data) {
        throw error ?? new Error("Could not clone project");
      }
      setCurrentProjectId(data.id);
      setCurrentProjectOwnerId(sessionUserId);
      setCurrentProjectTitle(data.title || clonedTitle);
      setIsDemoScene(false);
      setSaveState("saved");
      setIsBootReady(true);
      loadedProjectIdRef.current = data.id;
      setAppPhase("workspace");
      await router.replace(getProjectSharePath(data.id));
      void refreshProjects();
      appToast.success("project cloned to your workspace");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not clone project";
      appToast.error(message);
    } finally {
      setIsHydrating(false);
    }
  };

  const handleOpenProjectFromDashboard = useCallback(
    async (projectId: string) => {
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project) return;
      await loadProject(project);
    },
    [loadProject, projects]
  );

  const handleRenameProjectFromDashboard = useCallback(
    async (projectId: string, nextTitle: string) => {
      if (!supabase) return;
      const normalized = nextTitle.trim() || "Untitled project";
      setProfileError("");
      setProjects((current) =>
        current.map((project) =>
          project.id === projectId ? { ...project, title: normalized } : project
        )
      );
      if (currentProjectId === projectId) {
        setCurrentProjectTitle(normalized);
      }
      const { error } = await supabase
        .from("projects")
        .update({ title: normalized, updated_at: new Date().toISOString() })
        .eq("id", projectId);
      if (error) {
        setProfileError(error.message);
        toast.error(error.message);
        void refreshProjects();
      } else {
        toast.success("Project renamed");
      }
    },
    [currentProjectId, refreshProjects]
  );

  const handleDeleteProjectFromDashboard = useCallback(
    async (projectId: string) => {
      if (!supabase) return;
      const { error } = await supabase.from("projects").delete().eq("id", projectId);
      if (error) {
        setProfileError(error.message);
        toast.error(error.message);
        return;
      }
      toast.success("Project deleted");
      setProjects((current) => current.filter((project) => project.id !== projectId));
      if (currentProjectId === projectId) {
        setCurrentProjectId(null);
        setCurrentProjectTitle("Untitled project");
        setSaveState("idle");
        setAppPhase("dashboard");
        router.replace("/");
      }
    },
    [currentProjectId, router]
  );

  const handleSignOut = async () => {
    if (!supabase) return;
    setProfileBusy(true);
    setProfileError("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      runTransition(() => {
        setAppPhase("unauthenticated");
        setIsDemoScene(false);
        setStartMode(null);
        setDemoQueued(false);
        setIsPlaying(false);
        setIsBootReady(false);
        setProfileMenuOpen(false);
        setChangePasswordOpen(false);
        setCurrentProjectId(null);
        setCurrentProjectOwnerId(null);
        setSaveState("idle");
      });
      router.replace("/");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Sign out failed";
      setProfileError(message);
      toast.error(message);
    } finally {
      setProfileBusy(false);
    }
  };

  const handleChangePassword = async () => {
    if (!supabase || !newPassword.trim()) return;
    setProfileBusy(true);
    setProfileError("");
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword.trim(),
      });
      if (error) throw error;
      setNewPassword("");
      setChangePasswordOpen(false);
      toast.success("Password updated");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not change password";
      setProfileError(message);
      toast.error(message);
    } finally {
      setProfileBusy(false);
    }
  };

  const handleProjectTitleChange = async (title: string) => {
    setCurrentProjectTitle(title);
    if (!supabase || !isProjectEditable) return;
    setProfileError("");
    const projectId = await ensurePersistedProject(title);
    if (!projectId) return;
    setProjectTitleBusy(true);
    const nextTitle = title.trim() || "Untitled project";
    const { error } = await supabase
      .from("projects")
      .update({ title: nextTitle, updated_at: new Date().toISOString() })
      .eq("id", projectId);
    setProjectTitleBusy(false);
    if (error) {
      setProfileError(error.message);
      toast.error(error.message);
      return;
    }
    setCurrentProjectTitle(nextTitle);
    void refreshProjects();
  };

  const handleForceSaveNow = async () => {
    if (!isProjectEditable) return;
    setProfileError("");
    const projectId = await ensurePersistedProject(currentProjectTitle);
    if (!projectId) return;
    if (saveDebounceRef.current) {
      window.clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = null;
    }
    const saved = await performProjectSave();
    if (saved) {
      toast.success("Project saved");
      void refreshProjects();
    }
  };

  const handleFileAdd = (event: ChangeEvent<HTMLInputElement>) => {
    if (!isProjectEditable) return;
    const sanitizeFileName = (value: string) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    const uploadToAudioBucket = async (file: File) => {
      if (!supabase || !sessionUserId) return URL.createObjectURL(file);
      const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
      const base = file.name.replace(/\.[^/.]+$/, "");
      const safeBase = sanitizeFileName(base) || "track";
      const filePath = `${sessionUserId}/${Date.now()}-${crypto.randomUUID()}-${safeBase}${ext}`;
      const { error } = await supabase.storage.from(AUDIO_BUCKET).upload(filePath, file, {
        upsert: false,
        cacheControl: "3600",
      });
      if (error) {
        setProfileError(error.message);
        return URL.createObjectURL(file);
      }
      const { data: signedData, error: signedError } = await supabase.storage
        .from(AUDIO_BUCKET)
        .createSignedUrl(filePath, 60 * 60 * 8);
      if (!signedError && signedData?.signedUrl) return signedData.signedUrl;
      const { data } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(filePath);
      return data.publicUrl || URL.createObjectURL(file);
    };
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setTrackBuffersLoading(true);
    setPendingUploadsCount((current) => current + files.length);
    const newTracks = files.map((file, index) => ({
      id: crypto.randomUUID(),
        name: file.name.replace(/\.[^/.]+$/, ""),
      color: PALETTE[(tracks.length + index) % PALETTE.length],
        audioUrl: URL.createObjectURL(file),
    }));
    addTracks(newTracks);
    void (async () => {
      await Promise.all(
        files.map(async (file, index) => {
          try {
            const remoteUrl = await uploadToAudioBucket(file);
            if (remoteUrl.startsWith("blob:")) return;
            updateTrackAudioUrl(newTracks[index].id, remoteUrl);
          } finally {
            setPendingUploadsCount((current) => Math.max(0, current - 1));
          }
        })
      );
    })();
    event.currentTarget.value = "";
  };

  const handlePlayToggle = useCallback(async () => {
    const loadingNow = getTrackLoadingState(tracks.map((track) => track.id));
    if (loadingNow.total > 0 && loadingNow.loaded < loadingNow.total) return;
    setTransportLoading(true);
    try {
    const playing = await toggleTransport();
    setIsPlaying(playing);
    } finally {
      setTransportLoading(false);
    }
  }, [tracks]);

  useEffect(() => {
    const ids = tracks.map((track) => track.id);
    if (ids.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading when no tracks exist
      setTrackBuffersLoading(false);
      setTrackLoadedMap({});
      return;
    }
    const tick = () => {
      const state = getTrackLoadingState(ids);
      setTrackBuffersLoading(state.total > 0 && state.loaded < state.total);
      const nextLoaded: Record<string, boolean> = {};
      for (const id of ids) {
        nextLoaded[id] = isTrackLoaded(id);
      }
      setTrackLoadedMap(nextLoaded);
    };
    tick();
    const interval = window.setInterval(tick, 150);
    return () => window.clearInterval(interval);
  }, [tracks]);

  useEffect(() => {
    if (startMode !== "demo" || !demoQueued || !isBootReady || trackBuffersLoading) return;
    if (demoAutoStartedRef.current || tracks.length === 0) return;
    demoAutoStartedRef.current = true;
    void handlePlayToggle();
  }, [demoQueued, isBootReady, startMode, trackBuffersLoading, tracks.length, handlePlayToggle]);

  useEffect(() => {
    const refresh = () => {
      const next: Record<string, TrackAcousticData> = {};
      for (const track of tracks) {
        const data = getTrackAcousticData(track.id);
        if (data) next[track.id] = data;
      }
      setLiveTrackData(next);
    };
    refresh();
    const timer = window.setInterval(refresh, 150);
    return () => window.clearInterval(timer);
  }, [tracks]);

  const summaryData = summaryTrackId ? (liveTrackData[summaryTrackId] ?? null) : null;
  const summaryTrack = summaryTrackId
    ? tracks.find((track) => track.id === summaryTrackId) ?? null
    : null;
  const summaryTrackNumber =
    summaryTrackId != null ? tracks.findIndex((track) => track.id === summaryTrackId) + 1 : 0;
  const playbackDisabled =
    tracks.length === 0 || !isBootReady || trackBuffersLoading || transportLoading;
  const diagnostics = summaryTrackId ? getTrackDiagnostics(summaryTrackId) : null;
  const showDevDiagnostics = process.env.NODE_ENV === "development";
  const shouldShowBootOverlay = workspaceActive && !isBootReady && startMode !== null;

  const handleSummaryCopy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(`${label}: ${value}`);
      setCopyToast(`${label} copied`);
    } catch {
      setCopyToast("copy failed");
    }
    window.setTimeout(() => setCopyToast(null), 1300);
  };

  const sidebarContent = (
    <>
      <section className={`${styles.section} ${isReadOnlyPreview ? styles.readOnlyControls : ""}`}>
        <h2 className={styles.heading}>Room</h2>
        <SketchSlider
          label="width"
          value={roomScale[0]}
          min={0.7}
          max={1.8}
          step={0.05}
          onChange={(v) => setRoomScale([v, roomScale[1], roomScale[2]])}
          formatValue={(v) => `${(10 * v).toFixed(1)}m`}
        />
        <SketchSlider
          label="height"
          value={roomScale[1]}
          min={0.4}
          max={1.5}
          step={0.05}
          onChange={(v) => setRoomScale([roomScale[0], v, roomScale[2]])}
          formatValue={(v) => `${(4 * v).toFixed(1)}m`}
        />
        <SketchSlider
          label="depth"
          value={roomScale[2]}
          min={0.7}
          max={1.8}
          step={0.05}
          onChange={(v) => setRoomScale([roomScale[0], roomScale[1], v])}
          formatValue={(v) => `${(10 * v).toFixed(1)}m`}
        />
      </section>

      <section className={`${styles.section} ${isReadOnlyPreview ? styles.readOnlyControls : ""}`}>
        <h2 className={styles.heading}>Acoustic</h2>
        <p className={styles.rt60}>
          Reverb Time (RT60): {acousticSettings.rt60Ms} ms
        </p>

        <div className={styles.row}>
          <span className={styles.rowLabel}>Room reverb</span>
          <button
            type="button"
            className={`${styles.toggle} ${acousticSettings.enableRoomReverb ? styles.toggleOn : ""}`}
            onClick={() => setEnableRoomReverb(!acousticSettings.enableRoomReverb)}
          >
            {acousticSettings.enableRoomReverb ? "on" : "off"}
          </button>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabelWithHelp}>
            <span className={styles.rowLabel}>Air absorption</span>
            <HelpTooltip text="Simulates how high frequencies fade faster than lows in large rooms. Turning this on makes distant sources sound darker and more realistic." />
          </span>
        <button
          type="button"
            className={`${styles.toggle} ${acousticSettings.enableAirAbsorption ? styles.toggleOn : ""}`}
            onClick={() =>
              setEnableAirAbsorption(!acousticSettings.enableAirAbsorption)
            }
          >
            {acousticSettings.enableAirAbsorption ? "on" : "off"}
        </button>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>Room material</span>
          <div className={styles.selectWrap}>
            <select
              className={styles.select}
              value={acousticSettings.roomMaterial}
              onChange={(e) =>
                setRoomMaterial(e.target.value as RoomMaterialPreset)
              }
            >
              {Object.entries(ACOUSTIC_MATERIALS).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.name}
                </option>
              ))}
            </select>
            <span className={styles.selectChevron} aria-hidden>
              ▾
            </span>
          </div>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabelWithHelp}>
            <span className={styles.rowLabel}>Show attenuation zones</span>
            <HelpTooltip text="Visualizes how sound volume drops over distance. Use this to ensure the back of the club is not too quiet compared to the front." />
          </span>
        <button
          type="button"
            className={`${styles.toggle} ${acousticSettings.showAttenuationZones ? styles.toggleOn : ""}`}
            onClick={() =>
              setShowAttenuationZones(!acousticSettings.showAttenuationZones)
            }
          >
            {acousticSettings.showAttenuationZones ? "on" : "off"}
        </button>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>Show acoustic shadows</span>
          <button
            type="button"
            className={`${styles.toggle} ${acousticSettings.showAcousticShadows ? styles.toggleOn : ""}`}
            onClick={() =>
              setShowAcousticShadows(!acousticSettings.showAcousticShadows)
            }
          >
            {acousticSettings.showAcousticShadows ? "on" : "off"}
          </button>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabelWithHelp}>
            <span className={styles.rowLabel}>Show critical distance</span>
            <HelpTooltip text="The point where room echoes become as loud as the direct sound. Beyond this circle, the music loses clarity and becomes muddy." />
          </span>
          <button
            type="button"
            className={`${styles.toggle} ${acousticSettings.showCriticalDistance ? styles.toggleOn : ""}`}
            onClick={() =>
              setShowCriticalDistance(!acousticSettings.showCriticalDistance)
            }
          >
            {acousticSettings.showCriticalDistance ? "on" : "off"}
          </button>
        </div>

      </section>

      {acousticSettings.showAcousticShadows ? (
        <section className={`${styles.section} ${isReadOnlyPreview ? styles.readOnlyControls : ""}`}>
          <h2 className={styles.heading}>Obstacles</h2>
          <div className={styles.obstacleAddRow}>
          <button
            type="button"
              className={styles.columnAddBtn}
              onClick={() => {
                const id = addObstacle(ROOM_CENTER_POSITION, "cylinder");
                setActiveObstacleId(id);
              }}
            >
              Add Obstacle
          </button>
          </div>
          <ul className={styles.columnList}>
            {obstacles.map((obstacle, index) => (
              <li
                key={obstacle.id}
                className={`${styles.columnRow} ${
                  activeObstacleId === obstacle.id ? styles.columnRowActive : ""
                }`}
              >
                <button
                  type="button"
                  className={styles.columnMeta}
                  onClick={() => setActiveObstacleId(obstacle.id)}
                  title={`Select obstacle ${index + 1}`}
                >
                  <span
                    className={styles.columnColorDot}
                    style={{ backgroundColor: obstacle.color }}
                  />
                  <span className={styles.columnName}>{`Obstacle ${index + 1}`}</span>
          </button>
                <div
                  className={styles.columnColorBadge}
                  style={{ backgroundColor: obstacle.color }}
                  title={`Color for obstacle ${index + 1}`}
                >
                  <input
                    type="color"
                    className={styles.columnColorInputNative}
                    aria-label={`Color for obstacle ${index + 1}`}
                    value={obstacle.color}
                    onChange={(e) => updateObstacle(obstacle.id, { color: e.target.value })}
                  />
        </div>
                <button
                  type="button"
                  className={styles.columnDeleteBtn}
                  aria-label={`Delete obstacle ${index + 1}`}
                  onClick={() => {
                    removeObstacle(obstacle.id);
                    if (activeObstacleId === obstacle.id) {
                      setActiveObstacleId(null);
                    }
                  }}
                >
                  ×
                </button>
                <div className={styles.obstacleControls}>
                  <div className={styles.obstacleControlRow}>
                    <span className={styles.obstacleControlLabel}>shape</span>
                    <div className={styles.selectWrap}>
                      <select
                        className={styles.select}
                        value={obstacle.type}
                        onChange={(e) => {
                          const nextType = e.target.value as ObstacleType;
                          if (nextType === "box") {
                            updateObstacle(obstacle.id, {
                              type: nextType,
                              width: 1.2,
                              depth: 1.2,
                              rotationDeg: obstacle.rotationDeg,
                              windowOffsetPct: obstacle.windowOffsetPct,
                            });
                            return;
                          }
                          if (nextType === "wall-with-window") {
                            updateObstacle(obstacle.id, {
                              type: nextType,
                              width: 2.0,
                              depth: 0.45,
                              rotationDeg: obstacle.rotationDeg,
                              windowOffsetPct: obstacle.windowOffsetPct,
                            });
                            return;
                          }
                          updateObstacle(obstacle.id, {
                            type: nextType,
                            rotationDeg: obstacle.rotationDeg,
                            windowOffsetPct: obstacle.windowOffsetPct,
                          });
                        }}
                      >
                        {OBSTACLE_TYPE_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className={styles.selectChevron} aria-hidden>
                        ▾
                      </span>
                    </div>
                  </div>
                  {obstacle.type === "cylinder" ? (
                    <SketchSlider
                      label="radius"
                      value={obstacle.radius}
                      min={0.2}
                      max={2}
                      step={0.05}
                      onChange={(v) => updateObstacle(obstacle.id, { radius: v })}
                      formatValue={(v) => `${v.toFixed(2)}m`}
                    />
                  ) : null}
                  {obstacle.type === "box" ? (
                    <div className={styles.obstacleSliderGrid}>
                      <SketchSlider
                        label="width"
                        value={obstacle.width ?? 1.2}
                        min={0.3}
                        max={8}
                        step={0.1}
                        onChange={(v) => updateObstacle(obstacle.id, { width: v })}
                        formatValue={(v) => `${v.toFixed(2)}m`}
                      />
                      <SketchSlider
                        label="depth"
                        value={obstacle.depth ?? 1.2}
                        min={0.3}
                        max={6}
                        step={0.1}
                        onChange={(v) => updateObstacle(obstacle.id, { depth: v })}
                        formatValue={(v) => `${v.toFixed(2)}m`}
                      />
                    </div>
                  ) : null}
                  {obstacle.type === "wall-with-window" ? (
                    <div className={styles.obstacleSliderGrid}>
                      <SketchSlider
                        label="window width"
                        value={obstacle.width ?? 2}
                        min={0.2}
                        max={8}
                        step={0.05}
                        onChange={(v) => updateObstacle(obstacle.id, { width: v })}
                        formatValue={(v) => `${v.toFixed(2)}m`}
                      />
                      <SketchSlider
                        label="rotation"
                        value={obstacle.rotationDeg}
                        min={0}
                        max={359}
                        step={1}
                        onChange={(v) => setObstacleRotationDeg(obstacle.id, v)}
                        formatValue={(v) => `${Math.round(v)}deg`}
                      />
                      <SketchSlider
                        label="window offset"
                        value={obstacle.windowOffsetPct}
                        min={0.05}
                        max={0.95}
                        step={0.01}
                        onChange={(v) => updateObstacle(obstacle.id, { windowOffsetPct: v })}
                        formatValue={(v) => `${Math.round(v * 100)}%`}
                      />
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.heading}>Tracks</h2>

        <div className={isReadOnlyPreview ? styles.previewPlayable : undefined}>
          <PlayerBar
            isPlaying={isPlaying}
            disabled={playbackDisabled}
            loading={transportLoading || trackBuffersLoading || !isBootReady}
            onTogglePlay={handlePlayToggle}
          />
        </div>

        <div className={isReadOnlyPreview ? styles.readOnlyControls : undefined}>
        <ul className={styles.trackList}>
          {tracks.map((track, idx) => (
            <li key={track.id} className={styles.trackCard}>
              <div className={styles.trackItem}>
                <span
                  className={styles.colorDot}
                  style={{ backgroundColor: track.color }}
                />
                <span className={styles.trackIndex}>{idx + 1}</span>
              <input
                  className={styles.trackName}
                value={track.name}
                  onChange={(e) => updateTrackName(track.id, e.target.value)}
              />
              <button
                type="button"
                  className={styles.summaryBtn}
                  onClick={() => {
                    if (isNarrowScreen) {
                      setExpandedTrackIds((current) => ({
                        ...current,
                        [track.id]: !current[track.id],
                      }));
                      return;
                    }
                    setSummaryTrackId(track.id);
                    setSummaryDrawerOpen(true);
                  }}
                  aria-label={`Open settings summary for ${track.name}`}
                  title={isNarrowScreen ? "Details" : "Settings Summary"}
                >
                  i
                </button>
                <button
                  type="button"
                  className={`${styles.circleBtn} ${track.muted ? styles.circleBtnOn : ""}`}
                onClick={() => toggleTrackMute(track.id)}
                  title="Mute"
              >
                  m
              </button>
              <button
                type="button"
                  className={`${styles.circleBtn} ${track.solo ? styles.circleBtnOn : ""}`}
                onClick={() => toggleTrackSolo(track.id)}
                  title="Solo"
              >
                  s
              </button>
                {!isProjectEditable ? null : (
                  <button
                    type="button"
                    className={`${styles.removeBtn} ${
                      !trackLoadedMap[track.id] ? styles.removeBtnDisabled : ""
                    }`}
                    onClick={() => removeTrack(track.id)}
                    disabled={!trackLoadedMap[track.id]}
                    aria-label={`Remove ${track.name}`}
                    title={!trackLoadedMap[track.id] ? "Wait until track loads" : "Remove track"}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className={styles.trackGainRow}>
                <SketchSlider
                  label="gain"
                  value={Number.isFinite(track.gainDb) ? track.gainDb : -60}
                  min={-60}
                  max={12}
                  step={1}
                  onChange={(v) => setTrackGainDb(track.id, v)}
                  formatValue={(v) => (v <= -60 ? "-inf dB" : `${v >= 0 ? "+" : ""}${v} dB`)}
                />
              </div>
              {acousticSettings.showAcousticShadows ? (
                <div className={styles.trackDirectivityRow}>
                  <span className={styles.trackDirectivityLabel}>show shadows</span>
                  <button
                    type="button"
                    className={`${styles.toggle} ${track.showShadows ? styles.toggleOn : ""}`}
                    onClick={() => toggleTrackShadows(track.id)}
                    aria-label={`Toggle acoustic shadows for ${track.name}`}
                    title="Show acoustic shadows from this source"
                  >
                    {track.showShadows ? "on" : "off"}
                  </button>
                </div>
              ) : null}
              <div className={styles.trackDirectivityRow}>
                <span className={styles.trackDirectivityLabel}>direction</span>
                <button
                  type="button"
                  className={`${styles.toggle} ${track.isDirectivityEnabled ? styles.toggleOn : ""}`}
                  onClick={() => toggleTrackDirectivity(track.id)}
                  aria-label={`Toggle directivity for ${track.name}`}
                  title="Direction on/off"
                >
                  {track.isDirectivityEnabled ? "on" : "off"}
                </button>
              </div>
              {track.isDirectivityEnabled ? (
                <div className={styles.trackRotationRow}>
                  <RotationDial
                    value={track.rotationDeg}
                    onChange={(v) => setTrackRotationDeg(track.id, v)}
                  />
                </div>
              ) : null}
              {isNarrowScreen && expandedTrackIds[track.id] ? (
                <div className={styles.mobileDetails}>
                  {liveTrackData[track.id] ? (
                    <>
                      <div className={styles.mobileDetailCell}>
                        <span className={styles.mobileDetailKey}>Gain</span>
                        <span className={styles.mobileDetailValue}>
                          {Number.isFinite(liveTrackData[track.id].gainDb)
                            ? `${liveTrackData[track.id].gainDb.toFixed(1)} dB`
                            : "-inf dB"}
                        </span>
                      </div>
                      <div className={styles.mobileDetailCell}>
                        <span className={styles.mobileDetailKey}>Pan</span>
                        <span className={styles.mobileDetailValue}>
                          {liveTrackData[track.id].panningText}
                        </span>
                      </div>
                      <div className={styles.mobileDetailCell}>
                        <span className={styles.mobileDetailKey}>Filter</span>
                        <span className={styles.mobileDetailValue}>
                          {liveTrackData[track.id].filterHz} Hz
                        </span>
                      </div>
                      <div className={styles.mobileDetailCell}>
                        <span className={styles.mobileDetailKey}>Reverb</span>
                        <span className={styles.mobileDetailValue}>
                          {liveTrackData[track.id].reverbSendPct}% wet
                        </span>
                      </div>
                      <div className={styles.mobileDetailCell}>
                        <span className={styles.mobileDetailKey}>Occluded</span>
                        <span className={styles.mobileDetailValue}>
                          {liveTrackData[track.id].occluded ? "Yes" : "No"}
                        </span>
                      </div>
                    </>
                  ) : (
                    <span className={styles.mobileDetailKey}>No live data yet.</span>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        {!isProjectEditable ? null : (
          <div className={styles.addColumn}>
            <label className={styles.addBtn}>
              Add track
            <input
                type="file"
                accept="audio/*"
                multiple
                onChange={handleFileAdd}
            />
          </label>
          </div>
        )}
        </div>
      </section>
    </>
  );

  if (isAppInitializing || appPhase === "initializing" || appPhase === "projectLoading") {
    return (
      <main className={styles.page}>
        <div className={styles.appInitializing}>
          <span className={styles.spinner} aria-hidden />
          <p>Loading workspace...</p>
        </div>
      </main>
    );
  }

  const syncStatusClassName =
    saveState === "saved"
      ? `${styles.syncStatus} ${styles.syncStatusSuccess}`
      : saveState === "error"
        ? `${styles.syncStatus} ${styles.syncStatusError}`
        : styles.syncStatus;
  const showWorkspaceProjectControls = workspaceActive && !isReadOnlyPreview;

  const workspaceHeader = session ? (
    <header
      className={`${styles.workspaceHeader}${
        appPhase === "dashboard" ? ` ${styles.workspaceHeaderInFlow}` : ""
      }`}
    >
      <button
        type="button"
        className={styles.workspaceBrand}
        onClick={showWorkspaceProjectControls ? () => void openProjectsDashboard() : undefined}
        aria-label="Go to projects dashboard"
      >
        foam
      </button>
      <div className={styles.profileWrap} ref={profileWrapRef}>
        {workspaceActive && currentProjectId && !isReadOnlyPreview && !isDemoScene ? (
          <button
            type="button"
            className={styles.shareProjectBtn}
            onClick={() => void handleShareProject()}
          >
            share project
          </button>
        ) : null}
        {showWorkspaceProjectControls && isDemoScene ? (
          <span className={styles.demoProjectIndicator}>Demo project</span>
        ) : null}
        {showWorkspaceProjectControls && syncStatusText ? (
          <span className={syncStatusClassName}>
            {syncStatusText}
          </span>
        ) : null}
        <button
          type="button"
          className={styles.profileAvatar}
          onClick={() => setProfileMenuOpen((value) => !value)}
          aria-label="Open profile menu"
        >
          {user?.user_metadata?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={String(user.user_metadata.avatar_url)}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <span>{avatarFallbackLetter}</span>
          )}
        </button>
        {profileMenuOpen ? (
          <div className={styles.profileMenu} style={{ viewTransitionName: "profile-menu" }}>
            {username ? <p className={styles.profileEmail}>{username}</p> : null}
            <p className={styles.profileEmail}>{user?.email}</p>
            {showWorkspaceProjectControls ? (
              isDemoScene ? (
                <>
                  <button
                    type="button"
                    className={styles.profileAction}
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void startApp("clean");
                    }}
                    disabled={profileBusy}
                  >
                    new project
                  </button>
                  <button
                    type="button"
                    className={styles.profileAction}
                    onClick={() => void openProjectsDashboard()}
                    disabled={profileBusy}
                  >
                    My Projects
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    className={styles.profilePasswordInput}
                    value={currentProjectTitle}
                    onChange={(event) => {
                      void handleProjectTitleChange(event.target.value);
                    }}
                    placeholder="project title"
                    disabled={profileBusy || projectTitleBusy || !isProjectEditable}
                  />
                  <button
                    type="button"
                    className={styles.profileAction}
                    onClick={() => void handleForceSaveNow()}
                    disabled={profileBusy || !isProjectEditable}
                  >
                    Save Project Now
                  </button>
                  <button
                    type="button"
                    className={styles.profileAction}
                    onClick={() => void openProjectsDashboard()}
                    disabled={profileBusy}
                  >
                    My Projects
                  </button>
                </>
              )
            ) : null}
            <button
              type="button"
              className={styles.profileAction}
              onClick={() => setChangePasswordOpen((value) => !value)}
              disabled={profileBusy}
            >
              Change Password
            </button>
            {changePasswordOpen ? (
              <div className={styles.profilePasswordRow}>
                <input
                  type="password"
                  className={styles.profilePasswordInput}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="new password"
                  disabled={profileBusy}
                />
                <button
                  type="button"
                  className={styles.profileAction}
                  onClick={() => void handleChangePassword()}
                  disabled={profileBusy || newPassword.trim().length < 6}
                >
                  Save
                </button>
              </div>
            ) : null}
            {showWorkspaceProjectControls && isDemoScene ? (
              <span className={styles.demoBadge}>DEMO - READ ONLY</span>
            ) : null}
            <button
              type="button"
              className={styles.profileDanger}
              onClick={() => void handleSignOut()}
              disabled={profileBusy}
            >
              Log Out
            </button>
            {profileError ? <p className={styles.profileError}>{profileError}</p> : null}
          </div>
        ) : null}
      </div>
    </header>
  ) : isReadOnlyPreview ? (
    <div className={styles.previewGuestHeader}>
      <span className={styles.previewGuestBrand}>foam</span>
    </div>
  ) : null;

  if (appPhase === "dashboard") {
    return (
      <main className={`${styles.page} ${styles.dashboardPage}`}>
        <div className={styles.dashboardShell}>
          {workspaceHeader}
          <ProjectsDashboard
          projects={projects.map(toProjectListItem)}
          isLoading={projectsLoading}
          currentProjectId={currentProjectId}
          onOpenProject={(projectId) => void handleOpenProjectFromDashboard(projectId)}
          onRenameProject={handleRenameProjectFromDashboard}
          onDeleteProject={handleDeleteProjectFromDashboard}
          onShareProject={(projectId) => void handleShareProject(projectId)}
          onStartClean={() => void startApp("clean")}
          onLoadDemo={() => void startApp("demo")}
        />
        </div>
      </main>
    );
  }

  if (
    (appPhase === "unauthenticated" || appPhase === "onboarding") &&
    !projectIdFromPath
  ) {
    return (
      <main className={styles.page}>
        <Landing onStartClean={() => void startApp("clean")} onStartDemo={() => void startApp("demo")} />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      {workspaceHeader}
      {workspaceActive && isReadOnlyPreview ? (
        <div className={styles.previewDock}>
          <span className={styles.previewBadge}>preview mode (read-only)</span>
          {sessionUserId ? (
            <button
              type="button"
              className={styles.previewPrimaryBtn}
              onClick={() => void handleCloneToWorkspace()}
              disabled={isHydrating}
            >
              clone to my workspace
            </button>
          ) : (
            <PreviewLoginActions primaryButtonClassName={styles.previewPrimaryBtn} />
          )}
        </div>
      ) : null}
      {shouldShowBootOverlay ? (
        <div className={styles.loadingScreen}>
          <h1>Sketching Spatial Lab</h1>
          <p>Loading assets and audio buffers... {loadingProgress}%</p>
        </div>
      ) : null}

      <section className={styles.cameraToolbar}>
        <button
          type="button"
          className={`${styles.viewBtn} ${view === "isometric" ? styles.viewBtnActive : ""}`}
          onClick={() => setView("isometric")}
          aria-label="Isometric view"
          title="Isometric"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3 L21 8 L21 16 L12 21 L3 16 L3 8 Z" />
            <path d="M12 3 L12 21" />
            <path d="M3 8 L21 8" />
          </svg>
        </button>
        <button
          type="button"
          className={`${styles.viewBtn} ${view === "top-down" ? styles.viewBtnActive : ""}`}
          onClick={() => setView("top-down")}
          aria-label="Top-down view"
          title="Top-down"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="1" />
          </svg>
        </button>
      </section>

      <aside className={styles.sidebar}>{sidebarContent}</aside>

      <button
        type="button"
        className={styles.settingsGear}
        aria-label="Open settings"
        onClick={() => setIsMobilePanelOpen(true)}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </svg>
      </button>

      {isMobilePanelOpen ? (
        <div className={styles.mobileOverlay}>
          <aside className={`${styles.sidebar} ${styles.mobileSidebar}`}>
            <button
              type="button"
              className={styles.mobileClose}
              aria-label="Close settings"
              onClick={() => setIsMobilePanelOpen(false)}
            >
              ×
            </button>
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      <section className={styles.canvasWrap}>
        {isBootReady ? (
          <SceneCanvas
            view={view}
            zoomSteps={zoomSteps}
            listenerPosition={listenerPosition}
            onListenerPositionChange={setListenerPosition}
            onActiveObstacleChange={setActiveObstacleId}
            isReadOnly={isReadOnlyPreview}
          />
        ) : null}
      </section>

      {!isNarrowScreen ? (
        <aside
          className={`${styles.summaryDrawer} ${
            summaryDrawerOpen ? styles.summaryDrawerOpen : styles.summaryDrawerClosed
          }`}
        >
          {summaryDrawerOpen ? (
            <>
              <div className={styles.summaryHeader}>
                <h3 className={styles.summaryTitle}>
                  {summaryTrack ? (
                    <span className={styles.summaryTrackTitle}>
                      <span
                        className={styles.summaryTrackDot}
                        style={{ backgroundColor: summaryTrack.color }}
                      />
                      <span className={styles.summaryTrackPrefix}>{`Track #${summaryTrackNumber}:`}</span>
                      <span
                        className={styles.summaryTrackName}
                        title={`Track #${summaryTrackNumber}: ${summaryTrack.name}`}
                      >
                        {summaryTrack.name}
                      </span>
                    </span>
                  ) : (
                    "Settings Summary"
                  )}
                </h3>
                <button
                  type="button"
                  className={styles.summaryClose}
                  onClick={() => setSummaryDrawerOpen(false)}
                  aria-label="Close settings summary"
                >
                  ×
                </button>
              </div>
              {summaryTrackId && summaryData ? (
                <div className={styles.summaryBody}>
                  {renderSummaryRows(summaryData, handleSummaryCopy)}
                </div>
              ) : (
                <div className={styles.summaryEmptyState}>
                  <p className={styles.summaryEmpty}>No track selected yet.</p>
                  <p className={styles.summaryEmptyHint}>
                    Click the info button on any track to open live diagnostics here.
                  </p>
                </div>
              )}
              {showDevDiagnostics && diagnostics ? (
                <div className={styles.devDiagnosticsRows}>
                  <div className={styles.summaryRowNoCopy}>
                    <span className={styles.summaryKey}>Raw Distance</span>
                    <span className={styles.summaryValue}>{diagnostics.distanceM.toFixed(2)}m</span>
                  </div>
                  <div className={styles.summaryRowNoCopy}>
                    <span className={styles.summaryKey}>Attenuation</span>
                    <span className={styles.summaryValue}>{diagnostics.attenuationDb.toFixed(1)} dB</span>
                  </div>
                  <div className={styles.summaryRowNoCopy}>
                    <span className={styles.summaryKey}>Directivity Angle / Gain</span>
                    <span className={styles.summaryValue}>
                      {diagnostics.directivityAngleDeg.toFixed(1)}deg /{" "}
                      {diagnostics.directivityGainDb.toFixed(1)} dB
                    </span>
                  </div>
                  <div className={styles.summaryRowNoCopy}>
                    <span className={styles.summaryKey}>Occlusion Filter</span>
                    <span className={styles.summaryValue}>
                      {Math.round(diagnostics.lowPassCutoffHz)} Hz
                    </span>
                  </div>
                  <div className={styles.summaryRowNoCopy}>
                    <span className={styles.summaryKey}>Occlusion Loss</span>
                    <span className={styles.summaryValue}>
                      {diagnostics.occlusionLossDb.toFixed(1)} dB
                    </span>
                  </div>
                  <div className={styles.summaryRowNoCopy}>
                    <span className={styles.summaryKey}>Blocking Columns</span>
                    <span className={styles.summaryValue}>{diagnostics.occluderCount}</span>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className={styles.summaryPeek}
              onClick={() => setSummaryDrawerOpen(true)}
              aria-label="Open settings summary"
            >
              Settings Summary
            </button>
          )}
        </aside>
      ) : null}

      {copyToast ? <div className={styles.copyToast}>{copyToast}</div> : null}

      <div className={styles.zoomControls}>
        <button
          type="button"
          className={styles.zoomBtn}
          aria-label="Zoom out"
          onClick={() => setZoomSteps((z) => Math.max(-6, z - 1))}
        >
          −
        </button>
        <button
          type="button"
          className={styles.zoomBtn}
          aria-label="Zoom in"
          onClick={() => setZoomSteps((z) => Math.min(8, z + 1))}
        >
          +
        </button>
      </div>
    </main>
  );
}

function AppShellLoading({ message = "Loading workspace..." }: { message?: string }) {
  return (
    <main className={styles.page}>
      <div className={styles.appInitializing}>
        <span className={styles.spinner} aria-hidden />
        <p>{message}</p>
      </div>
    </main>
  );
}

function ClientHome() {
  const { session, isLoading } = useAuthStore();
  const pathname = usePathname();
  const needsWorkspaceShell = isProjectSharePath(pathname);

  if (isLoading) {
    return <AppShellLoading message="Loading..." />;
  }

  if (!needsWorkspaceShell && !session) {
    return (
      <main className={styles.page}>
        <Landing
          onStartClean={() => undefined}
          onStartDemo={() => undefined}
        />
      </main>
    );
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  return (
    <TrackStoreProvider>
      <MixerPage />
    </TrackStoreProvider>
  );
}

export default function HomePage() {
  return <ClientHome />;
}
