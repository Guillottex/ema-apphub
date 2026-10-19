import { useState } from 'react';

/**
 * Logo principal de EMA Servicios (public/logo-ema.png, copiado de www.emaservicios.com.ar).
 * Si el archivo no está disponible se muestra un isologo tipográfico con los colores institucionales.
 */
export default function Logo({ width = 150 }: { width?: number }) {
  const [failed, setFailed] = useState(false);
  if (!failed) return <img src="/logo-ema.png" alt="EMA Servicios" style={{ width }} onError={() => setFailed(true)} />;
  return (
    <svg width={width} viewBox="0 0 300 86" role="img" aria-label="EMA Servicios">
      <text x="0" y="62" fontFamily="Outfit, sans-serif" fontWeight="800" fontSize="70" fill="#282964" letterSpacing="-2">EMA</text>
      <g fill="#76C6E2">
        {Array.from({ length: 12 }).map((_, i) => (
          <rect key={i} x={170 + (i % 6) * 20 - Math.floor(i / 6) * 8} y={14 + Math.floor(i / 6) * 18} width="16" height="13" rx="2" transform="skewX(-18)" />
        ))}
      </g>
      <rect x="150" y="56" width="140" height="3" fill="#282964" />
      <text x="290" y="82" textAnchor="end" fontFamily="Outfit, sans-serif" fontStyle="italic" fontWeight="600" fontSize="20" fill="#282964">SERVICIOS</text>
    </svg>
  );
}
