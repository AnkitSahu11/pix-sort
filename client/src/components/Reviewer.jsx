import { useEffect, useState } from "react";
import { getSimilar } from "../api";

export default function Reviewer({ photo, queue, onClose, onStatus, onNext, onSelect }) {
  const [similar, setSimilar] = useState([]);
  const i = queue.findIndex((x) => x._id === photo?._id);

  useEffect(() => {
    if (photo) {
      getSimilar(photo._id)
        .then((r) => setSimilar(r.data?.data || []))
        .catch(() => setSimilar([]));
    }
  }, [photo]);

  useEffect(() => {
    if (!photo) return;
    const f = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") {
        onStatus(photo._id, "rejected");
        onNext(i, 1);
      }
      if (e.key === "ArrowRight") {
        onStatus(photo._id, "shortlisted");
        onNext(i, 1);
      }
      if (e.key === "ArrowDown") onNext(i, 1);
      if (e.key === "ArrowUp") onNext(i, -1);
      if (e.key === "f" || e.key === "F") {
        const isFav = photo.status === "favorite" || photo.favorite;
        onStatus(photo._id, isFav ? "unreviewed" : "favorite");
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [photo, i, onClose, onStatus, onNext]);

  if (!photo) return null;

  const scoreItems = [
    ["FINAL", photo.analysis?.finalScore],
    ["SHARPNESS", photo.analysis?.sharpnessScore],
    ["TECHNICAL", photo.analysis?.technicalScore],
    ["FACE", photo.analysis?.faceQualityScore],
    ["EXPRESSION", photo.analysis?.expressionScore],
    ["AI QUALITY", photo.analysis?.aiQualityScore],
  ];

  const isRejected = photo.status === "rejected";
  const isShortlisted = photo.status === "shortlisted";
  const isFavorite = photo.status === "favorite" || photo.favorite;

  return (
    <div className="reviewer">
      <button className="review-close" onClick={onClose} title="Shortcut: Esc">
        ESC · CLOSE
      </button>
      <div className="review-image-wrap">
        <img src={photo.url} alt={photo.originalName} />
      </div>
      <aside className="review-panel">
        <span className="eyebrow">
          FRAME {String(photo.frameIndex).padStart(4, "0")} · {photo.analysis?.blurStatus?.toUpperCase() || "ANALYZED"}
          {isFavorite && <span className="status-badge-fav"> · FAVORITE</span>}
          {isRejected && <span className="status-badge-rejected"> · REJECTED</span>}
          {isShortlisted && <span className="status-badge-kept"> · SHORTLISTED</span>}
        </span>
        <h2>{photo.originalName}</h2>

        <div className="score-stack">
          {scoreItems.map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b>{v !== null && v !== undefined ? v : "N/A"}</b>
            </div>
          ))}
        </div>

        {photo.analysis?.eyeState && (
          <div style={{ marginTop: 12, fontSize: "0.8rem", color: "var(--muted)" }}>
            Eye State: <strong style={{ color: "var(--text)" }}>{photo.analysis.eyeState}</strong>
            {photo.analysis.leftEAR !== null && photo.analysis.leftEAR !== undefined && (
              <span> (L: {photo.analysis.leftEAR}, R: {photo.analysis.rightEAR}{photo.analysis.avgEAR ? `, Avg: ${photo.analysis.avgEAR}` : ""})</span>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {(photo.analysis?.blurStatus === "blurry" || photo.flags?.includes("SOFT")) && (
            <span className="flag-label" style={{ position: "static" }}>SOFT</span>
          )}
          {(photo.analysis?.eyesOpen === false ||
            photo.analysis?.eyesClosed === true ||
            photo.analysis?.eyeState === "BOTH_CLOSED" ||
            photo.analysis?.eyeState === "ONE_EYE_CLOSED" ||
            photo.flags?.includes("EYES")) && (
            <span className="flag-label eyes" style={{ position: "static" }}>EYES</span>
          )}
        </div>

        <div className="review-actions">
          <button
            type="button"
            className={`reject-button ${isRejected ? "active" : ""}`}
            title="Reject frame (Shortcut: ←)"
            onClick={() => {
              onStatus(photo._id, "rejected");
              onNext(i, 1);
            }}
          >
            ← REJECT
          </button>
          <button
            type="button"
            className="skip-button"
            title="Skip frame without decision (Shortcut: ↓)"
            onClick={() => onNext(i, 1)}
          >
            ↓ SKIP
          </button>
          <button
            type="button"
            className={`fav-button ${isFavorite ? "active" : ""}`}
            title="Toggle favorite (Shortcut: F)"
            onClick={() => {
              onStatus(photo._id, isFavorite ? "unreviewed" : "favorite");
            }}
          >
            {isFavorite ? "★ FAVED" : "★ FAV"}
          </button>
          <button
            type="button"
            className={`keep-button ${isShortlisted ? "active" : ""}`}
            title="Shortlist frame (Shortcut: →)"
            onClick={() => {
              onStatus(photo._id, "shortlisted");
              onNext(i, 1);
            }}
          >
            KEEP →
          </button>
        </div>

        {similar.length > 0 && (
          <div className="similar-strip">
            {similar.slice(0, 5).map((s) => (
              <img
                key={s._id}
                src={s.thumbnailUrl || s.url}
                onClick={() => onSelect && onSelect(s)}
                alt="similar"
              />
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}