'use client';
import { Reports } from '@/components/reports';
import { podeAcessarAba, type Nav } from '@/lib/navegacao';
import { api, errorText } from '@/lib/api';
import { EmailNotifications } from '@/components/email-notifications';
import { Imports } from '@/components/imports';
import { AgreementDialog, ItemDialog } from '@/components/agreement-dialogs';
import { salvarEAtualizar } from '@/lib/atualizacao-periodica';
import { filtrosVazios } from '@/lib/filtros-busca';
import { dataDeNegocio } from '@/lib/data-negocio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { type JsonData, type AnyRow, Loading } from './portal-presentation';
import { Login } from './portal-login';
import { Sidebar } from './portal-sidebar';
import { SearchPage } from './portal-search';
import { Maintenance } from './portal-maintenance';
import { Agreements, AgreementDetail } from './portal-agreements';
import { CatalogPage, Catalogs, CatalogDialog } from './portal-catalogs';
import { Tickets } from './portal-tickets';
import { ChangeHistory } from './portal-history';
import { Administration } from './portal-users';
import { Mappings } from './portal-mappings';

export default function PortalApp() {
  const [session, setSession] = useState({ key: 0, message: '' });
  const endSession = useCallback((message = '') => {
    setSession(current => ({ key: current.key + 1, message }));
  }, []);
  // Remontar descarta tambem formularios e filtros da conta anterior.
  return <PortalSession key={session.key} message={session.message} endSession={endSession}/>;
}

