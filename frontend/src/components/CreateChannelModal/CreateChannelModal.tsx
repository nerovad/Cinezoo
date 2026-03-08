import React, { useEffect, useRef, useState } from "react";
import "./CreateChannelModal.scss";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onChannelCreated?: (channel: any) => void;
  excludeClickId?: string;
}

type RecurrenceType = 'once' | 'daily' | 'weekly' | 'weekdays' | 'weekends';

type ScheduleItem = {
  title: string;
  scheduled_at: string;        // Start date (and time for 'once')
  duration: string;            // Timecode format: HH:MM:SS or MM:SS
  recurrence_type: RecurrenceType;
  recurrence_days?: number[];  // For 'weekly': [0,1,2,3,4,5,6] where 0=Sun
  recurrence_end_date?: string; // Optional end date (YYYY-MM-DD)
  air_time?: string;           // HH:MM for recurring shows
};

type WidgetConfig = {
  type: string;
  order: number;
};

const emptyScheduleItem: ScheduleItem = {
  title: "",
  scheduled_at: "",
  duration: "",
  recurrence_type: "once",
  recurrence_days: [],
  recurrence_end_date: "",
  air_time: "",
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Convert timecode (HH:MM:SS or MM:SS) to seconds
const timecodeToSeconds = (timecode: string): number | null => {
  if (!timecode || !timecode.trim()) return null;
  const parts = timecode.split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN)) return null;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return null;
};

// Auto-format timecode input: inserts colons as user types digits
// Input: raw digits like "12345" -> Output: "1:23:45"
const formatTimecodeInput = (value: string): string => {
  // Remove all non-digit characters
  const digits = value.replace(/\D/g, '');

  // Limit to 6 digits (HH:MM:SS)
  const limited = digits.slice(0, 6);

  // Insert colons from the right (SS first, then MM, then HH)
  const len = limited.length;
  if (len === 0) return '';
  if (len <= 2) return limited;
  if (len <= 4) {
    // MM:SS format
    return `${limited.slice(0, len - 2)}:${limited.slice(-2)}`;
  }
  // HH:MM:SS format
  return `${limited.slice(0, len - 4)}:${limited.slice(-4, -2)}:${limited.slice(-2)}`;
};

// General widgets available for all channels
const GENERAL_WIDGETS = [
  { type: 'about', name: 'About', description: 'Channel info and description', icon: 'ℹ️' },
  { type: 'now_playing', name: 'Now Playing / Up Next', description: 'Current and upcoming content', icon: '📺' },
];

