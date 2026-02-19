import React, { useState, useMemo, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaUserCircle, FaBars } from "react-icons/fa";
import Logo from "../../assets/cinezoo_logo_neon_7.svg";
import "./Navigation.scss";
import ChannelArrow from "../../assets/down_arrow_02_13.svg"
import TvGuide from "../../assets/tv_guide_icon_02_13.svg"
import Fullscreen from "../../assets/fullscreen_icon.svg"
import Mute from "../../assets/mute_icon.svg"
import { useChatStore } from "../../store/useChatStore";
import { useAuth } from "../../store/AuthContext";

type VideoLinkType = { src: string; channel: string; channelNumber: number; displayName?: string; tags?: string[] };

// Fuzzy match function - returns score (higher is better) or -1 if no match
const fuzzyMatch = (pattern: string, str: string): number => {
  const patternLower = pattern.toLowerCase();
  const strLower = str.toLowerCase();

  let patternIdx = 0;
  let score = 0;
  let lastMatchIdx = -1;

  for (let i = 0; i < strLower.length && patternIdx < patternLower.length; i++) {
    if (strLower[i] === patternLower[patternIdx]) {
      // Bonus for consecutive matches
      if (lastMatchIdx === i - 1) {
        score += 10;
      }
      // Bonus for matching at start of string or after separator
      if (i === 0 || strLower[i - 1] === ' ' || strLower[i - 1] === '-' || strLower[i - 1] === '_') {
        score += 5;
      }
      score += 1;
      lastMatchIdx = i;
      patternIdx++;
    }
  }

  // Return -1 if pattern wasn't fully matched
  if (patternIdx !== patternLower.length) {
    return -1;
  }

  return score;
};

interface NavBarProps {
  currentIndex: number;
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
  videoLinks: VideoLinkType[];
  videoRef: React.RefObject<HTMLVideoElement>;
  setIsGuideOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  goToNextVideo: () => void;
  goToPreviousVideo: () => void;
  toggleMute: () => void;
  toggleFullscreen: () => void;
  loadVideo: (src: string) => void;

  setIsAuthOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setAuthMode: (mode: "login" | "register") => void;

  // Mobile props
  isMobile?: boolean;
  isMenuOpen?: boolean;
  setIsMenuOpen?: React.Dispatch<React.SetStateAction<boolean>>;
}

