import { NextResponse } from 'next/server';

// ── In-memory captcha store ──
// Map<token, { answer: number, expiresAt: number }>
const globalCaptcha = globalThis as unknown as {
  __captchaStore?: Map<string, { answer: number; expiresAt: number }>;
};
const captchaStore = globalCaptcha.__captchaStore || new Map<string, { answer: number; expiresAt: number }>();
if (process.env.NODE_ENV !== 'production') globalCaptcha.__captchaStore = captchaStore;

// Clean expired entries periodically
function cleanExpired() {
  const now = Date.now();
  for (const [k, v] of captchaStore) {
    if (v.expiresAt < now) captchaStore.delete(k);
  }
}

// Generate random token
function randomToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Theme palettes for captcha SVG
const CAPTCHA_THEMES = {
  dark: {
    bg: '#0f172a',
    noiseColors: ['#1e3a5f', '#1a2744', '#2d4a6f', '#162238'],
    dotColor: (opacity: number) => `rgba(96,165,250,${opacity})`,
    textColors: ['#60a5fa', '#818cf8', '#93c5fd', '#a5b4fc', '#3b82f6'],
  },
  light: {
    bg: '#f1f5f9',
    noiseColors: ['#c7d2e0', '#b4c1d3', '#a8b8cc', '#bcc8d8'],
    dotColor: (opacity: number) => `rgba(37,99,235,${opacity})`,
    textColors: ['#2563eb', '#4f46e5', '#1d4ed8', '#6366f1', '#3b82f6'],
  },
};

// Generate SVG captcha image with noise (theme-aware)
function generateCaptchaSvg(text: string, theme: 'light' | 'dark' = 'dark'): string {
  const width = 140;
  const height = 44;
  const t = CAPTCHA_THEMES[theme];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  
  // Background
  svg += `<rect width="${width}" height="${height}" fill="${t.bg}" rx="6"/>`;
  
  // Random noise curves (more organic than straight lines)
  for (let i = 0; i < 5; i++) {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const cx = Math.random() * width;
    const cy = Math.random() * height;
    const x2 = Math.random() * width;
    const y2 = Math.random() * height;
    svg += `<path d="M${x1},${y1} Q${cx},${cy} ${x2},${y2}" stroke="${t.noiseColors[i % t.noiseColors.length]}" stroke-width="1.5" fill="none" opacity="0.7"/>`;
  }
  
  // Random dots
  for (let i = 0; i < 20; i++) {
    const cx = Math.random() * width;
    const cy = Math.random() * height;
    svg += `<circle cx="${cx}" cy="${cy}" r="${1 + Math.random() * 1.5}" fill="${t.dotColor(0.1 + Math.random() * 0.15)}"/>`;
  }
  
  // Text characters with individual transforms
  const chars = text.split('');
  const startX = 14;
  const spacing = (width - 28) / chars.length;
  
  for (let i = 0; i < chars.length; i++) {
    const x = startX + i * spacing + Math.random() * 4 - 2;
    const y = 28 + Math.random() * 6 - 3;
    const rotate = Math.random() * 16 - 8;
    const fontSize = 18 + Math.random() * 4;
    const color = t.textColors[Math.floor(Math.random() * t.textColors.length)];
    svg += `<text x="${x}" y="${y}" font-family="'JetBrains Mono', monospace" font-size="${fontSize}" font-weight="700" fill="${color}" transform="rotate(${rotate} ${x} ${y})">${chars[i]}</text>`;
  }
  
  svg += '</svg>';
  return svg;
}

export async function GET(request: Request) {
  cleanExpired();
  
  // Read theme from query params
  const url = new URL(request.url);
  const theme = url.searchParams.get('theme') === 'light' ? 'light' : 'dark';
  
  // Generate math challenge
  const ops = ['+', '-', '×'] as const;
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a: number, b: number, answer: number;
  
  switch (op) {
    case '+':
      a = Math.floor(Math.random() * 40) + 10;
      b = Math.floor(Math.random() * 40) + 10;
      answer = a + b;
      break;
    case '-':
      a = Math.floor(Math.random() * 40) + 30;
      b = Math.floor(Math.random() * 25) + 5;
      answer = a - b;
      break;
    case '×':
      a = Math.floor(Math.random() * 9) + 2;
      b = Math.floor(Math.random() * 9) + 2;
      answer = a * b;
      break;
  }
  
  const expression = `${a} ${op} ${b} = ?`;
  const token = randomToken();
  
  // Store answer with 5 minute TTL
  captchaStore.set(token, {
    answer,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  
  // Generate SVG with theme
  const svg = generateCaptchaSvg(expression, theme);
  const svgBase64 = Buffer.from(svg).toString('base64');
  
  return NextResponse.json({
    token,
    image: `data:image/svg+xml;base64,${svgBase64}`,
  });
}

// Validate captcha (called from auth route)
export function validateCaptcha(token: string, userAnswer: number): boolean {
  const entry = captchaStore.get(token);
  if (!entry) return false;
  
  // Delete after use (one-time)
  captchaStore.delete(token);
  
  if (entry.expiresAt < Date.now()) return false;
  return entry.answer === userAnswer;
}