function PortalSession({ message, endSession }: { message: string; endSession: (message?: string) => void }) {
  const [user,setUser]=useState<AnyRow|null|undefined>(undefined), [data,setData]=useState<AnyRow|null>(null), [nav,setNav]=useState<Nav>('search');
  const [busy,setBusy]=useState(false), [notice,setNotice]=useState<{type:'ok'|'error';text:string}|null>(message ? { type: 'error', text: message } : null), [agreementId,setAgreementId]=useState<string|null>(null);
  const [agreementModal,setAgreementModal]=useState<AnyRow|null>(null), [itemModal,setItemModal]=useState<AnyRow|null>(null), [catalogModal,setCatalogModal]=useState<AnyRow|null>(null);
  const [userList,setUserList]=useState<AnyRow[]>([]), [ticketLink,setTicketLink]=useState<string|null>(null);
  const [importAgreement,setImportAgreement]=useState('');
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const intentionalLogout=useRef(false);
  const ticketLinkHandled=useRef(false);
  const busyRef=useRef(false);
  const refreshSequence=useRef(0);
  const identity=useRef<string|null>(null);
  const noticeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const [loadError,setLoadError]=useState('');
  const [searchFilters,setSearchFilters]=useState(filtrosVazios);

  useEffect(()=>()=>{refreshSequence.current++;clearTimeout(noticeTimer.current)},[]);
  const notify=(type:'ok'|'error',text:string)=>{clearTimeout(noticeTimer.current);setNotice({type,text});noticeTimer.current=setTimeout(()=>setNotice(null),5000)};
  const refresh=useCallback(async()=>{
    const sequence=++refreshSequence.current;
    setLoadError('');
    try {
      const next=await api('/api/bootstrap');
      if(sequence!==refreshSequence.current)return;
      const nextIdentity=`${next.user.id}:${next.user.role}`;
      if(identity.current!==null&&identity.current!==nextIdentity){endSession();return}
      identity.current=nextIdentity;
      setUser(next.user);setData(next);setNav(atual=>podeAcessarAba(next.user.role,atual)?atual:'search');
      setUserList([]);
      if(next.user.role==='admin'||next.user.role==='editor')void api('/api/users')
        .then(x=>{if(sequence===refreshSequence.current)setUserList(x.users||[])})
        .catch(()=>{if(sequence===refreshSequence.current)setUserList([])});
    }catch(error){if(sequence===refreshSequence.current)setLoadError(errorText(error));throw error}
  },[endSession]);
  const initialize=useCallback(async()=>{setLoadError('');try{const x=await api('/api/session');setUser(x.user);if(x.user)await refresh()}catch(error){setLoadError(errorText(error))}},[refresh]);
  useEffect(()=>{let active=true;queueMicrotask(()=>{if(active)void initialize()});return()=>{active=false}},[initialize]);
  useEffect(()=>{if(!user)return;let active=true;const linked=new URLSearchParams(window.location.search).get('chamado');if(linked)queueMicrotask(()=>{if(active&&!ticketLinkHandled.current){ticketLinkHandled.current=true;if(user.role==='admin'||user.role==='editor'){setTicketLink(linked);setNav('tickets')}else{setNav('search');setNotice({type:'error',text:'Seu perfil permite consultar preços e acordos. O acesso a chamados é restrito.'})}}});return()=>{active=false}},[user]);
  useEffect(()=>{const expired=()=>{if(intentionalLogout.current)return;refreshSequence.current++;endSession('Sua sessão expirou. Entre novamente.')};window.addEventListener('portal:session-expired',expired);return()=>window.removeEventListener('portal:session-expired',expired)},[endSession]);
  const run=async(fn:()=>Promise<JsonData>,success?:string)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);try{return await salvarEAtualizar(fn,refresh,()=>{if(success)notify('ok',success)},()=>notify('error','Alteração salva, mas não foi possível atualizar a tela. Use Atualizar dados para conferir.'))}catch(error:unknown){notify('error',errorText(error))}finally{busyRef.current=false;setBusy(false)}};

  if(loadError&&!data&&user!==null) return <main className="grid min-h-screen place-items-center p-6"><Card className="max-w-md"><CardContent className="space-y-4 pt-6"><p role="alert">{loadError}</p><Button onClick={()=>void initialize()}>Tentar novamente</Button></CardContent></Card></main>;
  if(user===undefined) return <Loading label="Preparando sua base de acordos…"/>;
  if(!user) return <Login message={notice?.text} onLogin={(u)=>{intentionalLogout.current=false;setNotice(null);setUser(u);void refresh().catch(()=>{})}}/>;
  if(!data) return <Loading label="Carregando acordos…"/>;
  const catalogs=data.catalogs;
  const canWrite=user.role==='admin'||user.role==='editor';
  const isAdmin=user.role==='admin';
  const navigate=(next:Nav)=>{if(!podeAcessarAba(user.role,next))return;setNav(next);setAgreementId(null);setImportAgreement('')};
  const openAgreement=(id:string)=>{setAgreementId(id);setNav(canWrite?'agreements':'search')};
  const logout=()=>void (async()=>{if(busyRef.current)return;busyRef.current=true;intentionalLogout.current=true;setBusy(true);try{await api('/api/logout',{method:'POST'});refreshSequence.current++;endSession()}catch(error:unknown){intentionalLogout.current=false;notify('error',errorText(error))}finally{busyRef.current=false;setBusy(false)}})();
  const removerAcordo=(a:AnyRow,detalhe:AnyRow)=>{
    const condicoes=Number(detalhe?.totalItems??(detalhe?.items||[]).length), versoes=(detalhe?.versions||[]).length;
    const aviso=[
      `Excluir o acordo ${a.number} de ${a.supplier}?`,
      '',
      `Serão apagadas ${condicoes.toLocaleString('pt-BR')} condição(ões) e ${versoes} versão(ões).`,
      'O histórico de preços deste acordo não poderá ser recuperado.',
      '',
      'Chamados ligados a ele são preservados, apenas perdem o vínculo.',
    ].join('\n');
    if(!confirm(aviso))return;
    void run(async()=>{
      await api(`/api/agreements/${a.id}?expectedRevision=${encodeURIComponent(String(a.revision))}`,{method:'DELETE'});
      setAgreementId(null);
    },'Acordo excluído.');
  };
  const removeCatalog=(type:string,row:AnyRow)=>{const nome=row.tradeName||row.name||row.code||`${row.city} / ${row.state}`;if(!confirm(`Excluir "${nome}" definitivamente?\n\nSe estiver em uso por algum acordo, a exclusão será recusada.`))return;void run(async()=>{await api(`/api/catalogs/${type}/${row.id}?expectedRevision=${row.revision}`,{method:'DELETE'})},'Cadastro excluído.')};

  return <main className="min-h-screen bg-background text-foreground">
    <Sidebar nav={nav} setNav={navigate} user={user} busy={busy} onLogout={logout} collapsed={sidebarCollapsed} onToggle={()=>setSidebarCollapsed(value=>!value)}/>
    <section className={`min-w-0 pl-16 transition-[padding] duration-300 ${sidebarCollapsed?'lg:pl-16':'lg:pl-44'}`}><div className="mx-auto max-w-[1550px] p-4 sm:p-8">
      {nav==='search'&&(!agreementId||canWrite)&&<SearchPage catalogs={catalogs} openAgreement={openAgreement} filters={searchFilters} setFilters={setSearchFilters}/>}
      {((canWrite&&nav==='agreements')||(!canWrite&&nav==='search'&&agreementId))&&(agreementId?<AgreementDetail busy={busy} revision={data} id={agreementId} canWrite={canWrite} isAdmin={isAdmin} onDelete={removerAcordo} onBack={()=>setAgreementId(null)} onEdit={(a:AnyRow)=>setAgreementModal({...a,expectedRevision:a.revision})} onItem={(i:AnyRow)=>setItemModal({...i,agreementId,expectedRevision:i.revision})} onImport={()=>{navigate('imports');setImportAgreement(agreementId)}} run={run}/>:<Agreements data={data} canWrite={canWrite} onOpen={setAgreementId} onNew={()=>setAgreementModal({locationIds:[],status:'active',startDate:dataDeNegocio()})}/>)}
      {nav==='maintenance'&&<Maintenance url={String(data.manutencao||'')}/>}
      {canWrite&&nav==='suppliers'&&<CatalogPage type="suppliers" rows={catalogs.suppliers} onAdd={()=>setCatalogModal({type:'suppliers'})} onEdit={(row:AnyRow)=>setCatalogModal({type:'suppliers',...row,expectedRevision:row.revision})} onDelete={(row:AnyRow)=>removeCatalog('suppliers',row)}/>}
      {canWrite&&nav==='imports'&&<Imports data={data} canManageMappings={canWrite} initialAgreement={importAgreement} onUpdated={refresh} onCatalog={(type,values)=>setCatalogModal({type,...values})}/>}
      {canWrite&&nav==='mappings'&&<Mappings catalogs={catalogs} run={run}/>}
      {canWrite&&nav==='catalogs'&&<Catalogs data={data} onAdd={(type:string)=>setCatalogModal({type})} onEdit={(type:string,row:AnyRow)=>setCatalogModal({type,...row,expectedRevision:row.revision})} onDelete={removeCatalog}/>}
      {canWrite&&nav==='tickets'&&<Tickets busy={busy} users={userList} run={run} initialDetail={ticketLink}/>}
      {isAdmin&&nav==='history'&&<ChangeHistory users={userList}/>}
      {isAdmin&&nav==='admin'&&<Administration user={user} busy={busy} run={run}/>}
      {isAdmin&&nav==='reports'&&<Reports/>}
      {isAdmin&&nav==='notifications'&&<EmailNotifications users={userList} run={run}/>}
    </div></section>
    {loadError&&data&&<div className="fixed bottom-20 right-5 z-[100] max-w-md rounded-xl border bg-card p-4 shadow-lg"><p role="alert" className="text-sm">Não foi possível atualizar os dados.</p><Button className="mt-2" variant="outline" onClick={()=>void refresh().catch(()=>{})}>Atualizar dados</Button></div>}
    {notice&&<output className={`fixed bottom-5 right-5 z-[100] flex max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-2xl ${notice.type==='ok'?'bg-emerald-700':'bg-red-700'}`}>{notice.type==='ok'?<CheckCircle2 className="size-5"/>:<AlertTriangle className="size-5"/>}{notice.text}</output>}
    {canWrite&&agreementModal&&<AgreementDialog open value={agreementModal} catalogs={catalogs} busy={busy} onClose={()=>setAgreementModal(null)} onSave={(body:AnyRow)=>run(async()=>{if(body.id)await api(`/api/agreements/${body.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});else {const created=await api('/api/agreements',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});openAgreement(created.id)};setAgreementModal(null)},body.id?'Acordo atualizado.':'Acordo criado.')}/>}
    {canWrite&&itemModal&&<ItemDialog open value={itemModal} catalogs={catalogs} busy={busy} onClose={()=>setItemModal(null)} onSave={(body:AnyRow)=>run(async()=>{if(body.id)await api(`/api/items/${body.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});else await api(`/api/agreements/${body.agreementId}/items`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});setItemModal(null)},'Condição salva.')}/>}
    {canWrite&&catalogModal&&<CatalogDialog open value={catalogModal} busy={busy} onClose={()=>setCatalogModal(null)} onSave={(body:AnyRow)=>run(async()=>{const path=body.id?`/api/catalogs/${body.type}/${body.id}`:`/api/catalogs/${body.type}`;await api(path,{method:body.id?'PUT':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});setCatalogModal(null)},'Cadastro salvo.')}/>}
  </main>;
}
