'use client';
import { Marca } from './marca';
import { api, errorText } from '@/lib/api';
import { useState } from 'react';
import { AlertTriangle, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
    <main className="patio-login">
      <section className="patio-login-brand">
        <div>
          <Marca login />
          <p className="patio-login-tagline">Portal de Suprimentos</p>
        </div>
      </section>
      <section className="patio-login-form-panel">
        <div className="patio-login-form">
          <h1 className="patio-page-title">Entrar</h1>
          <form className="space-y-4" onSubmit={submit}>
            {message && (
              <output className="block text-sm text-muted-foreground">
                {message}
              </output>
            )}
            <Field label="E-mail">
              <Input
                required
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Senha">
              <Input
                required
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
              className="patio-login-submit w-full"
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ShieldCheck />
              )}{' '}
              Entrar
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
