export default function Toolbar({
  filters,
  setFilters,
  counts,
  onReset,
  onRetry,
  onExportCsv,
  onExportZip,
}) {
  const tabs = [
    ["all", "ALL", counts.all],
    ["best", "BEST", counts.best],
    ["good", "GOOD", counts.good],
    ["review", "REVIEW", counts.review],
    ["flagged", "FLAGGED", counts.flagged],
    ["rejected", "REJECTED", counts.rejected],
    ["favorite", "FAVORITES", counts.favorite],
    ["duplicates", "DUPLICATES", counts.duplicates],
  ];

  return (
    <div className="toolbar">
      <div className="tabs">
        {tabs.map(([k, l, n]) => (
          <button
            key={k}
            type="button"
            className={filters.category === k ? "tab active" : "tab"}
            onClick={() => setFilters({ ...filters, category: k })}
          >
            {l}
            <span>{n}</span>
          </button>
        ))}
      </div>
      <div className="toolbar-actions">
        <select
          value={filters.sort}
          onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
        >
          <option value="score">HIGHEST SCORE</option>
          <option value="sharp">SHARPEST</option>
          <option value="newest">NEWEST</option>
          <option value="oldest">OLDEST</option>
          <option value="face">BEST FACE</option>
          <option value="technical">BEST TECHNICAL</option>
        </select>
        <button type="button" className="text-btn" onClick={onRetry}>
          RETRY FAILED
        </button>
        <button type="button" className="text-btn" onClick={onReset}>
          START OVER
        </button>
        <button
          type="button"
          className="action-btn"
          onClick={onExportCsv}
          title="Export shoot metadata to CSV"
        >
          CSV
        </button>
        <button
          type="button"
          className="action-btn filled"
          onClick={onExportZip}
          title="Download shortlisted & favorite photos as ZIP"
        >
          ZIP
        </button>
      </div>
    </div>
  );
}

