'use client';
import { Marca } from './marca';
import { api, errorText } from '@/lib/api';
import { useState } from 'react';
import { AlertTriangle, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { type AnyRow, Field } from './portal-presentation';

export function Login({
  onLogin,
  message,
}: {
  onLogin: (u: AnyRow) => void;
  message?: string;
}) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const submit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const x = await api('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      onLogin(x.user);
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background p-6">
      <section className="relative w-full max-w-md space-y-6 animate-in fade-in zoom-in-95 duration-500">
        <Marca/>
        <h1 className="text-center text-4xl font-semibold tracking-[-.04em] text-foreground sm:text-5xl">
          Portal Suprimentos
        </h1>
        <Card className="border-border bg-card p-3 text-foreground ">
          <CardContent className="pt-6">
            <form className="space-y-4" onSubmit={submit}>
              {message && (
                <output className="block text-sm text-muted-foreground">
                  {message}
                </output>
              )}
              <Field label="E-mail">
                <Input
                  className="h-11"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Senha">
                <Input
                  className="h-11"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {error && (
                <Alert
                  variant="destructive"
                  className="animate-in fade-in slide-in-from-top-1"
                >
                  <AlertTriangle />
                  <AlertTitle>Não foi possível entrar</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button
                type="submit"
                className="h-11 w-full transition-transform active:scale-[.985]"
                disabled={busy || !email || !password}
              >
                {busy ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <ShieldCheck />
                )}{' '}
                Entrar
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
