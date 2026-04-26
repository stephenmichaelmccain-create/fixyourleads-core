import { ImageResponse } from 'next/og';

export const size = {
  width: 64,
  height: 64
};

export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(180deg, #1f1b42 0%, #110f22 100%)'
        }}
      >
        <svg viewBox="0 0 64 64" width="64" height="64" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="icon-bg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#2c2d63" />
              <stop offset="100%" stopColor="#141327" />
            </linearGradient>
            <linearGradient id="icon-brand" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#d96cff" />
              <stop offset="100%" stopColor="#7d17ff" />
            </linearGradient>
          </defs>

          <rect x="3" y="3" width="58" height="58" rx="16" fill="url(#icon-bg)" />

          <circle cx="32" cy="32" r="18" fill="none" stroke="rgba(99, 210, 255, 0.28)" strokeWidth="1.4" />
          <ellipse cx="32" cy="32" rx="10.5" ry="18" fill="none" stroke="rgba(99, 210, 255, 0.16)" strokeWidth="1.1" />
          <ellipse cx="32" cy="32" rx="18" ry="8.6" fill="none" stroke="rgba(99, 210, 255, 0.16)" strokeWidth="1.1" />
          <path d="M14 24H50" stroke="rgba(99, 210, 255, 0.12)" strokeWidth="1" />
          <path d="M14 40H50" stroke="rgba(99, 210, 255, 0.12)" strokeWidth="1" />

          <path
            d="M25 44 L18 50 L19.5 40.5 C16 37 14 33 14 28 C14 18 22 10 32 10 C42 10 50 18 50 28 C50 38 42 46 32 46 Z"
            fill="none"
            stroke="url(#icon-brand)"
            strokeWidth="3.2"
            strokeLinejoin="round"
          />
          <path
            d="M20 28 H26 L29 22.5 L32.5 34.5 L36.5 28 H44"
            fill="none"
            stroke="url(#icon-brand)"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    {
      ...size
    }
  );
}
