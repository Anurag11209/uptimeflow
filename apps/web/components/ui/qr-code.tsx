"use client";

import { useEffect, useState } from "react";
import QRCodeLib from "qrcode";
import { cn } from "@/lib/utils";

export interface QRCodeProps {
  value: string;
  size?: number;
  className?: string;
  /** Quiet-zone width in modules, per the QR spec's recommended minimum of 4. */
  quietZone?: number;
}

/**
 * Renders a scannable QR code for TOTP setup (or any string) as inline SVG,
 * generated via the `qrcode` package. A previous hand-rolled encoder here
 * produced matrices that no scanner — including a real decoder we tested
 * against — could actually read; this wraps a verified implementation
 * instead of re-deriving Reed-Solomon ECC and module placement by hand.
 */
export function QRCode({ value, size = 180, className, quietZone = 4 }: QRCodeProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);

    QRCodeLib.toString(value, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: quietZone,
      color: { dark: "#0A0F1C", light: "#FFFFFF" },
    })
      .then((result) => {
        if (!cancelled) setSvg(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [value, quietZone]);

  if (failed || !value) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-lg border border-line bg-panel-2 p-4 text-center text-xs text-muted",
          className,
        )}
        style={{ width: size, height: size }}
      >
        QR unavailable — use the secret below instead.
      </div>
    );
  }

  if (!svg) {
    return (
      <div
        className={cn("animate-pulse rounded-lg bg-panel-2", className)}
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }

  return (
    <div
      role="img"
      aria-label="Two-factor setup QR code"
      className={cn("overflow-hidden rounded-md bg-white p-2 shadow-sm", className)}
      style={{ width: size, height: size }}
      // eslint-disable-next-line react/no-danger -- library-generated SVG, not user input
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
