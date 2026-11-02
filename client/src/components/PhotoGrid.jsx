import { memo } from "react";

const PhotoCard = memo(function PhotoCard({ photo, onOpen, onStatus }) {
  const isShortlisted = photo.status === "shortlisted";
  const isRejected = photo.status === "rejected";
  const isFavorite = photo.status === "favorite" || photo.favorite;
  const isFlagged =
    photo.status === "flagged" ||
    photo.flagged ||
    (photo.flags && photo.flags.length > 0) ||
    photo.analysis?.eyesClosed === true ||
    photo.analysis?.eyesOpen === false ||
    photo.analysis?.blurStatus === "blurry";

  return (
    <div
      role="button"
      tabIndex={0}
      className={`photo-card ${photo.status} ${isFlagged ? "flagged" : ""} ${
        isShortlisted ? "shortlisted kept" : ""
      } ${isRejected ? "rejected" : ""} ${isFavorite ? "fav" : ""}`}
      onClick={() => onOpen(photo)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(photo);
        }
      }}
    >
      <img
        src={photo.thumbnailUrl || photo.url}
        loading="lazy"
        alt={photo.originalName}
      />
      <div className="score-badge">{photo.analysis?.finalScore ?? "—"}</div>

      <button
        type="button"
        className={`fav-button ${isFavorite ? "active" : ""}`}
        title={isFavorite ? "Remove favorite" : "Mark as favorite"}
        onClick={(e) => {
          e.stopPropagation();
          onStatus(photo._id, isFavorite ? "unreviewed" : "favorite");
        }}
      >
        ★
      </button>

      <div className="frame-label">
        <span>F{String(photo.frameIndex).padStart(4, "0")}</span>
        <small>{photo.originalName}</small>
      </div>

      {(photo.analysis?.blurStatus === "blurry" || photo.flags?.includes("SOFT")) && (
        <span className="flag-label">SOFT</span>
      )}
      {(photo.analysis?.eyesOpen === false ||
        photo.analysis?.eyesClosed === true ||
        photo.analysis?.eyeState === "BOTH_CLOSED" ||
        photo.analysis?.eyeState === "ONE_EYE_CLOSED" ||
        photo.flags?.includes("EYES")) && (
        <span className="flag-label eyes">EYES</span>
      )}
      {photo.isBestInGroup && <span className="best-mark">BEST</span>}
      {isShortlisted && <span className="keep-mark">○</span>}
      {isRejected && <span className="reject-mark">×</span>}
      {isFavorite && <span className="fav-mark">★</span>}

      <div className="quick-actions">
        <span
          className={isShortlisted ? "active-keep" : ""}
          title="Keep frame"
          onClick={(e) => {
            e.stopPropagation();
            onStatus(photo._id, isShortlisted ? "unreviewed" : "shortlisted");
          }}
        >
          {isShortlisted ? "KEPT" : "KEEP"}
        </span>
        <span
          className={isFavorite ? "active-fav" : ""}
          title="Favorite frame"
          onClick={(e) => {
            e.stopPropagation();
            onStatus(photo._id, isFavorite ? "unreviewed" : "favorite");
          }}
        >
          {isFavorite ? "★ FAVED" : "★ FAV"}
        </span>
        <span
          className={isRejected ? "active-reject" : ""}
          title="Reject frame"
          onClick={(e) => {
            e.stopPropagation();
            onStatus(photo._id, isRejected ? "unreviewed" : "rejected");
          }}
        >
          {isRejected ? "REJECTED" : "REJECT"}
        </span>
      </div>
    </div>
  );
});

export default function PhotoGrid({ photos, onOpen, onStatus, onLoadMore, hasMore }) {
  if (!photos.length) {
    return (
      <div className="empty-state">
        <p>NO PHOTOS MATCH THE CURRENT FILTER</p>
        <small style={{ color: "var(--muted)" }}>
          Upload a shoot above or select "ALL" to view imported frames.
        </small>
      </div>
    );
  }

  return (
    <>
      <div className="photo-grid">
        {photos.map((p) => (
          <PhotoCard
            key={p._id}
            photo={p}
            onOpen={onOpen}
            onStatus={onStatus}
          />
        ))}
      </div>
      {hasMore && (
        <button className="load-more" onClick={onLoadMore}>
          LOAD MORE FRAMES
        </button>
      )}
    </>
  );
}
