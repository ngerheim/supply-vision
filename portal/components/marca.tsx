'use client';
import { useState } from 'react';

export function Marca() {
  const [ausente, setAusente] = useState(false);
  return <div className="patio-marca">
    {/* The public SVG endpoint must remain an isolated image document. */}
    {/* oxlint-disable-next-line next/no-img-element */}
    {!ausente && <img src="/api/marca/logo" alt="" onError={() => setAusente(true)}/>}
    <p className="font-semibold">Supply Vision</p>
  </div>;
}
