import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./store/AuthContext";
import { useUIStore } from "./store/useUIStore";
import { useIsMobile } from "./hooks/useIsMobile";
import NavBar from "./components/Navigation/Navigation.tsx";
import NewsTicker from "./components/NewsTicker/NewsTicker.tsx";
import TvGuide from "./components/TvGuide/TvGuide.tsx";
import VideoPlayer from "./components/VideoPlayer/VideoPlayer.tsx";
import Channels from "./components/Menu/Menu.tsx";
import Chatbox from "./components/Chatbox/Chatbox.tsx";
import Auth from "./components/Auth/Auth.tsx";
import Settings from "./components/Settings/Settings.tsx";
import Upload from "./components/Upload/Upload.tsx";
import Profile from "./components/Profile/Profile.tsx";
import AdminFestivals from "./components/Pages/AdminFestivals.tsx";
import "./App.scss";

const MainLayout: React.FC<{
  isMenuOpen: boolean;
  isChatOpen: boolean;
  setIsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsChatOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isGuideOpen: boolean;
  setIsGuideOpen: React.Dispatch<React.SetStateAction<boolean>>;
  videoControls: any;
  setIsAuthOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setAuthMode: React.Dispatch<React.SetStateAction<"login" | "register">>;
  channelSlug?: string;
  isMobile: boolean;
}> = ({
  isMenuOpen,
  isChatOpen,
  setIsMenuOpen,
  setIsChatOpen,
  isGuideOpen,
  setIsGuideOpen,
  videoControls,
  setIsAuthOpen,
  setAuthMode,
  channelSlug,
  isMobile
}) => (
    <>
      <NavBar
        setIsGuideOpen={setIsGuideOpen}
        setIsAuthOpen={setIsAuthOpen}
        setAuthMode={setAuthMode}
        isMobile={isMobile}
        isMenuOpen={isMenuOpen}
        setIsMenuOpen={setIsMenuOpen}
        {...videoControls}
      />
      <div className={`main-content ${isMobile ? 'mobile' : ''}`}>
        <Channels isOpen={isMenuOpen} setIsOpen={setIsMenuOpen} isMobile={isMobile} />

        <VideoPlayer
          isMenuOpen={isMenuOpen}
          isChatOpen={isChatOpen}
          setVideoControls={videoControls.setVideoControls}
          channelSlug={channelSlug} // ✅ Pass channel slug to VideoPlayer
          isMobile={isMobile}
        />
        <Chatbox isOpen={isChatOpen} setIsOpen={setIsChatOpen} />
      </div>
      <NewsTicker />

      {/* Mobile menu backdrop */}
      {isMobile && isMenuOpen && (
        <div className="menu-backdrop" onClick={() => setIsMenuOpen(false)} />
      )}

      {isGuideOpen && <TvGuide isOpen={isGuideOpen} closeGuide={() => setIsGuideOpen(false)} />}
    </>
  );

const App: React.FC = () => {
  const isMobile = useIsMobile();
  const { setIsMobile } = useUIStore();

  // Sync mobile state to store
  useEffect(() => {
    setIsMobile(isMobile);
  }, [isMobile, setIsMobile]);

  // Start with sidebars closed on mobile, open on desktop
  const [isMenuOpen, setIsMenuOpen] = useState(!isMobile);
  const [isChatOpen, setIsChatOpen] = useState(!isMobile);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  // Auto-close sidebars when switching to mobile
  useEffect(() => {
    if (isMobile) {
      setIsMenuOpen(false);
      setIsChatOpen(false);
    }
  }, [isMobile]);

  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");

  const [videoControls, setVideoControls] = useState<any>({
    currentIndex: 0,
    setCurrentIndex: () => { },
    videoLinks: [],
    videoRef: null,
    goToNextVideo: () => { },
    goToPreviousVideo: () => { },
    toggleMute: () => { },
    toggleFullscreen: () => { },
    loadVideo: () => { },
    setVideoControls: (controls: any) => setVideoControls((prev: any) => ({ ...prev, ...controls })),
  });

  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Redirect root to default channel */}
          <Route path="/" element={<Navigate to="/channel/channel-0" replace />} />

          {/* Channel-specific route */}
          <Route
            path="/channel/:channelSlug"
            element={
              <MainLayout
                isMenuOpen={isMenuOpen}
                isChatOpen={isChatOpen}
                setIsMenuOpen={setIsMenuOpen}
                setIsChatOpen={setIsChatOpen}
                isGuideOpen={isGuideOpen}
                setIsGuideOpen={setIsGuideOpen}
                setIsAuthOpen={setIsAuthOpen}
                setAuthMode={setAuthMode}
                videoControls={videoControls}
                channelSlug={undefined}
                isMobile={isMobile}
              />
            }
          />

          {/* Other routes */}
          <Route path="/upload" element={<Upload />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/admin/festivals" element={<AdminFestivals />} />

          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to="/channel/channel-0" replace />} />
        </Routes>

        {isAuthOpen && (
          <Auth
            setIsAuthOpen={setIsAuthOpen}
            authMode={authMode}
            setAuthMode={setAuthMode}
          />
        )}
      </Router>
    </AuthProvider>
  );
};

export default App;
