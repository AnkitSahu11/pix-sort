import { useMemo } from "react";

export default function DuplicateGroups({ photos, onKeepOnly, onOpen }) {
  const groups = useMemo(() => {
    const map = new Map();
    photos
      .filter((p) => p.duplicateGroupId)
      .forEach((photo) => {
        if (!map.has(photo.duplicateGroupId)) map.set(photo.duplicateGroupId, []);
        map.get(photo.duplicateGroupId).push(photo);
      });
    return [...map.entries()];
  }, [photos]);

  if (!groups.length) {
    return (
      <div className="empty-state">
        <p>NO DUPLICATE GROUPS FOUND IN CURRENT SET</p>
        <small style={{ color: "var(--muted)" }}>
          PixSort automatically groups near-identical burst frames using perceptual aHash analysis.
        </small>
      </div>
    );
  }

  return (
    <div className="duplicate-list">
      {groups.map(([groupId, members]) => {
        const bestPhoto = members.find((m) => m.isBestInGroup) || members[0];

        return (
          <section className="duplicate-group" key={groupId}>
            <header className="duplicate-header">
              <div>
                <span className="eyebrow">BURST / SIMILAR SET</span>
                <h3>{groupId}</h3>
                <p>
                  {members.length} frames · PixSort recommended frame:{" "}
                  <strong>F{String(bestPhoto?.frameIndex || 1).padStart(4, "0")}</strong> (Score:{" "}
                  {bestPhoto?.analysis?.finalScore ?? "—"})
                </p>
              </div>
            </header>
            <div className="duplicate-frames">
              {members.map((photo) => {
                const isKept = photo.status === "shortlisted" || photo.status === "favorite";
                const isRejected = photo.status === "rejected";

                return (
                  <div
                    className={`duplicate-frame ${photo.isBestInGroup ? "best-choice" : ""} ${
                      isKept ? "kept" : ""
                    } ${isRejected ? "rejected" : ""}`}
                    key={photo._id}
                  >
                    <button type="button" onClick={() => onOpen(photo)}>
                      <img src={photo.thumbnailUrl || photo.url} alt={photo.originalName} />
                      {photo.isBestInGroup && <span className="best-mark">BEST CHOICE</span>}
                      {isKept && <span className="keep-mark">○</span>}
                      {isRejected && <span className="reject-mark">×</span>}
                    </button>
                    <div className="duplicate-meta">
                      <div>
                        <span>F{String(photo.frameIndex).padStart(4, "0")}</span>
                        <small style={{ marginLeft: 5, color: "var(--amber)" }}>
                          {photo.analysis?.finalScore ?? "—"} pts
                        </small>
                      </div>
                      <button
                        type="button"
                        className={isKept ? "active-kept" : ""}
                        onClick={() => onKeepOnly(groupId, photo._id)}
                      >
                        {isKept ? "✓ KEPT" : "KEEP ONLY THIS"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
