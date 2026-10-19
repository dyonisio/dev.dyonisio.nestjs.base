import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import {
  centerOffset,
  clampOffset,
  coverScale,
  MAX_ZOOM,
  MIN_ZOOM,
  sourceSquare,
  zoomAround,
  type Point,
  type Size,
} from '../lib/crop';
import { Modal } from './ui';

/** Tamanho da janela de recorte na tela e da imagem que sai (avatar quadrado). */
const VIEW = 280;
const OUTPUT = 512;

/**
 * Recorte 1:1 da foto no próprio navegador, antes do upload: arrastar para posicionar,
 * zoom pela barra, pela rodinha ou pelo teclado (setas e +/-). O círculo mostra o avatar.
 *
 * A imagem sai redesenhada em 512×512 (JPEG): fica leve (dezenas de KB em vez de MB) e sem os
 * metadados da original (EXIF, inclusive a localização GPS das fotos de celular).
 */
export function AvatarCropper({
  file,
  onCancel,
  onCropped,
}: {
  file: File;
  onCancel: () => void;
  onCropped: (cropped: File) => void;
}) {
  const { m } = useI18n();
  const [src, setSrc] = useState<string | null>(null);
  const [image, setImage] = useState<Size | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ start: Point; from: Point } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const base = image ? coverScale(image, VIEW) : 1;
  const scale = base * zoom;

  function onLoad() {
    const img = imgRef.current!;
    const size = { width: img.naturalWidth, height: img.naturalHeight };
    setImage(size);
    setZoom(MIN_ZOOM);
    setOffset(centerOffset(size, VIEW, coverScale(size, VIEW)));
  }

  function changeZoom(next: number) {
    if (!image) return;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    setOffset(zoomAround(offset, image, VIEW, scale, base * z));
    setZoom(z);
  }

  function move(next: Point) {
    if (image) setOffset(clampOffset(next, image, VIEW, scale));
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: { x: e.clientX, y: e.clientY }, from: offset };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    move({ x: d.from.x + e.clientX - d.start.x, y: d.from.y + e.clientY - d.start.y });
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, Point> = {
      ArrowLeft: { x: step, y: 0 },
      ArrowRight: { x: -step, y: 0 },
      ArrowUp: { x: 0, y: step },
      ArrowDown: { x: 0, y: -step },
    };
    if (moves[e.key]) {
      e.preventDefault();
      move({ x: offset.x + moves[e.key]!.x, y: offset.y + moves[e.key]!.y });
    } else if (e.key === '+' || e.key === '=') {
      changeZoom(zoom + 0.1);
    } else if (e.key === '-') {
      changeZoom(zoom - 0.1);
    }
  }

  function confirm() {
    if (!image || !imgRef.current) return;
    const area = sourceSquare(offset, VIEW, scale);
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return setFailed(true);
    ctx.fillStyle = '#ffffff'; // PNG com transparência: fundo branco no JPEG
    ctx.fillRect(0, 0, OUTPUT, OUTPUT);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgRef.current, area.x, area.y, area.size, area.size, 0, 0, OUTPUT, OUTPUT);
    canvas.toBlob(
      (blob) => {
        if (!blob) return setFailed(true);
        onCropped(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.9,
    );
  }

  return (
    <Modal title={m.crop.title} onClose={onCancel}>
      <p className="muted dialog-text">{m.crop.help}</p>
      <div
        className="cropper"
        style={{ width: VIEW, height: VIEW }}
        role="application"
        aria-label={m.crop.area}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => changeZoom(zoom - e.deltaY * 0.002)}
        onKeyDown={onKeyDown}
      >
        {src && (
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={onLoad}
            onError={() => setFailed(true)}
            style={{
              width: image ? image.width * scale : undefined,
              height: image ? image.height * scale : undefined,
              transform: `translate(${offset.x}px, ${offset.y}px)`,
              visibility: image ? 'visible' : 'hidden',
            }}
          />
        )}
      </div>
      <label className="zoom">
        <span>{m.crop.zoom}</span>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          disabled={!image}
          onChange={(e) => changeZoom(Number(e.target.value))}
        />
      </label>
      {failed && (
        <p className="alert alert-error" role="alert">
          {m.crop.failed}
        </p>
      )}
      <div className="panel-actions">
        <button type="button" onClick={onCancel}>
          {m.common.cancel}
        </button>
        <button type="button" className="primary" disabled={!image || failed} onClick={confirm}>
          {m.crop.save}
        </button>
      </div>
    </Modal>
  );
}
