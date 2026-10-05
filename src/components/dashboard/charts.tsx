import React, { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

/** Width of an element, kept current as the layout changes. */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Rounds a maximum up to 1, 2 or 5 × 10ⁿ so the axis reads in round numbers. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return step * exp;
}

interface SparklineProps {
  values: number[];
  className?: string;
  /** Visible label for screen readers, e.g. "Tren pesanan 30 hari". */
  label: string;
}

/** A trend line without axes, sized by its parent. Flat when there is no data. */
export const Sparkline: React.FC<SparklineProps> = ({ values, className, label }) => {
  const gradientId = useId();
  const w = 120;
  const h = 32;
  const max = Math.max(...values, 0);
  const pts = values.map((v, i) => [
    values.length > 1 ? (i / (values.length - 1)) * w : w / 2,
    max > 0 ? h - 2 - (v / max) * (h - 6) : h - 2
  ]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = pts.length ? `${line} L${w},${h} L0,${h} Z` : '';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label} className={cn('h-8 w-full', className)}>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#2bb2b5" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#2bb2b5" stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={area} fill={`url(#${gradientId})`} />}
      {line && <path d={line} fill="none" stroke="#13707f" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
    </svg>
  );
};

export interface TrendPoint {
  label: string;
  /** Longer label for the tooltip, e.g. "Senin, 5 Okt". */
  fullLabel: string;
  value: number;
}

interface TrendChartProps {
  points: TrendPoint[];
  format: (v: number) => string;
  /** Short axis formatter; defaults to `format`. */
  formatAxis?: (v: number) => string;
  height?: number;
  label: string;
}

/*
 * Area chart drawn in plain SVG at the container's real width, so text keeps
 * its size instead of stretching with a scaled viewBox. Hover or arrow keys
 * reveal each point's exact value.
 */
export const TrendChart: React.FC<TrendChartProps> = ({ points, format, formatAxis = format, height = 230, label }) => {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();

  const padL = 48;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = Math.max(0, width - padL - padR);
  const innerH = height - padT - padB;
  const max = niceMax(Math.max(...points.map(p => p.value), 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => t * max);
  const x = (i: number) => padL + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = points.length ? `${line} L${x(points.length - 1)},${padT + innerH} L${x(0)},${padT + innerH} Z` : '';
  // Thin the x labels so they never collide: about one every 64px.
  const every = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(innerW / 64))));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!points.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left - padL) / Math.max(1, innerW);
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') setHover(h => Math.min(points.length - 1, (h ?? -1) + 1));
    if (e.key === 'ArrowLeft') setHover(h => Math.max(0, (h ?? points.length) - 1));
  };

  const active = hover != null ? points[hover] : null;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal rounded-lg"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#2bb2b5" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#2bb2b5" stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map(t => (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="#e3eeee" strokeDasharray={t === 0 ? undefined : '3 4'} />
              <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="#5b7172" className="tabular-nums">
                {formatAxis(t)}
              </text>
            </g>
          ))}

          {points.map((p, i) => (i % every === 0 || i === points.length - 1) && (
            <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} fontSize="11" fill="#5b7172">
              {p.label}
            </text>
          ))}

          {area && <path d={area} fill={`url(#${gradientId})`} />}
          {line && <path d={line} fill="none" stroke="#13707f" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}

          {points.length <= 31 && points.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p.value)} r={hover === i ? 4.5 : 2.5} fill="#ffffff" stroke="#13707f" strokeWidth="1.6" />
          ))}

          {active && hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke="#13707f" strokeOpacity="0.35" />
          )}
        </svg>
      )}

      {active && hover != null && (
        <div
          role="status"
          className="pointer-events-none absolute top-1 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs shadow-diffusion"
          style={{
            left: Math.min(Math.max(x(hover) - 70, 0), Math.max(0, width - 140)),
            width: 140
          }}
        >
          <div className="text-muted-foreground">{active.fullLabel}</div>
          <div className="font-bold text-foreground tabular-nums">{format(active.value)}</div>
        </div>
      )}
    </div>
  );
};
