import type { Metadata } from 'next';
// Fontes empacotadas localmente: nao dependem de internet nem do Google Fonts,
// o que importa porque o portal roda offline na rede da empresa.
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'Portal Suprimentos | Supply Vision',
  description: 'Gestão e consulta de acordos comerciais de suprimentos.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className="antialiased">{children}</body></html>;
}
