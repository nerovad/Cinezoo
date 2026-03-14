import React, { useEffect, useRef, useState } from "react";
import "./NewsTicker.scss";
import "../../styles/_variables.scss";

const NewsTicker: React.FC = () => {
  const tickerRef = useRef<HTMLDivElement>(null);
  const singleRef = useRef<HTMLSpanElement>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [copyCount, setCopyCount] = useState(4);
  const [animStyle, setAnimStyle] = useState<React.CSSProperties>({});

  const tickerText = `Welcome to CineZoo! | Click anywhere on screen to navigate channels | Need to contact us? Email us as cinezoo@gmail.com | Oscars watch along with be on channel 7 this year, March 16th at 4:00 PM PST | Check out channel 99 for Friday Night Rewind: Live!`;

  useEffect(() => {
    if (!isMinimized && singleRef.current) {
      const singleWidth = singleRef.current.offsetWidth;
      const viewportWidth = window.innerWidth;
      // Need enough copies so that one copy's worth of scrolling still leaves text visible
      const needed = Math.max(Math.ceil(viewportWidth / singleWidth) + 2, 3);
      setCopyCount(needed);

      const pixelsPerSecond = 30;
      const duration = singleWidth / pixelsPerSecond;
      setAnimStyle({
        animationDuration: `${duration}s`,
        animationDelay: `${-duration * 0.75}s`,
        '--copy-count': needed,
      } as React.CSSProperties);
    }
  }, [isMinimized]);

  const toggleMinimize = () => {
    setIsMinimized(!isMinimized);
  };

  // Set CSS variable for other components to adjust their height
  useEffect(() => {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    document.documentElement.style.setProperty(
      '--ticker-height',
      isMinimized ? '0px' : isMobile ? '28px' : '50px'
    );
  }, [isMinimized]);

  return (
    <div className={`news-ticker ${isMinimized ? "minimized" : ""}`}>
      <button
        className="ticker-toggle"
        onClick={toggleMinimize}
        aria-label={isMinimized ? "Expand news ticker" : "Minimize news ticker"}
      >
        {isMinimized ? "▲" : "▼"}
      </button>
      {!isMinimized && (
        <div className="ticker-wrapper">
          <div
            className="ticker"
            ref={tickerRef}
            style={animStyle}
          >
            {Array.from({ length: copyCount }, (_, i) => (
              <span key={i} ref={i === 0 ? singleRef : undefined}>
                {tickerText}&nbsp;&nbsp;&nbsp;
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default NewsTicker;
