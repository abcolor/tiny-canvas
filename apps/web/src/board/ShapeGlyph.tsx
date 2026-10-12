import type { ShapeKind } from '@tinycanvas/shared';

// 形狀選單用的小圖（20×20 座標）
const paths: Record<ShapeKind, string> = {
  rectangle: 'M3 5h14v10H3z',
  rounded: 'M8 5h4a5 5 0 0 1 0 10H8a5 5 0 0 1 0-10z',
  ellipse: 'M10 4a7 6 0 1 0 0.01 0z',
  diamond: 'M10 3l7 7-7 7-7-7z',
  parallelogram: 'M6 5h11l-3 10H3z',
  trapezoid: 'M6 5h8l3 10H3z',
  cylinder: 'M4 6c0-3 12-3 12 0v8c0 3-12 3-12 0zM4 6c0 3 12 3 12 0',
  document: 'M3 4h14v10c-4-2-10 3-14 0z',
  hexagon: 'M6 4h8l4 6-4 6H6l-4-6z',
  octagon: 'M7 3h6l4 4v6l-4 4H7l-4-4V7z',
  triangle: 'M10 3l8 14H2z',
  pentagon: 'M10 3l7 5-3 9H6l-3-9z',
  star: 'M10 2.5l2.2 4.8 5.3.6-3.9 3.6 1.1 5.2L10 14l-4.7 2.7 1.1-5.2-3.9-3.6 5.3-.6z',
  cloud: 'M6 15a3.5 3.5 0 0 1-.5-7A4.5 4.5 0 0 1 14 7a3.5 3.5 0 0 1 .5 8z',
  person: 'M10 3a2.6 2.6 0 1 0 .01 0zM4.5 17c0-4 2.5-6 5.5-6s5.5 2 5.5 6z',
  arrow_right: 'M2 7h10V4l6 6-6 6v-3H2z',
  chevron: 'M2 5h11l4 5-4 5H2l4-5z',
  callout: 'M3 4h14v9H9l-4 3v-3H3z',
  cross: 'M7 3h6v4h4v6h-4v4H7v-4H3V7h4z',
  manual_input: 'M3 8l14-3v11H3z',
};

export function ShapeGlyph({ kind, className = 'h-5 w-5' }: { kind: ShapeKind; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden>
      <path d={paths[kind]} />
    </svg>
  );
}
