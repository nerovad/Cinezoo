import React, { useEffect, useState } from "react";
import Marquee from "react-fast-marquee";
import "./NewsTicker.scss";
import "../../styles/_variables.scss";

const NewsTicker: React.FC = () => {
  const [isMinimized, setIsMinimized] = useState(false);

  const tickerText = `Welcome to CineZoo! | Click anywhere on screen to navigate channels | Need to contact us? Email us as cinezoo@gmail.com | Oscars watch along with be on channel 7 this year, March 16th at 4:00 PM PST | Check out channel 99 for Friday Night Rewind: Live!`;

  const toggleMinimize = () => {
    setIsMinimized(!isMinimized);
  };

  useEffect(() => {
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    document.documentElement.style.setProperty(
      "--ticker-height",
      isMinimized ? "0px" : isMobile ? "28px" : "50px"
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
        <Marquee speed={30} gradient={false} className="ticker-wrapper">
          <span className="ticker-item">{tickerText}&nbsp;&nbsp;&nbsp;</span>
        </Marquee>
      )}
    </div>
  );
};

export default NewsTicker;
