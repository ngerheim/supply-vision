'use client';
import { pode } from '@/lib/permissoes';
import { api, errorText, baixarArquivo } from '@/lib/api';
import { MIN_PASSWORD_LENGTH, validatePassword } from '@/lib/domain';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, Pencil, Plus } from 'lucide-react';
import { Status } from './status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  type JsonData,
  type AnyRow,
  Field,
  SelectField,
  roleName,
  Loading,
  FalhaDeCarregamento,
} from './portal-presentation';

export function Administration({ user, busy, run }: JsonData) {
  const [users, setUsers] = useState<AnyRow[] | null>(null),
    [open, setOpen] = useState(false),
    [edit, setEdit] = useState<AnyRow | null>(null);
  const [loadError, setLoadError] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await api('/api/users', { signal });
    if (signal?.aborted) return;
    setUsers(result.users);
    setLoadError('');
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal).catch(error => {
        if (!controller.signal.aborted) setLoadError(errorText(error));
      });
    });
    return () => controller.abort();
  }, [load]);
  const podeGerenciar = pode(user, 'usuario:gerenciar');
  if (loadError) return <FalhaDeCarregamento erro={loadError} tentar={() => void load().catch(error => setLoadError(errorText(error)))}/>;
  if (!users) return <Loading label="Carregando usuários…"/>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              void baixarArquivo('/api/export').catch(error => setLoadError(errorText(error)))
            }
          >
            <Download /> Exportar dados
          </Button>
          <Button disabled={busy} variant="outline" onClick={() => void run(load)}>
            Atualizar lista
          </Button>
          {podeGerenciar && (
            <Button variant="create" disabled={busy} onClick={() => setOpen(true)}>
              <Plus /> Novo usuário
            </Button>
          )}
        </div>
      </div>
      <Card>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Relatório diário</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((r) => (
                <TableRow key={r.id} >
                  <TableCell className="font-medium">
                    {r.name}
                    {r.id === user.id ? (
                      <Badge className="ml-2 bg-muted text-muted-foreground">
                        você
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm">{r.email}</TableCell>
                  <TableCell>
                    <Badge
                      className={
                        r.role === 'admin'
                          ? 'bg-muted text-muted-foreground'
                          : r.role === 'editor'
                            ? 'bg-muted text-muted-foreground'
                            : 'bg-muted text-muted-foreground'
                      }
                    >
                      {roleName(r.role)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {r.dailyReportEnabled ? (
                      <span className="text-sm font-medium">
                        Diariamente às {r.dailyReportTime}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Não recebe
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Status value={r.active ? 'active' : 'cancelled'}>
                      {r.active ? 'Ativo' : 'Inativo'}
                    </Status>
                  </TableCell>
                  <TableCell className="text-right">
                    {podeGerenciar && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={`Editar usuário ${r.name}`}
                        onClick={() => setEdit({ ...r })}
                      >
                        <Pencil />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {open && <UserDialog
        open
        busy={busy}
        onClose={() => setOpen(false)}
        onSave={(body: AnyRow) =>
          run(async () => {
            await api('/api/users', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            });
            setOpen(false);
            await load().catch(error => setLoadError(errorText(error)));
          }, 'Usuário criado.')
        }
      />}
      {edit && (
        <UserEditDialog
          open
          busy={busy}
          value={edit}
          self={user}
          onClose={() => setEdit(null)}
          onSave={(body: AnyRow) =>
            run(async () => {
              await api(`/api/users/${body.id}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              });
              setEdit(null);
              await load().catch(error => setLoadError(errorText(error)));
            }, 'Usuário atualizado.')
          }
        />
      )}
    </div>
  );
}

function UserEditDialog({ open, busy, value, self, onClose, onSave }: JsonData) {
  const [form, setForm] = useState<AnyRow>({
    ...value,
    expectedRevision: value.revision,
    password: '',
  });
  const isSelf = value.id === self.id;
  const passwordError = form.password ? validatePassword(form.password) : null;
  return (
    <Dialog open={open} onOpenChange={(x) => !x && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
          <DialogDescription>{value.email}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="space-y-4">
          <Field label="Nome">
            <Input
              value={form.name || ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <SelectField
            label="Perfil"
            disabled={busy || isSelf}
            value={form.role || 'viewer'}
            onChange={(v: string) =>
              setForm({
                ...form,
                role: v,
                dailyReportEnabled:
                  v === 'viewer' ? false : form.dailyReportEnabled,
              })
            }
            rows={[
              { id: 'viewer', name: 'Consulta' },
              { id: 'editor', name: 'Suprimentos' },
              { id: 'admin', name: 'Administrador' },
            ]}
          />
          <Field label="Nova senha">
            <Input
              type="password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={200}
              aria-invalid={!!passwordError}
              placeholder="Deixe em branco para manter a atual"
              value={form.password || ''}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            {passwordError && (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {passwordError}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Ao redefinir, as sessões abertas deste usuário são encerradas.
            </p>
          </Field>
          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="daily-report-enabled"
                disabled={busy || form.role === 'viewer'}
                checked={form.role !== 'viewer' && !!form.dailyReportEnabled}
                onCheckedChange={(c: JsonData) =>
                  setForm({ ...form, dailyReportEnabled: !!c })
                }
              />
              <label
                htmlFor="daily-report-enabled"
                className="cursor-pointer text-sm font-medium"
              >
                Receber relatório diário de chamados
              </label>
            </div>
            {form.dailyReportEnabled ? (
              <Field label="Horário de envio" className="mt-3">
                <Input
                  type="time"
                  value={form.dailyReportTime || '17:45'}
                  onChange={(e) =>
                    setForm({ ...form, dailyReportTime: e.target.value })
                  }
                />
              </Field>
            ) : null}
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-3">
            <Checkbox
              checked={form.active !== false && form.active !== 0}
              onCheckedChange={(c: JsonData) =>
                setForm({ ...form, active: !!c })
              }
              disabled={busy || isSelf}
            />
            <span className="text-sm">
              Conta ativa
              {isSelf ? ' (não é possível desativar a própria conta)' : ''}
            </span>
          </label>
        </fieldset>
        <DialogFooter>
          <Button disabled={busy} variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={busy || !!passwordError}
            onClick={() => !busy && !passwordError && onSave(form)}
          >
            <CheckCircle2 /> Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserDialog({ open, busy, onClose, onSave }: JsonData) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'viewer',
  });
  const passwordError = validatePassword(form.password);
  return (
    <Dialog open={open} onOpenChange={(x) => !x && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo usuário autorizado</DialogTitle>
        </DialogHeader>
        <fieldset disabled={busy} className="space-y-4">
          <Field label="Nome *">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="E-mail *">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Senha inicial *">
            <Input
              type="password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={200}
              aria-invalid={!!passwordError}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            {passwordError && (
              <p role="alert" className="mt-1 text-sm text-destructive">
                {passwordError}
              </p>
            )}
          </Field>
          <SelectField
            label="Perfil"
            disabled={busy}
            value={form.role}
            onChange={(v: string) => setForm({ ...form, role: v })}
            rows={[
              { id: 'viewer', name: 'Consulta' },
              { id: 'editor', name: 'Suprimentos' },
              { id: 'admin', name: 'Administrador' },
            ]}
          />
        </fieldset>
        <DialogFooter>
          <Button disabled={busy} variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={busy || !!passwordError || !form.name.trim() || !form.email.trim()}
            onClick={() => !busy && !passwordError && onSave(form)}
          >
            Criar usuário
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
