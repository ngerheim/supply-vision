'use client';
import { useState } from 'react';

export function Marca({ login = false }: { login?: boolean }) {
  const [ausente, setAusente] = useState(false);
  return <div className={`patio-marca ${login ? 'patio-marca-login' : ''}`}>
    {/* The public SVG endpoint must remain an isolated image document. */}
    {/* oxlint-disable-next-line next/no-img-element */}
    {!ausente && <img src="/api/marca/logo" alt="" onError={() => setAusente(true)}/>}
    {ausente && <p>Supply Vision</p>}
  </div>;
}
