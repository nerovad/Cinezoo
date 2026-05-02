import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Hls from "hls.js";
import "./VideoPlayer.scss";
import Chatbox from "../Chatbox/Chatbox";
import "../../styles/_variables.scss";
import muteIcon from "../../assets/mute_icon.svg";
import intermissionDefault from "../../assets/intermission.mp4";
import { useChatStore } from "../../store/useChatStore";

interface VideoLink {
  src: string;
  channel: string;
  isLive?: boolean;
  channelNumber: number;
  displayName?: string;
  tags?: string[];
  intermissionUrl?: string | null;
}

interface VideoPlayerProps {
  isMenuOpen: boolean;
  isChatOpen: boolean;
  setVideoControls: (controls: {
    currentIndex: number;
    setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
    videoLinks: VideoLink[];
    videoRef: React.RefObject<HTMLVideoElement>;
    goToNextVideo: () => void;
    goToPreviousVideo: () => void;
    toggleMute: () => void;
    toggleFullscreen: () => void;
    loadVideo: (src: string) => void;
  }) => void;
  channelSlug?: string;
  isMobile?: boolean;
}

const HLS_BASE = "https://cinezoo.tv:8088";
const INTRO_VIDEO_SRC = "/videos/0001-0250.mp4";

const VideoPlayer: React.FC<VideoPlayerProps> = ({ isMenuOpen, isChatOpen, setVideoControls, isMobile = false }) => {
  const { channelSlug } = useParams<{ channelSlug: string }>();
  const navigate = useNavigate();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const endedListenerRef = useRef<(() => void) | null>(null);
  const switchingRef = useRef(false);
  const retryRef = useRef(0);
  const initialLoadRef = useRef(false);
  const hasUserInteractedRef = useRef(false);
  const userExplicitlyMutedRef = useRef(false);
  const goToNextVideoRef = useRef<(() => void) | null>(null);
  const introCompleteRef = useRef(false);

  const { setChannelId } = useChatStore();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [channelName, setChannelName] = useState("");
  const [, setIsMuted] = useState(true);
  const [showMuteIcon, setShowMuteIcon] = useState(true);
  const [showIntermission, setShowIntermission] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [videoLinks, setVideoLinks] = useState<VideoLink[]>([
    { src: "/videos/Color_Bars_DB_Web.mp4", channel: "channel-0", channelNumber: 0, isLive: false },
  ]);

  const getClassNames = () => {
    // On mobile, don't add margin classes since sidebars overlay
    if (isMobile) return "mobile";

    let classNames = "";
    if (isMenuOpen) classNames += " expanded-left";
    if (isChatOpen) classNames += " expanded-right";
    if (isMenuOpen && isChatOpen) classNames = "expanded-both";
    return classNames.trim();
  };

  const cleanupHls = () => {
    const v = videoRef.current;
    if (v) {
      v.pause();
      if (endedListenerRef.current) {
        v.removeEventListener("ended", endedListenerRef.current as any);
        endedListenerRef.current = null;
      }
      v.removeAttribute("src");
      v.load();
    }
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch { }
      hlsRef.current = null;
    }
    retryRef.current = 0;
  };

  const attachEndedForMp4 = () => {
    const v = videoRef.current;
    if (!v) return;
    const onEnded = () => {
      const currentSrc = videoRef.current?.currentSrc ?? "";
      if (!introCompleteRef.current) {
        if (currentSrc.includes("Color_Bars")) {
          console.log("[attachEndedForMp4] Color bars ended, playing intro");
          loadVideo(INTRO_VIDEO_SRC);
          return;
        }
        if (currentSrc.includes("0001-0250")) {
          introCompleteRef.current = true;
        }
      }
      console.log("[attachEndedForMp4] Video ended, calling goToNextVideo");
      if (goToNextVideoRef.current) {
        goToNextVideoRef.current();
      } else {
        console.log("[attachEndedForMp4] goToNextVideoRef.current is null!");
      }
    };
    v.addEventListener("ended", onEnded);
    endedListenerRef.current = () => v.removeEventListener("ended", onEnded);
  };

  const loadVideo = useCallback(async (src: string) => {
    console.log("[loadVideo] Loading:", src);
    const v = videoRef.current;
    if (!v) {
      console.log("[loadVideo] No video element!");
      return;
    }

    cleanupHls();
    setShowIntermission(false);

    // Only force mute on the very first load (browser autoplay policy).
    // After the user has unmuted, preserve their preference on channel switches.
    const shouldMute = !hasUserInteractedRef.current;

    if (src.endsWith(".mp4")) {
      console.log("[loadVideo] Loading MP4, attaching ended listener");
      v.src = src;
      attachEndedForMp4();
      v.muted = shouldMute;
      v.play().catch(() => {
        // If play fails unmuted, mute and retry (browser policy)
        v.muted = true;
        setIsMuted(true);
        setShowMuteIcon(true);
        v.play().catch(() => { });
      });
      return;
    }

    // Pre-check if the HLS manifest exists before creating an HLS instance
    if (src.includes(".m3u8")) {
      try {
        const res = await fetch(src, { method: "HEAD" });
        if (!res.ok) {
          console.log("[loadVideo] Stream offline (HTTP", res.status, "), showing intermission");
          setShowIntermission(true);
          return;
        }
      } catch {
        console.log("[loadVideo] Stream unreachable, showing intermission");
        setShowIntermission(true);
        return;
      }
    }

    if (Hls.isSupported()) {
      // @ts-expect-error hls.js types don't match runtime API for config
      const hls = new Hls({
        liveBackBufferLength: 0,
        backBufferLength: 0,
        maxBufferLength: 10,
        maxBufferSize: 60 * 1000 * 1000,
        enableWorker: true,
        lowLatencyMode: false,
      });

      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(v);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        v.muted = shouldMute;
        v.play().catch(() => {
          v.muted = true;
          setIsMuted(true);
          setShowMuteIcon(true);
          v.play().catch(() => { });
        });
      });

      hls.on(Hls.Events.ERROR, (_evt: any, data: any) => {
        const fatal = !!data?.fatal;
        const type = data?.type as string | undefined;
        if (!fatal) return;

        if (type === "networkError") {
          if (retryRef.current < 3) {
            retryRef.current += 1;
            (hls as any).startLoad?.();
          } else {
            console.log("[VideoPlayer] Stream offline after retries, showing intermission");
            setShowIntermission(true);
          }
        } else if (type === "mediaError") {
          try {
            (hls as any).recoverMediaError?.();
          } catch {
            setShowIntermission(true);
          }
        } else {
          setShowIntermission(true);
        }
      });

      return;
    }

    const vtag = videoRef.current;
    if (vtag?.canPlayType("application/vnd.apple.mpegurl")) {
      vtag.src = src;
      vtag.muted = shouldMute;
      vtag.play().catch(() => {
        vtag.muted = true;
        setIsMuted(true);
        setShowMuteIcon(true);
        vtag.play().catch(() => { });
      });
      return;
    }

    console.error("This browser cannot play HLS.");
  }, []);

  // ✅ Navigate to new channel URL
  const switchToIndex = (idx: number) => {
    console.log("[switchToIndex] Called with idx:", idx, "videoLinks.length:", videoLinks.length);
    if (switchingRef.current) {
      console.log("[switchToIndex] Already switching, ignoring");
      return;
    }
    switchingRef.current = true;
    introCompleteRef.current = true;

    const safeIdx = ((idx % videoLinks.length) + videoLinks.length) % videoLinks.length;
    const dest = videoLinks[safeIdx];
    console.log("[switchToIndex] Navigating to:", dest.channel, "at index:", safeIdx);

    // ✅ Update URL instead of just state
    navigate(`/channel/${dest.channel}`, { replace: true });

    setTimeout(() => {
      switchingRef.current = false;
    }, 200);
  };

  const goToNextVideo = useCallback(() => switchToIndex(currentIndex + 1), [currentIndex, videoLinks.length]);
  const goToPreviousVideo = useCallback(() => switchToIndex(currentIndex - 1), [currentIndex, videoLinks.length]);

  // Keep ref updated so loadVideo can always call the latest version
  useEffect(() => {
    goToNextVideoRef.current = goToNextVideo;
  }, [goToNextVideo]);

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    const muted = !v.muted;
    v.muted = muted;
    userExplicitlyMutedRef.current = muted;
    if (!muted) hasUserInteractedRef.current = true;
    setIsMuted(muted);
    setShowMuteIcon(muted);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen().catch(() => { });
    else document.exitFullscreen().catch(() => { });
  };

  // Set video ready state when component mounts
  useEffect(() => {
    const checkVideo = () => {
      if (videoRef.current && !isVideoReady) {
        console.log("[VideoPlayer] Video element is ready");
        setIsVideoReady(true);
      } else if (!videoRef.current) {
        // Retry on next frame if not ready yet
        requestAnimationFrame(checkVideo);
      }
    };
    checkVideo();
  }, []);

  // Mirror the video element's muted state into the overlay icon, so any
  // path that flips muted (slider, M key, remote, programmatic) stays in sync.
  useEffect(() => {
    if (!isVideoReady) return;
    const v = videoRef.current;
    if (!v) return;
    const sync = () => {
      setIsMuted(v.muted);
      setShowMuteIcon(v.muted);
    };
    v.addEventListener("volumechange", sync);
    return () => v.removeEventListener("volumechange", sync);
  }, [isVideoReady]);


  // ✅ Fetch channels
  // ✅ Fetch channels
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await fetch("/api/channels");
        const channels = await res.json();

        console.log("Raw API response:", channels); // ⬅️ ADD THIS

        const dynamic: VideoLink[] = channels
          .map((ch: any) => {
            const key = ch.stream_key ?? ch.slug ?? ch.key;
            if (!key) return null;
            const src = `${HLS_BASE}/hls/${key}/index.m3u8`;
            return {
              src,
              channel: ch.slug ?? key,
              channelNumber: ch.channel_number ?? 0,
              displayName: ch.display_name ?? null,
              tags: ch.tags ?? [],
              intermissionUrl: ch.intermission_url ?? null,
              isLive: true
            };
          })
          .filter(Boolean) as VideoLink[];

        // Sort AFTER the filter and cast
        dynamic.sort((a: VideoLink, b: VideoLink) => a.channelNumber - b.channelNumber);

        console.log("Dynamic videoLinks after sorting:", dynamic); // ⬅️ ADD THIS

        if (alive) {
          setVideoLinks(prev => {
            const updated = [prev[0], ...dynamic];
            console.log("Final videoLinks array:", updated); // ⬅️ ADD THIS
            return updated;
          });
        }
      } catch (e) {
        console.error("Failed to fetch channels", e);
      }
    })();

    return () => { alive = false; };
  }, []);
  // ✅ Sync URL parameter to video player state
  useEffect(() => {
    console.log("[VideoPlayer] Sync effect running:", {
      channelSlug,
      videoLinksLength: videoLinks.length,
      currentIndex,
      initialLoad: initialLoadRef.current,
      isVideoReady
    });

    if (!channelSlug || videoLinks.length === 0) {
      console.log("[VideoPlayer] Exiting early - no channelSlug or videoLinks");
      return;
    }

    if (!isVideoReady) {
      console.log("[VideoPlayer] Exiting early - video element not ready yet");
      return;
    }

    const idx = videoLinks.findIndex(link => link.channel === channelSlug);
    console.log("[VideoPlayer] Found index for", channelSlug, ":", idx);

    // Load video if: 1) switching to a different channel, OR 2) initial load
    if (idx !== -1 && (idx !== currentIndex || !initialLoadRef.current)) {
      console.log("[VideoPlayer] Loading video:", videoLinks[idx]);
      // If the user lands directly on any channel other than the color-bars
      // entry (index 0), skip the intro chain entirely.
      if (idx !== 0) introCompleteRef.current = true;
      setCurrentIndex(idx);
      const link = videoLinks[idx];

      // Auto-unmute when switching away from the initial channel,
      // unless the user explicitly muted. Must happen BEFORE loadVideo
      // so that shouldMute evaluates to false inside loadVideo.
      if (initialLoadRef.current && !userExplicitlyMutedRef.current) {
        hasUserInteractedRef.current = true;
        setIsMuted(false);
        setShowMuteIcon(false);
      }

      loadVideo(link.src);
      setChannelId(link.channel);
      setChannelName(link.channel);
      initialLoadRef.current = true;

      const hide = setTimeout(() => setChannelName(""), 7000);
      return () => clearTimeout(hide);
    } else {
      console.log("[VideoPlayer] Skipping load:", { idx, currentIndex, initialLoad: initialLoadRef.current });
    }
  }, [channelSlug, videoLinks, isVideoReady, loadVideo, setChannelId]);

  // ✅ Provide controls to NavBar
  useEffect(() => {
    setVideoControls({
      currentIndex,
      setCurrentIndex,
      videoLinks,
      videoRef,
      goToNextVideo,
      goToPreviousVideo,
      toggleMute,
      toggleFullscreen,
      loadVideo,
    });
  }, [currentIndex, videoLinks]);

  // ✅ Keyboard shortcuts
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.getAttribute("contenteditable") === "true")) return;
      switch (event.key.toLowerCase()) {
        case "m": toggleMute(); break;
        case "f": toggleFullscreen(); break;
        case "arrowdown": goToPreviousVideo(); break;
        case "arrowup": goToNextVideo(); break;
      }
    };
    const handleRightClick = (e: MouseEvent) => { e.preventDefault(); goToPreviousVideo(); };

    document.addEventListener("keydown", handleKey);
    document.addEventListener("contextmenu", handleRightClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("contextmenu", handleRightClick);
    };
  }, [goToNextVideo, goToPreviousVideo]);

  useEffect(() => () => cleanupHls(), []);

  // Resolve the intermission source: custom per-channel or system default
  const currentLink = videoLinks[currentIndex];
  const intermissionSrc = currentLink?.intermissionUrl || intermissionDefault;
  const isIntermissionVideo = !intermissionSrc || /\.(mp4|webm|ogg|mov)(\?|$)/i.test(intermissionSrc) || intermissionSrc === intermissionDefault;

  return (
    <div className={`video-container-dboriginals ${getClassNames()}`}>
      <div className="tv-container" ref={containerRef}>
        <video
          className="myvideo"
          ref={videoRef}
          muted
          autoPlay
          preload="metadata"
          playsInline
          controls={false}
          style={showIntermission ? { display: "none" } : undefined}
        />
        {showIntermission && (
          <div className="intermission-screen">
            {isIntermissionVideo ? (
              <video
                src={intermissionSrc}
                className="intermission-video"
                autoPlay
                loop
                muted={!hasUserInteractedRef.current}
                playsInline
              />
            ) : (
              <img
                src={intermissionSrc}
                className="intermission-video"
                alt="Intermission"
              />
            )}
          </div>
        )}
        <div className="db-originals-next-button" onClick={goToNextVideo}>
          <div className="channelnumber">{channelName}</div>
        </div>
        {showMuteIcon && !showIntermission && <img src={muteIcon} alt="Muted" className="mute-icon-overlay" onClick={(e) => { e.stopPropagation(); toggleMute(); }} />}
      </div>

      <Chatbox isOpen={isChatOpen} setIsOpen={() => { }} />
    </div>
  );
};

export default VideoPlayer;
