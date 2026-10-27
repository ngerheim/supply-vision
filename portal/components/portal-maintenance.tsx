'use client';
import { PageHeader } from './page-header';
import { useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/* A aba nao guarda copia nem consulta banco: ela emoldura uma pagina do
   relatorio publicado no Power BI. O endereco chega pelo bootstrap, so depois
   do login, e e montado no servidor (lib/powerbi.ts). */
export function Maintenance({ url }: { url: string }) {
  /* Trocar a key remonta o iframe do zero. E a unica forma de recarregar um
     quadro de outra origem: o portal nao consegue falar com o conteudo dele. */
  const [recarga, setRecarga] = useState(0);
  if (!url)
    return (
      <div className="patio-page">
        <PageHeader />
        <Alert>
          <AlertTriangle />
          <AlertTitle>Relatório temporariamente indisponível</AlertTitle>
          <AlertDescription>
            Avise a equipe responsável pelo Portal.
          </AlertDescription>
        </Alert>
      </div>
    );
  return (
    <div className="patio-page">
      <PageHeader
        actions={
          <>
            {' '}
            <Button
              variant="outline"
              onClick={() => setRecarga((valor) => valor + 1)}
            >
              <RefreshCw /> Recarregar
            </Button>
            <Button
              variant="outline"
              onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink /> Abrir em nova aba
            </Button>
          </>
        }
      />
      <Card className="overflow-hidden ">
        <CardContent className="p-0">
          <iframe
            key={recarga}
            src={url}
            title="Histórico de Manutenção — relatório do Power BI"
            className="h-[calc((100vh-11rem)/var(--zoom-portal))] min-h-[640px] w-full border-0"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads"
          />
        </CardContent>
      </Card>
    </div>
  );
}
