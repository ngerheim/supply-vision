'use client';
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
      <div className="space-y-5">
        <h1 className="text-2xl font-semibold">Histórico de Manutenção</h1>
        <Alert>
          <AlertTriangle />
          <AlertTitle>Relatório temporariamente indisponível</AlertTitle>
          <AlertDescription>
            O endereço do Power BI está ausente ou inválido na configuração
            deste servidor. Avise a equipe responsável pelo Portal.
          </AlertDescription>
        </Alert>
      </div>
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Histórico de Manutenção</h1>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
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
        </div>
      </div>
      <Card className="overflow-hidden shadow-sm">
        <CardContent className="p-0">
          <iframe
            key={recarga}
            src={url}
            title="Histórico de Manutenção — relatório do Power BI"
            className="h-[calc(100vh-11rem)] min-h-[640px] w-full border-0"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads"
          />
        </CardContent>
      </Card>
    </div>
  );
}