const SearchNavBar: React.FC<NavBarProps> = ({
  currentIndex,
  setCurrentIndex,
  videoLinks,
  setIsGuideOpen,
  goToNextVideo,
  goToPreviousVideo,
  toggleMute,
  toggleFullscreen,
  loadVideo,
  setIsAuthOpen,
  setAuthMode,
  isMobile = false,
  isMenuOpen = false,
  setIsMenuOpen,
}) => {
  const navigate = useNavigate();
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [channelInput, setChannelInput] = useState("");
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const { setChannelId } = useChatStore();
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  // Current channel info for placeholder
  const currentChannel = videoLinks[currentIndex];
  const placeholderText = currentChannel
    ? `Ch ${currentChannel.channelNumber}${currentChannel.displayName ? ` - ${currentChannel.displayName}` : ''}`
    : "Search channels...";

  // Search results - filter channels based on input with fuzzy matching
  const searchResults = useMemo(() => {
    const searchTerm = channelInput.trim().toLowerCase();
    if (!searchTerm) return [];

    const results: { channel: VideoLinkType; matchType: 'number' | 'name' | 'tag'; matchedTag?: string; score: number }[] = [];

    videoLinks.forEach(v => {
      // Check channel number (exact match, highest priority)
      const targetNumber = parseInt(channelInput, 10);
      if (!isNaN(targetNumber) && v.channelNumber === targetNumber) {
        results.push({ channel: v, matchType: 'number', score: 1000 });
        return;
      }

      // Check display name with fuzzy matching
      if (v.displayName) {
        const nameScore = fuzzyMatch(searchTerm, v.displayName);
        if (nameScore > 0) {
          results.push({ channel: v, matchType: 'name', score: nameScore });
          return;
        }
      }

      // Check tags with fuzzy matching
      if (v.tags) {
        let bestTagScore = -1;
        let bestTag: string | undefined;
        for (const tag of v.tags) {
          const tagScore = fuzzyMatch(searchTerm, tag);
          if (tagScore > bestTagScore) {
            bestTagScore = tagScore;
            bestTag = tag;
          }
        }
        if (bestTagScore > 0 && bestTag) {
          results.push({ channel: v, matchType: 'tag', matchedTag: bestTag, score: bestTagScore });
        }
      }
    });

    // Sort by score (highest first)
    return results.sort((a, b) => b.score - a.score);
  }, [channelInput, videoLinks]);

  // Reset selected index when search results change
  useEffect(() => {
    setSelectedResultIndex(0);
  }, [searchResults]);

  // Close search dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSearchDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
  };

  const selectChannel = (channel: VideoLinkType) => {
    const targetIndex = videoLinks.findIndex(v => v.channel === channel.channel);
    if (targetIndex !== -1) {
      setCurrentIndex(targetIndex);
      loadVideo(channel.src);
      setChannelId(channel.channel);
      navigate(`/channel/${channel.channel}`, { replace: true });
      setChannelInput("");
      setShowSearchDropdown(false);
    }
  };

  const goToChannel = () => {
    if (searchResults.length > 0) {
      selectChannel(searchResults[selectedResultIndex].channel);
    } else if (channelInput.trim()) {
      alert(`No channel found matching "${channelInput}"`);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setChannelInput(e.target.value);
    setShowSearchDropdown(e.target.value.trim().length > 0);
  };

  const handleInputFocus = () => {
    setIsSearchFocused(true);
    if (channelInput.trim().length > 0) {
      setShowSearchDropdown(true);
    }
  };

  const handleInputBlur = () => {
    setIsSearchFocused(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSearchDropdown || searchResults.length === 0) {
      if (e.key === "Enter") goToChannel();
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedResultIndex(prev =>
          prev < searchResults.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedResultIndex(prev => (prev > 0 ? prev - 1 : 0));
        break;
      case "Enter":
        e.preventDefault();
        selectChannel(searchResults[selectedResultIndex].channel);
        break;
      case "Escape":
        setShowSearchDropdown(false);
        break;
    }
  };

  return (
    <div className={`search-navbar ${isMobile ? 'search-navbar--mobile' : ''}`}>
      {/* Mobile: Hamburger Menu Button */}
      {isMobile && (
        <button
          className="search-navbar__hamburger"
          onClick={() => setIsMenuOpen?.(!isMenuOpen)}
          aria-label="Toggle menu"
        >
          <FaBars size={20} />
        </button>
      )}

      {/* Left Logo - hidden on mobile */}
      {!isMobile && (
        <div className="search-navbar__left">
          <a href="/">
            <img src={Logo} alt="Cinezoo" className="search-navbar__logo" />
          </a>
        </div>
      )}

      {/* Center Controls — Pill Bar */}
      <div className="search-navbar__center">
        <div className="control-pill">
          <div className="control-pill__group">
            <button className="channel-button" onClick={goToPreviousVideo}>
              <img src={ChannelArrow} alt="Previous Channel" className="channel-arrow-icon" />
            </button>
            <button className="channel-button channel-button--up" onClick={goToNextVideo}>
              <img src={ChannelArrow} alt="Next Channel" className="channel-arrow-icon" />
            </button>
          </div>

          {!isMobile && (
            <>
              <span className="control-pill__divider" />
              <div className="control-pill__group">
                <button
                  className="search-navbar__tv-guide-button"
                  onClick={(e) => { e.preventDefault(); setIsGuideOpen?.((prev) => !prev); }}
                >
                  <img src={TvGuide} alt="TV Guide" />
                </button>
              </div>
            </>
          )}

          <span className="control-pill__divider" />

          <div className="control-pill__group control-pill__group--search">
            <div className="search-navbar__channel-input-container" ref={searchContainerRef}>
              <input
                type="text"
                value={channelInput}
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                placeholder={isSearchFocused ? "" : placeholderText}
                className="channel-input"
                onKeyDown={handleKeyDown}
              />
              <button className="channel-go-button" onClick={goToChannel}>
                Go
              </button>

              {showSearchDropdown && searchResults.length > 0 && (
                <div className="search-dropdown">
                  {searchResults.map(({ channel, matchType, matchedTag }, index) => (
                    <div
                      key={channel.channel}
                      className={`search-dropdown__item ${index === selectedResultIndex ? 'search-dropdown__item--selected' : ''}`}
                      onClick={() => selectChannel(channel)}
                      onMouseEnter={() => setSelectedResultIndex(index)}
                    >
                      <span className="search-dropdown__channel-number">{channel.channelNumber}</span>
                      <span className="search-dropdown__channel-name">
                        {channel.displayName || channel.channel}
                      </span>
                      {matchType === 'tag' && matchedTag && (
                        <span className="search-dropdown__tag">#{matchedTag}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <span className="control-pill__divider" />

          <div className="control-pill__group">
            <button className="mute-button" onClick={toggleMute}>
              <img src={Mute} alt="Mute" />
            </button>
            <button className="fullscreen-button" onClick={toggleFullscreen}>
              <img src={Fullscreen} alt="Fullscreen" />
            </button>
          </div>
        </div>
      </div>

      {/* Right Links & Profile/Login */}
      <div className="search-navbar__links">
        {isLoading ? (
          <span className="search-navbar__loading">...</span>
        ) : !isAuthenticated ? (
          <button
            onClick={() => { setAuthMode("login"); setIsAuthOpen(true); }}
            className="search-navbar__login-button"
          >
            Login
          </button>
        ) : (
          <div className="search-navbar__profile" onClick={() => setShowProfileDropdown(!showProfileDropdown)}>
            <FaUserCircle className="search-navbar__profile-icon" size={24} />
            {!isMobile && <span className="search-navbar__username">{user?.username}</span>}
            {showProfileDropdown && (
              <div className="profile-dropdown" onClick={(e) => e.stopPropagation()}>
                <Link to="/profile" className="profile-dropdown__item">My Space</Link>
                <button onClick={handleLogout} className="profile-dropdown__logout">Log out</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchNavBar;
