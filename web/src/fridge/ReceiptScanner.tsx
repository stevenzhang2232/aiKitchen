import { useEffect, useRef, useState } from 'react';
import { UNITS, type Unit } from '@kitchen/core';
import { api, ApiError } from '../api';
import { useApp, useAppState } from '../appState';
import { FieldError, Modal } from '../components/Modal';
import { UNIT_LABEL } from '../components/forms';

interface Line {
  key: number;
  name: string;
  foodId: number | null;
  qty: string;
  unit: Unit;
}

/** Shrink large photos before sending them to the AI. */
async function toDataUrl(source: CanvasImageSource, width: number, height: number): Promise<string> {
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

async function fileToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await toDataUrl(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Camera({ onShot, onCancel }: { onShot: (dataUrl: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError('The camera is not available. Allow camera access, or upload a photo instead.'));
    if (!navigator.mediaDevices) setError('This browser has no camera access. Upload a photo instead.');
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);
  return (
    <div className="stack">
      {error ? <p className="field-error">{error}</p> : <video ref={video} autoPlay playsInline muted className="camera-view" />}
      <div className="row">
        <button onClick={onCancel}>Back</button>
        {!error && (
          <button
            className="primary"
            onClick={async () => {
              const v = video.current!;
              onShot(await toDataUrl(v, v.videoWidth, v.videoHeight));
            }}
          >
            Take photo
          </button>
        )}
      </div>
    </div>
  );
}

export function ReceiptScanner({ onClose }: { onClose: () => void }) {
  const state = useAppState();
  const { run, showToast } = useApp();
  const [stage, setStage] = useState<'choose' | 'camera' | 'reading' | 'review'>('choose');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const foods = [...state.foods].sort((a, b) => a.name.localeCompare(b.name));

  if (!state.ai?.configured) {
    return (
      <Modal title="Scan a receipt" onClose={onClose}>
        <p>Receipt scanning needs an AI model. Set one up in Settings → AI model.</p>
      </Modal>
    );
  }
  if (!state.ai.vision) {
    return (
      <Modal title="Scan a receipt" onClose={onClose}>
        <p>The current AI model can’t read images. Add a vision model in Settings → AI model.</p>
      </Modal>
    );
  }

  const read = async (image: string) => {
    setStage('reading');
    setError(null);
    try {
      const r = await api.post<{ items: { name: string; foodId: number | null; qty: number; unit: Unit }[] }>('/api/receipt/read', { image });
      if (!r.items.length) {
        setError('No food items were found on this photo. Try a clearer photo.');
        setStage('choose');
        return;
      }
      setLines(r.items.map((i, k) => ({ key: k, name: i.name, foodId: i.foodId, qty: String(i.qty), unit: i.unit })));
      setStage('review');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not read the receipt.');
      setStage('choose');
    }
  };

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const addAll = async () => {
    const bad = lines.find((l) => !(Number(l.qty) > 0) || (!l.foodId && !l.name.trim()));
    if (bad) return setError(`Check “${bad.name || 'unnamed item'}”: it needs a name and an amount greater than 0.`);
    setBusy(true);
    try {
      const r = await api.post<{ undoId: string }>('/api/receipt/add', {
        items: lines.map((l) => ({ foodId: l.foodId, name: l.name.trim(), qty: Number(l.qty), unit: l.unit })),
      });
      await run(async () => undefined);
      showToast({ message: `Added ${lines.length} items from the receipt`, undoId: r.undoId });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add the items.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Scan a receipt"
      onClose={onClose}
      wide
      footer={
        stage === 'review' ? (
          <>
            <button onClick={() => setStage('choose')}>Scan another photo</button>
            <button className="primary" disabled={busy || !lines.length} onClick={addAll}>
              Add {lines.length} items to fridge
            </button>
          </>
        ) : undefined
      }
    >
      {stage === 'choose' && (
        <div className="stack">
          <p className="muted">Take or upload a photo of your grocery receipt. You’ll check the list before anything is added.</p>
          <div className="row">
            <label className="button-like primary">
              Upload photo
              <input
                type="file"
                accept="image/*"
                aria-label="Upload receipt photo"
                className="visually-hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) read(await fileToDataUrl(f).catch(() => ''));
                }}
              />
            </label>
            <button onClick={() => setStage('camera')}>Use camera</button>
          </div>
        </div>
      )}
      {stage === 'camera' && <Camera onShot={read} onCancel={() => setStage('choose')} />}
      {stage === 'reading' && <p className="muted">Reading the receipt…</p>}
      {stage === 'review' && (
        <div className="stack">
          <p className="muted">Check the list. Fix names or amounts, or remove lines you don’t want.</p>
          <div className="receipt-table" role="table" aria-label="Receipt items">
            {lines.map((l) => (
              <div className="receipt-row" role="row" key={l.key}>
                <select
                  aria-label={`Ingredient for ${l.name}`}
                  value={l.foodId ?? ''}
                  onChange={(e) => update(l.key, { foodId: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">New: {l.name}</option>
                  {foods.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}{f.isSeasoning ? ' (seasoning)' : ''}</option>
                  ))}
                </select>
                <input aria-label={`Amount of ${l.name}`} type="number" min={0} step="any" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
                <select aria-label={`Unit of ${l.name}`} value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value as Unit })}>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>{UNIT_LABEL[u]}</option>
                  ))}
                </select>
                <button className="icon-btn" aria-label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <FieldError message={error} />
    </Modal>
  );
}
