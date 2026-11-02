import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getPhotos,
  getStats,
  keepOnly,
  resetPhotos,
  retryAnalysis,
  updateStatus,
} from "./api";
import { runBackgroundEyePass } from "./utils/eyeDetection";
import { useAuth } from "./context/AuthContext";
import { io } from "socket.io-client";
import UploadZone from "./components/UploadZone";
import Toolbar from "./components/Toolbar";
import PhotoGrid from "./components/PhotoGrid";
import DuplicateGroups from "./components/DuplicateGroups";
import Reviewer from "./components/Reviewer";
import Dashboard from "./components/Dashboard";

export default function App() {
  const { user, logout, navigate } = useAuth();
  const [photos, setPhotos] = useState([]);
  const queuedOrProcessingRef = useRef(new Set());
  const [stats, setStats] = useState({
    total: 0,
    analyzed: 0,
    shortlisted: 0,
    flagged: 0,
    rejected: 0,
    duplicates: 0,
    averageQualityScore: 0,
  });
  const [filters, setFilters] = useState({ category: "all", sort: "score" });
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [reviewer, setReviewer] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");

  const loadPhotos = useCallback(
    async (targetPage = 1, append = false) => {
      try {
        const res = await getPhotos({
          page: targetPage,
          limit: 50,
          category: filters.category,
          sort: filters.sort,
        });
        const incoming = res.data?.data?.photos || [];
        const pagination = res.data?.data?.pagination || {};

        setPhotos((current) => (append ? [...current, ...incoming] : incoming));
        setPages(pagination.pages || 1);
      } catch (e) {
        setError(e.response?.data?.message || "Failed to load photos");
      }
    },
    [filters.category, filters.sort]
  );

  const handleLoadMore = useCallback(() => {
    if (page < pages) {
      const nextPage = page + 1;
      setPage(nextPage);
      loadPhotos(nextPage, true);
    }
  }, [page, pages, loadPhotos]);

  const refreshStats = useCallback(async () => {
    try {
      const res = await getStats();
      if (res.data?.data) setStats(res.data.data);
    } catch {
      // stats error fallback
    }
  }, []);

  useEffect(() => {
    setPage(1);
    loadPhotos(1, false);
    refreshStats();
  }, [filters.category, filters.sort, loadPhotos, refreshStats]);

  // Socket.io for live background analysis events
  useEffect(() => {
    const socket = io({ withCredentials: true });

    socket.on("analysis:photo", (event) => {
      if (event.userId && user?._id && String(event.userId) !== String(user._id)) return;

      if (event.status === "complete" || event.status === "failed") {
        setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
      }

      setPhotos((current) =>
        current.map((p) =>
          p._id === event.photoId
            ? {
                ...p,
                analysis: {
                  ...p.analysis,
                  ...(event.analysis || {}),
                  analysisStatus: event.status,
                },
              }
            : p
        )
      );
      refreshStats();
    });

    return () => socket.disconnect();
  }, [user?._id, refreshStats]);

  // Run browser face-api eye detection in the background for unprocessed photos
  useEffect(() => {
    if (photos.length > 0) {
      const needsPass = photos.filter((p) => {
        if (!p._id) return false;
        if (queuedOrProcessingRef.current.has(String(p._id))) return false;
        if (p.analysis?.faceChecked === true) return false;
        return (
          p.analysis?.faceDetected === null ||
          p.analysis?.faceDetected === undefined ||
          (p.analysis?.faceDetected === true && (p.analysis?.eyeState === null || p.analysis?.eyeState === undefined))
        );
      });

      if (needsPass.length > 0) {
        needsPass.forEach((p) => queuedOrProcessingRef.current.add(String(p._id)));

        runBackgroundEyePass(
          needsPass,
          (id, updatedAnalysis, updatedFlags) => {
            queuedOrProcessingRef.current.delete(String(id));
            setPhotos((cur) =>
              cur.map((p) =>
                p._id === id
                  ? {
                      ...p,
                      flags: updatedFlags || p.flags || [],
                      flagged: (updatedFlags && updatedFlags.length > 0) || p.flagged,
                      analysis: { ...p.analysis, ...updatedAnalysis, faceChecked: true },
                    }
                  : p
              )
            );
            refreshStats();
          },
          (id, err) => {
            queuedOrProcessingRef.current.delete(String(id));
            console.warn(`[Eye Pass] Error on photo ${id}:`, err);
          }
        );
      }
    }
  }, [photos, refreshStats]);

  const counts = useMemo(() => {
    const c = {
      all: stats.total || photos.length,
      best: stats.best ?? 0,
      good: stats.good ?? 0,
      review: stats.review ?? 0,
      flagged: stats.flagged || 0,
      rejected: stats.rejected || 0,
      favorite: stats.favorite ?? 0,
      duplicates: stats.duplicates || 0,
    };
    let localFlagged = 0;
    let localBest = 0;
    let localGood = 0;
    let localReview = 0;
    let localFavorite = 0;

    photos.forEach((p) => {
      const isFlagged =
        p.status === "flagged" ||
        p.flagged ||
        (p.flags && p.flags.length > 0) ||
        p.analysis?.eyesClosed === true ||
        p.analysis?.eyesOpen === false ||
        p.analysis?.blurStatus === "blurry";
      if (isFlagged) localFlagged++;

      const s = p.analysis?.finalScore;
      if (s !== null && s !== undefined) {
        if (s >= 90) localBest++;
        else if (s >= 75) localGood++;
        else localReview++;
      } else {
        localReview++;
      }
      if (p.favorite || p.status === "favorite") localFavorite++;
    });

    c.flagged = Math.max(c.flagged, localFlagged);
    if (!stats.total && photos.length > 0) {
      c.best = localBest;
      c.good = localGood;
      c.review = localReview;
      c.favorite = localFavorite;
    }
    return c;
  }, [photos, stats]);

  const handleStatusChange = async (id, status) => {
    try {
      const res = await updateStatus(id, status);
      setPhotos((current) =>
        current.map((p) => (p._id === id ? res.data.data : p))
      );
      setReviewer((current) =>
        current && current._id === id ? res.data.data : current
      );
      refreshStats();
    } catch (e) {
      setError(e.response?.data?.message || "Failed to update photo status");
    }
  };

  const handleExportZip = (e) => {
    e?.preventDefault();
    if (!stats.shortlisted && counts.best === 0 && counts.good === 0) {
      setError("No shortlisted or favorite photos to export. Mark photos with KEEP or ★ first.");
      return;
    }
    setError("");
    window.location.href = "/api/photos/export/zip";
  };

  const handleExportCsv = (e) => {
    e?.preventDefault();
    if (!stats.total && photos.length === 0) {
      setError("No photos in shoot to export.");
      return;
    }
    setError("");
    window.location.href = "/api/photos/export/csv";
  };

  const handleKeepOnly = async (groupId, keepId) => {
    try {
      await keepOnly(groupId, keepId);
      loadPhotos(1, false);
      refreshStats();
    } catch (e) {
      setError(e.response?.data?.message || "Failed to update duplicate group");
    }
  };

  const handleReset = async () => {
    if (window.confirm("Delete all photos in your PixSort session? This cannot be undone.")) {
      try {
        queuedOrProcessingRef.current.clear();
        await resetPhotos();
        setPhotos([]);
        setStats({
          total: 0,
          analyzed: 0,
          shortlisted: 0,
          flagged: 0,
          rejected: 0,
          duplicates: 0,
          averageQualityScore: 0,
        });
      } catch (e) {
        setError(e.response?.data?.message || "Failed to reset photos");
      }
    }
  };

  const handleRetryAnalysis = async () => {
    try {
      queuedOrProcessingRef.current.clear();
      await retryAnalysis();
      loadPhotos(true);
    } catch (e) {
      setError(e.response?.data?.message || "Failed to retry analysis");
    }
  };

  const handleNextReviewer = (index, delta) => {
    const validIndex = index >= 0 ? index : 0;
    const nextIndex = validIndex + delta;
    if (nextIndex >= photos.length) {
      setReviewer(null);
    } else if (nextIndex < 0) {
      setReviewer(photos[0] || null);
    } else {
      setReviewer(photos[nextIndex] || null);
    }
  };

  return (
    <main>
      <header className="site-header">
        <div className="sprocket-strip">
          {Array.from({ length: 26 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
        <div className="brand-row">
          <div>
            <span className="eyebrow">LOCAL-FIRST AI PHOTO CULLING</span>
            <h1>
              PIXSORT<span>•</span>
            </h1>
          </div>
          <div className="user-menu">
            <span className="user-greeting">
              {user?.name || "Photographer"}
            </span>{" "}
            ·{" "}
            <button className="user-link-btn" onClick={() => navigate("/account")}>
              ACCOUNT
            </button>{" "}
            ·{" "}
            <button className="user-link-btn logout" onClick={logout}>
              LOG OUT
            </button>
          </div>
        </div>
      </header>

      <div className="app-shell">
        {error && <div className="error-banner">{error}</div>}

        <Dashboard stats={stats} />

        <UploadZone
          onUploaded={(d) => {
            setProgress({ done: 0, total: d.accepted || 0 });
            setPage(1);
            loadPhotos(1, false);
            refreshStats();
          }}
        />

        <Toolbar
          filters={filters}
          setFilters={(newFilters) => {
            setPage(1);
            setFilters(newFilters);
          }}
          counts={counts}
          onReset={handleReset}
          onRetry={handleRetryAnalysis}
          onExportCsv={handleExportCsv}
          onExportZip={handleExportZip}
        />

        {filters.category === "duplicates" ? (
          <DuplicateGroups
            photos={photos}
            onKeepOnly={handleKeepOnly}
            onOpen={setReviewer}
          />
        ) : (
          <PhotoGrid
            photos={photos}
            onOpen={setReviewer}
            onStatus={handleStatusChange}
            hasMore={page < pages}
            onLoadMore={handleLoadMore}
          />
        )}
      </div>

      <footer className="site-footer">
        <span>PIXSORT / {stats.analyzed} OF {stats.total} ANALYZED</span>
        <span>
          {progress.total > 0
            ? `ANALYSIS ${Math.min(
                100,
                Math.round((progress.done / progress.total) * 100)
              )}%`
            : "READY"}
        </span>
      </footer>

      <Reviewer
        photo={reviewer}
        queue={photos}
        onClose={() => setReviewer(null)}
        onStatus={handleStatusChange}
        onNext={handleNextReviewer}
        onSelect={setReviewer}
      />
    </main>
  );
}
