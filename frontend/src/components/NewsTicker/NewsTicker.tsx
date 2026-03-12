import React, { useEffect, useRef, useState } from "react";
import "./NewsTicker.scss";
import "../../styles/_variables.scss";

const NewsTicker: React.FC = () => {
  const tickerRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(30);
  const [isMinimized, setIsMinimized] = useState(false);

  const tickerText = `Welcome to CineZoo! | Click anywhere on screen to navigate channels | Need to contact us? Email us as cinezoo@gmail.com | Oscars watch along with be on channel 7 this year, March 16th at 4:00 PM PST | Check out channel 99 for Friday Night Rewind: Live!`;

  useEffect(() => {
    if (!isMinimized && tickerRef.current) {
      const singleTextWidth = tickerRef.current.scrollWidth / 2;
      const pixelsPerSecond = 30;
      const calculatedDuration = singleTextWidth / pixelsPerSecond;
      setDuration(calculatedDuration);
    }
  }, [isMinimized]);

  const toggleMinimize = () => {
    setIsMinimized(!isMinimized);
  };

  // Set CSS variable for other components to adjust their height
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--ticker-height',
      isMinimized ? '0px' : '50px'
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
            style={{ animationDuration: `${duration}s`, animationDelay: `${-duration * 0.75}s` }}
          >
            <span>{tickerText}&nbsp;&nbsp;&nbsp;</span>
            <span>{tickerText}&nbsp;&nbsp;&nbsp;</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default NewsTicker;
