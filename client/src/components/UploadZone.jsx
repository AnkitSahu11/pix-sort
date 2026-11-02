import { useRef, useState } from "react";
import { uploadPhotos } from "../api";

export default function UploadZone({ onUploaded, onStart }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("DROP A SHOOT HERE");

  async function files(list) {
    const fs = [...list].filter((f) =>
      ["image/jpeg", "image/png", "image/webp"].includes(f.type)
    );
    if (!fs.length) return;
    setBusy(true);
    setMessage(`Uploading ${fs.length} frames…`);
    try {
      const r = await uploadPhotos(fs, (e) => {
        if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
      });
      onUploaded?.(r.data.data);
      onStart?.();
      setMessage(`Accepted ${r.data.data.accepted} · analysis continues in background`);
    } catch (e) {
      setMessage(e.response?.data?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`upload-zone ${busy ? "busy" : ""}`}
      onClick={() => !busy && ref.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        files(e.dataTransfer.files);
      }}
    >
      <input
        ref={ref}
        hidden
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          files(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="upload-mark">+</div>
      <div className="upload-copy">
        <strong>{busy ? "UPLOADING…" : message}</strong>
        <span>JPG / PNG / WEBP · BATCH UP TO 500</span>
        {busy && (
          <div className="progress">
            <i style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    </section>
  );
}