const CreateChannelModal: React.FC<Props> = ({ isOpen, onClose, onChannelCreated, excludeClickId }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  // Channel fields
  const [channelNumber, setChannelNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [channelInfo, setChannelInfo] = useState<any>(null);

  // Widgets
  const [selectedWidgets, setSelectedWidgets] = useState<WidgetConfig[]>([]);
  const [aboutText, setAboutText] = useState("");

  // Schedule for Now Playing widget
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([]);

  // Metadata tags
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  // Thumbnail
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);

  // Intermission screen
  const [intermissionFile, setIntermissionFile] = useState<File | null>(null);
  const [intermissionPreview, setIntermissionPreview] = useState<string | null>(null);

  // Track taken channel numbers
  const [takenChannelNumbers, setTakenChannelNumbers] = useState<Set<number>>(new Set());
  const [loadingChannels, setLoadingChannels] = useState(false);

  // Generate available channel numbers (2-101), excluding taken ones
  const availableChannels = Array.from({ length: 100 }, (_, i) => i + 2)
    .filter(num => !takenChannelNumbers.has(num));

  // Auto-generate internal name from channel number
  const generateInternalName = (num: string): string => {
    return num ? `channel_${num}` : "";
  };

  // Fetch existing channels to determine taken channel numbers
  useEffect(() => {
    if (!isOpen) return;

    const fetchTakenChannels = async () => {
      setLoadingChannels(true);
      try {
        const res = await fetch("/api/channels");
        if (res.ok) {
          const channels = await res.json();
          const taken = new Set<number>(
            channels
              .map((ch: any) => ch.channel_number)
              .filter((num: any) => typeof num === 'number')
          );
          setTakenChannelNumbers(taken);
        }
      } catch (err) {
        console.error("Failed to fetch channels:", err);
      } finally {
        setLoadingChannels(false);
      }
    };

    fetchTakenChannels();
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const excludeEl = excludeClickId ? document.getElementById(excludeClickId) : null;
      if (
        boxRef.current &&
        !boxRef.current.contains(event.target as Node) &&
        (!excludeEl || !excludeEl.contains(event.target as Node))
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose, excludeClickId]);

  // ESC, lock scroll, focus first input
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => firstFieldRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  const canSubmit = () => {
    return channelNumber && displayName.trim();
  };

  // Widget helpers
  const toggleWidget = (widgetType: string) => {
    const exists = selectedWidgets.find(w => w.type === widgetType);
    if (exists) {
      setSelectedWidgets(selectedWidgets.filter(w => w.type !== widgetType));
    } else {
      const maxOrder = Math.max(...selectedWidgets.map(w => w.order), -1);
      setSelectedWidgets([...selectedWidgets, { type: widgetType, order: maxOrder + 1 }]);
    }
  };

  const isWidgetSelected = (widgetType: string) => {
    return selectedWidgets.some(w => w.type === widgetType);
  };

  // Schedule helpers
  const addScheduleRow = () => setScheduleItems(prev => [...prev, { ...emptyScheduleItem }]);
  const removeScheduleRow = (idx: number) => setScheduleItems(prev => prev.filter((_, i) => i !== idx));
  const updateScheduleItem = (idx: number, patch: Partial<ScheduleItem>) =>
    setScheduleItems(prev => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));

  // Tag helpers
  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags(prev => [...prev, trimmed]);
    }
    setTagInput("");
  };

  const removeTag = (tagToRemove: string) => {
    setTags(prev => prev.filter(t => t !== tagToRemove));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(tagInput);
    }
  };

  // Thumbnail handlers
  const handleThumbnailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setThumbnailFile(file);
      const previewUrl = URL.createObjectURL(file);
      setThumbnailPreview(previewUrl);
    }
  };

  const removeThumbnail = () => {
    if (thumbnailPreview) {
      URL.revokeObjectURL(thumbnailPreview);
    }
    setThumbnailFile(null);
    setThumbnailPreview(null);
  };

  // Intermission handlers
  const handleIntermissionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIntermissionFile(file);
      const previewUrl = URL.createObjectURL(file);
      setIntermissionPreview(previewUrl);
    }
  };

  const removeIntermission = () => {
    if (intermissionPreview) {
      URL.revokeObjectURL(intermissionPreview);
    }
    setIntermissionFile(null);
    setIntermissionPreview(null);
  };

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      if (thumbnailPreview) {
        URL.revokeObjectURL(thumbnailPreview);
      }
      if (intermissionPreview) {
        URL.revokeObjectURL(intermissionPreview);
      }
    };
  }, [thumbnailPreview, intermissionPreview]);

  // Convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit()) return;

    setSubmitting(true);
    try {
      // Normalize schedule items for submission
      const normalizedSchedule = scheduleItems
        .filter(item => item.title.trim() && item.scheduled_at)
        .map(item => ({
          title: item.title.trim(),
          scheduled_at: new Date(item.scheduled_at).toISOString(),
          duration_seconds: timecodeToSeconds(item.duration),
          recurrence_type: item.recurrence_type || 'once',
          recurrence_days: item.recurrence_type === 'weekly' ? item.recurrence_days : null,
          recurrence_end_date: item.recurrence_end_date || null,
          air_time: item.recurrence_type !== 'once' ? item.air_time : null,
        }));

      // Convert thumbnail to base64 if present
      let thumbnailBase64: string | null = null;
      if (thumbnailFile) {
        thumbnailBase64 = await fileToBase64(thumbnailFile);
      }

      // Convert intermission to base64 if present
      let intermissionBase64: string | null = null;
      if (intermissionFile) {
        intermissionBase64 = await fileToBase64(intermissionFile);
      }

      const body: any = {
        name: generateInternalName(channelNumber),
        display_name: displayName,
        channel_number: parseInt(channelNumber),
        type: "channel",
        widgets: selectedWidgets.length > 0 ? selectedWidgets : null,
        about_text: aboutText || null,
        schedule: normalizedSchedule.length > 0 ? normalizedSchedule : null,
        tags: tags.length > 0 ? tags : null,
        thumbnail: thumbnailBase64,
        intermission: intermissionBase64,
      };

      const token = localStorage.getItem("token");
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`Failed to create channel: ${res.status} ${msg}`);
      }

      const data = await res.json();
      setChannelInfo(data);

      // Reset form
      setChannelNumber("");
      setDisplayName("");
      setSelectedWidgets([]);
      setAboutText("");
      setScheduleItems([]);
      setTags([]);
      setTagInput("");
      removeThumbnail();
      removeIntermission();
      setSuccess(true);

      // Notify parent
      if (onChannelCreated) {
        onChannelCreated(data);
      }
    } catch (err) {
      console.error("Error submitting channel", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="create-channel-overlay" role="dialog" aria-modal="true" aria-labelledby="create-channel-title">
      <div className="create-channel-content" ref={boxRef}>
        <button className="close-btn" onClick={onClose} aria-label="Close create channel">X</button>

        <h2 id="create-channel-title">Create Channel</h2>

        <form className="create-channel-form" onSubmit={handleSubmit}>
          {/* Channel Number + Display Name Row */}
          <div className="row channel-name-row">
            <div className="channel-number-field">
              <label htmlFor="channel-number">Channel #</label>
              <select
                ref={firstFieldRef}
                id="channel-number"
                value={channelNumber}
                onChange={(e) => setChannelNumber(e.target.value)}
                required
                disabled={loadingChannels}
              >
                <option value="">{loadingChannels ? "..." : "#"}</option>
                {availableChannels.map(num => (
                  <option key={num} value={num}>{num}</option>
                ))}
              </select>
              {!loadingChannels && availableChannels.length === 0 && (
                <small className="form-hint" style={{ color: '#ff6b6b' }}>
                  All taken
                </small>
              )}
            </div>
            <div className="display-name-field">
              <label htmlFor="display-name">Channel Display Name</label>
              <input
                id="display-name"
                type="text"
                placeholder="e.g., Cinema, Horror Marathon..."
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value.slice(0, 20))}
                maxLength={20}
                required
              />
              <small className="form-hint">{displayName.length}/20 characters</small>
            </div>
          </div>

          {/* Tags */}
          <div className="row">
            <label htmlFor="tag-input">Tags</label>
            <div className="tag-input-container">
              <input
                id="tag-input"
                type="text"
                placeholder="Type a tag and press Enter..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
              />
              <button
                type="button"
                className="btn-secondary small"
                onClick={() => addTag(tagInput)}
                disabled={!tagInput.trim()}
              >
                Add
              </button>
            </div>
            {tags.length > 0 && (
              <div className="tags-list">
                {tags.map(tag => (
                  <span key={tag} className="tag-chip">
                    {tag}
                    <button
                      type="button"
                      className="tag-remove"
                      onClick={() => removeTag(tag)}
                      aria-label={`Remove ${tag}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <small className="form-hint">Add tags to help categorize your channel (e.g., horror, comedy, indie)</small>
          </div>

          {/* Thumbnail Upload */}
          <div className="row">
            <label htmlFor="thumbnail-upload">Channel Thumbnail</label>
            {thumbnailPreview ? (
              <div className="thumbnail-preview">
                <img src={thumbnailPreview} alt="Thumbnail preview" />
                <button
                  type="button"
                  className="thumbnail-remove"
                  onClick={removeThumbnail}
                  aria-label="Remove thumbnail"
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="thumbnail-upload-area">
                <input
                  id="thumbnail-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleThumbnailChange}
                  className="thumbnail-input"
                />
                <label htmlFor="thumbnail-upload" className="thumbnail-upload-label">
                  <span className="upload-icon">📷</span>
                  <span>Click to upload thumbnail</span>
                </label>
              </div>
            )}
            <small className="form-hint">Optional. Recommended size: 320x180 pixels</small>
          </div>

          {/* Intermission Screen Upload */}
          <div className="row">
            <label htmlFor="intermission-upload">Intermission Screen</label>
            {intermissionPreview ? (
              <div className="thumbnail-preview">
                <img src={intermissionPreview} alt="Intermission preview" />
                <button
                  type="button"
                  className="thumbnail-remove"
                  onClick={removeIntermission}
                  aria-label="Remove intermission screen"
                >
                  x
                </button>
              </div>
            ) : (
              <div className="thumbnail-upload-area">
                <input
                  id="intermission-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleIntermissionChange}
                  className="thumbnail-input"
                />
                <label htmlFor="intermission-upload" className="thumbnail-upload-label">
                  <span className="upload-icon">TV</span>
                  <span>Upload custom intermission screen</span>
                </label>
              </div>
            )}
            <small className="form-hint">Optional. Shown when your channel is offline. A default screen is used if none is uploaded. Recommended: 1920x1080</small>
          </div>

          {/* Widget Selector - General widgets only */}
          <div className="widget-selector">
            <h4>Channel Widgets</h4>
            <p className="help-text">Select which widgets to display in your channel menu.</p>

            <div className="widget-grid">
              {GENERAL_WIDGETS.map(widget => (
                <label
                  key={widget.type}
                  className={`widget-option ${isWidgetSelected(widget.type) ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isWidgetSelected(widget.type)}
                    onChange={() => toggleWidget(widget.type)}
                  />
                  <div className="widget-card">
                    <span className="widget-icon">{widget.icon}</span>
                    <div className="widget-info">
                      <strong>{widget.name}</strong>
                      <p>{widget.description}</p>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <p className="help-text event-hint">
              Event widgets (Voting, Leaderboard, Bracket) are automatically added when you create an event.
            </p>
          </div>

          {/* About widget textarea (conditional) */}
          {isWidgetSelected('about') && (
            <div className="row">
              <label htmlFor="about-text">About Text (Markdown supported)</label>
              <textarea
                id="about-text"
                value={aboutText}
                onChange={(e) => setAboutText(e.target.value)}
                placeholder="Describe your channel... You can use **bold**, _italic_, and [links](https://example.com)"
                rows={6}
              />
            </div>
          )}

          {/* Now Playing schedule editor (conditional) */}
          {isWidgetSelected('now_playing') && (
            <div className="schedule-editor">
              <div className="schedule-header">
                <h4>Now Playing / Up Next Schedule</h4>
                <button type="button" className="btn-secondary small" onClick={addScheduleRow}>
                  + Add Time Slot
                </button>
              </div>

              {scheduleItems.length === 0 ? (
                <p className="schedule-hint">
                  Add time slots to show what's playing and coming up next on your channel.
                </p>
              ) : (
                <div className="schedule-table">
                  {scheduleItems.map((item, idx) => (
                    <div key={idx} className="schedule-row">
                      <button
                        type="button"
                        className="schedule-remove-btn"
                        aria-label="Remove time slot"
                        onClick={() => removeScheduleRow(idx)}
                      >
                        ✕
                      </button>
                      <div className="schedule-fields-grid">
                        <div className="schedule-field">
                          <label>Program Title</label>
                          <input
                            type="text"
                            placeholder="e.g., Movie Night"
                            value={item.title}
                            onChange={(e) => updateScheduleItem(idx, { title: e.target.value })}
                          />
                        </div>
                        <div className="schedule-field">
                          <label>Recurrence</label>
                          <select
                            value={item.recurrence_type}
                            onChange={(e) => updateScheduleItem(idx, {
                              recurrence_type: e.target.value as RecurrenceType,
                              recurrence_days: e.target.value === 'weekly' ? [] : undefined
                            })}
                          >
                            <option value="once">Once</option>
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="weekdays">Weekdays (Mon-Fri)</option>
                            <option value="weekends">Weekends (Sat-Sun)</option>
                          </select>
                        </div>
                        <div className="schedule-field duration-field">
                          <label>Duration</label>
                          <input
                            type="text"
                            placeholder="HH:MM:SS"
                            value={item.duration}
                            onChange={(e) => {
                              const formatted = formatTimecodeInput(e.target.value);
                              updateScheduleItem(idx, { duration: formatted });
                            }}
                            title="Format: HH:MM:SS or MM:SS"
                          />
                        </div>
                      </div>

                      {/* Weekly day selector */}
                      {item.recurrence_type === 'weekly' && (
                        <div className="recurrence-days">
                          <label>Days:</label>
                          <div className="day-checkboxes">
                            {DAY_LABELS.map((day, dayIdx) => (
                              <label key={dayIdx} className="day-checkbox">
                                <input
                                  type="checkbox"
                                  checked={item.recurrence_days?.includes(dayIdx) || false}
                                  onChange={(e) => {
                                    const days = item.recurrence_days || [];
                                    const newDays = e.target.checked
                                      ? [...days, dayIdx].sort()
                                      : days.filter(d => d !== dayIdx);
                                    updateScheduleItem(idx, { recurrence_days: newDays });
                                  }}
                                />
                                <span>{day}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="schedule-fields-grid">
                        <div className="schedule-field">
                          <label>{item.recurrence_type === 'once' ? 'Air Date & Time' : 'Start Date'}</label>
                          <input
                            type={item.recurrence_type === 'once' ? 'datetime-local' : 'date'}
                            value={item.recurrence_type === 'once' ? item.scheduled_at : item.scheduled_at.split('T')[0]}
                            onChange={(e) => updateScheduleItem(idx, { scheduled_at: e.target.value })}
                          />
                        </div>
                        {item.recurrence_type !== 'once' && (
                          <>
                            <div className="schedule-field">
                              <label>Air Time</label>
                              <input
                                type="time"
                                value={item.air_time || ''}
                                onChange={(e) => updateScheduleItem(idx, { air_time: e.target.value })}
                              />
                            </div>
                            <div className="schedule-field">
                              <label>End Date (optional)</label>
                              <input
                                type="date"
                                value={item.recurrence_end_date || ''}
                                onChange={(e) => updateScheduleItem(idx, { recurrence_end_date: e.target.value })}
                              />
                            </div>
                          </>
                        )}
                      </div>

                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <button type="submit" disabled={submitting || !canSubmit()}>
            {submitting ? "Creating..." : "Create Channel"}
          </button>
        </form>

        {success && <p className="create-channel-message">Channel created successfully!</p>}

        {channelInfo && (
          <div className="channel-details">
            <p><strong>Stream Key:</strong> {channelInfo.stream_key}</p>
            <p><strong>Ingest URL for OBS:</strong> rtmp://cinezoo.tv/live/{channelInfo.stream_key}</p>
            <p><strong>Playback URL (HLS):</strong> {channelInfo.playback_path}</p>

            <div className="channel-actions">
              <button onClick={() => navigator.clipboard.writeText(channelInfo.stream_key)}>
                Copy Stream Key
              </button>
              <button onClick={() => navigator.clipboard.writeText(`rtmp://cinezoo.tv/live/${channelInfo.stream_key}`)}>
                Copy Ingest URL
              </button>
              <button onClick={() => navigator.clipboard.writeText(channelInfo.playback_path)}>
                Copy Playback URL
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CreateChannelModal;
