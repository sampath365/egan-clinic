import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Eraser, Grid3x3, Pen, Redo2, Trash2, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';

export interface InkStroke {
  tool: 'pen' | 'eraser';
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
}

export interface InkCanvasHandle {
  /** Renders the current canvas to a PNG data URL (white background). */
  toDataURL: () => string | null;
  getStrokes: () => InkStroke[];
  loadStrokes: (strokes: InkStroke[]) => void;
  clear: () => void;
  isEmpty: () => boolean;
}

interface InkCanvasProps {
  height?: number;
  showGrid?: boolean;
  className?: string;
}

const COLORS = ['#111827', '#1d4ed8', '#0f8372', '#b91c1c'];
const WIDTHS = [2, 3, 5, 8];

/**
 * Finger/stylus/mouse ink surface. Strokes are stored as vectors so they can be
 * re-rendered losslessly and serialized for storage. The canvas is never
 * interpreted as medicine orders — it is preserved exactly as written.
 */
export const InkCanvas = forwardRef<InkCanvasHandle, InkCanvasProps>(function InkCanvas(
  { height = 360, showGrid = true, className }, ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  const [redoStack, setRedoStack] = useState<InkStroke[]>([]);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState(COLORS[0]!);
  const [width, setWidth] = useState(WIDTHS[1]!);
  const [grid, setGrid] = useState(showGrid);
  const drawing = useRef<InkStroke | null>(null);
  const [dpr, setDpr] = useState(1);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = canvas;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    if (grid) {
      ctx.strokeStyle = '#eef1f5';
      ctx.lineWidth = 1;
      const step = 28 * dpr;
      for (let x = step; x < w; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = step; y < h; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const all = drawing.current ? [...strokes, drawing.current] : strokes;
    for (const s of all) {
      if (s.points.length === 0) continue;
      ctx.beginPath();
      ctx.strokeStyle = s.tool === 'eraser' ? '#ffffff' : s.color;
      ctx.lineWidth = (s.tool === 'eraser' ? s.width * 3 : s.width) * dpr;
      ctx.moveTo(s.points[0]!.x * dpr, s.points[0]!.y * dpr);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i]!.x * dpr, s.points[i]!.y * dpr);
      if (s.points.length === 1) ctx.lineTo(s.points[0]!.x * dpr + 0.1, s.points[0]!.y * dpr + 0.1);
      ctx.stroke();
    }
    ctx.restore();
  }, [strokes, grid, dpr]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    setDpr(ratio);
    const resize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${height}px`;
      redraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [height, redraw]);

  useEffect(() => { redraw(); }, [redraw]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawing.current = { tool, color, width, points: [pos(e)] };
    redraw();
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current.points.push(pos(e));
    redraw();
  }
  function onPointerUp() {
    if (!drawing.current) return;
    const finished = drawing.current;
    drawing.current = null;
    setStrokes((prev) => [...prev, finished]);
    setRedoStack([]);
  }

  useImperativeHandle(ref, () => ({
    toDataURL: () => {
      const canvas = canvasRef.current;
      return canvas ? canvas.toDataURL('image/png') : null;
    },
    getStrokes: () => strokes,
    loadStrokes: (s) => { setStrokes(s); setRedoStack([]); },
    clear: () => { setStrokes([]); setRedoStack([]); },
    isEmpty: () => strokes.length === 0,
  }), [strokes]);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-ink-100 p-1">
          <button
            onClick={() => setTool('pen')}
            aria-pressed={tool === 'pen'}
            className={cn('flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium', tool === 'pen' ? 'bg-white text-brand-700 shadow-card' : 'text-ink-600')}
          >
            <Pen className="h-4 w-4" /> Pen
          </button>
          <button
            onClick={() => setTool('eraser')}
            aria-pressed={tool === 'eraser'}
            className={cn('flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium', tool === 'eraser' ? 'bg-white text-brand-700 shadow-card' : 'text-ink-600')}
          >
            <Eraser className="h-4 w-4" /> Eraser
          </button>
        </div>

        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => { setColor(c); setTool('pen'); }}
              aria-label={`Ink colour ${c}`}
              className={cn('h-7 w-7 rounded-full ring-2 ring-offset-1 transition', color === c && tool === 'pen' ? 'ring-brand-500' : 'ring-transparent')}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-ink-100 p-1">
          {WIDTHS.map((w) => (
            <button
              key={w}
              onClick={() => setWidth(w)}
              aria-label={`Stroke width ${w}`}
              aria-pressed={width === w}
              className={cn('flex h-8 w-8 items-center justify-center rounded-md', width === w ? 'bg-white shadow-card' : '')}
            >
              <span className="rounded-full bg-ink-800" style={{ width: w + 2, height: w + 2 }} />
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setStrokes((prev) => { const last = prev.at(-1); if (last) setRedoStack((r) => [...r, last]); return prev.slice(0, -1); })} disabled={strokes.length === 0}>
            <Undo2 className="h-4 w-4" /> Undo
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRedoStack((prev) => { const last = prev.at(-1); if (last) setStrokes((s) => [...s, last]); return prev.slice(0, -1); })} disabled={redoStack.length === 0}>
            <Redo2 className="h-4 w-4" /> Redo
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setStrokes([]); setRedoStack([]); }} disabled={strokes.length === 0}>
            <Trash2 className="h-4 w-4" /> Clear
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setGrid((g) => !g)} aria-pressed={grid}>
            <Grid3x3 className="h-4 w-4" /> {grid ? 'Grid on' : 'Grid off'}
          </Button>
        </div>
      </div>

      <div ref={containerRef} className="relative overflow-hidden rounded-xl border border-ink-300 bg-white">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          className="block w-full touch-none cursor-crosshair"
        />
        {strokes.length === 0 && (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-ink-400">
            Write or draw the prescription here — finger, stylus or mouse.
          </p>
        )}
      </div>
      <p className="hint">Handwriting is stored exactly as written and is never converted into medicine orders automatically.</p>
    </div>
  );
});
