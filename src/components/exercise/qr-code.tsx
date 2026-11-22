"use client";

// QR code as inline SVG, drawn from the module matrix of the `qrcode`
// package. No canvas, no data URL, no external service.

import { useMemo } from "react";
import { create } from "qrcode";

/** One SVG path for every dark module, with a four-module quiet zone. Pure. */
export function qrPath(text: string): { size: number; d: string } {
  const qr = create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 4;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.modules.data[y * n + x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return { size: n + quiet * 2, d };
}

export function QrCode({ value, size = 160, label, className }: { value: string; size?: number; label: string; className?: string }) {
  const qr = useMemo(() => qrPath(value), [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={qr.size} height={qr.size} fill="#ffffff" />
      <path d={qr.d} fill="#000000" />
    </svg>
  );
}
