'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';

interface WatermarkProps {
  /** Text lines to display, e.g. ['admin', '2026-03-28 09:00'] */
  content: string[];
  /** Font size in pixels (default: 10) */
  fontSize?: number;
  /** Rotation angle in degrees (default: -20) */
  rotate?: number;
  /** Opacity from 0 to 1 (default: 0.08) */
  opacity?: number;
  /** Gap between watermark tiles [x, y] (default: [140, 100]) */
  gap?: [number, number];
  /** Text color (default: 'currentColor') */
  color?: string;
}

/**
 * Global watermark overlay for data leakage prevention (DLP).
 *
 * Features:
 * - Canvas-based tiling for performance
 * - Anti-tamper via MutationObserver (auto-restores if removed)
 * - pointer-events: none — does not block user interaction
 * - Adapts to dark/light theme via currentColor
 */
export default function Watermark({
  content,
  fontSize = 8,
  rotate = -20,
  opacity = 0.12,
  gap = [120, 80],
  color,
}: WatermarkProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const watermarkRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const [themeColor, setThemeColor] = useState<string>('');

  // Track theme changes to update watermark color
  useEffect(() => {
    function readColor() {
      const c = getComputedStyle(document.documentElement).color || '#000';
      setThemeColor(c);
    }
    readColor();
    const obs = new MutationObserver(readColor);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', readColor);
    return () => { obs.disconnect(); mq.removeEventListener('change', readColor); };
  }, []);

  const renderWatermark = useCallback(() => {
    if (!containerRef.current) return;

    // Clean up existing watermark
    if (watermarkRef.current && containerRef.current.contains(watermarkRef.current)) {
      containerRef.current.removeChild(watermarkRef.current);
    }

    // Create canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const font = `${fontSize}px -apple-system, "SF Pro Display", "PingFang SC", sans-serif`;

    // Measure text dimensions
    ctx.font = font;
    const lines = content.filter(Boolean);
    const lineHeight = fontSize * 1.5;
    const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
    const textBlockH = lines.length * lineHeight;

    // Canvas tile size (text block + gap)
    const tileW = maxWidth + gap[0];
    const tileH = textBlockH + gap[1];
    canvas.width = tileW * dpr;
    canvas.height = tileH * dpr;
    canvas.style.width = `${tileW}px`;
    canvas.style.height = `${tileH}px`;
    ctx.scale(dpr, dpr);

    // Draw rotated text
    ctx.translate(tileW / 2, tileH / 2);
    ctx.rotate((rotate * Math.PI) / 180);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Use a neutral gray that contrasts on both light and dark backgrounds
    ctx.fillStyle = color || '#888888';
    ctx.globalAlpha = 1; // opacity handled by the container div

    const startY = -(lines.length - 1) * lineHeight / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, 0, startY + i * lineHeight);
    });

    // Create watermark div
    const wmDiv = document.createElement('div');
    wmDiv.setAttribute('data-watermark', 'true');
    Object.assign(wmDiv.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '99999',
      opacity: String(opacity),
      backgroundImage: `url(${canvas.toDataURL()})`,
      backgroundRepeat: 'repeat',
      backgroundPosition: '0 0',
      // Prevent selection/printing of watermark
      userSelect: 'none',
      WebkitUserSelect: 'none',
    } as Record<string, string>);

    containerRef.current.appendChild(wmDiv);
    watermarkRef.current = wmDiv;

    // Anti-tamper: observe removal or style modification
    if (observerRef.current) {
      observerRef.current.disconnect();
    }
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Watermark was removed from DOM
        if (mutation.type === 'childList') {
          const removed = Array.from(mutation.removedNodes);
          if (removed.includes(wmDiv)) {
            // Re-render after a short delay to avoid infinite loop
            setTimeout(() => renderWatermark(), 50);
            return;
          }
        }
        // Watermark style was tampered with
        if (mutation.type === 'attributes' && mutation.target === wmDiv) {
          setTimeout(() => renderWatermark(), 50);
          return;
        }
      }
    });

    observer.observe(containerRef.current, { childList: true });
    observer.observe(wmDiv, { attributes: true, attributeFilter: ['style'] });
    observerRef.current = observer;
  }, [content, fontSize, rotate, opacity, gap, color, themeColor]);

  useEffect(() => {
    renderWatermark();

    // Re-render on resize
    window.addEventListener('resize', renderWatermark);
    return () => {
      window.removeEventListener('resize', renderWatermark);
      observerRef.current?.disconnect();
    };
  }, [renderWatermark]);

  return <div ref={containerRef} style={{ position: 'fixed', top: 0, left: 0, width: 0, height: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 99999 }} />;
}
