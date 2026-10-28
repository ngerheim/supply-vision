import { modoEnsaio } from '../scripts/modo-ensaio.mjs';

export async function semearPagamentos(base, exemplo, estado, salvar) {
  if (!modoEnsaio()) throw new Error('Pagamentos de demonstracao exigem ensaio.');
  const usuario=exemplo.usuarios.find(u=>u.role==='viewer');
  const login=await fetch(`${base}/api/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(usuario)});
  if(!login.ok)throw new Error('Nao foi possivel entrar na conta ficticia de demonstracao.');
  const cookie=login.headers.get('set-cookie').split(';')[0];
  try {
    for(let i=0;i<2;i++){
      const chave=`pagamento-demo-${i}`;if(estado[chave])continue;
      const form=new FormData();for(const[k,v]of Object.entries({fornecedor:`Fornecedor Demonstração ${i+1}`,cnpj:'',numero_oc:`OC-DEMO-${i+1}`,numero_nf:`NF-DEMO-${i+1}`,valor_centavos:String(25000+i*17500),vencimento:`2026-12-${String(10+i).padStart(2,'0')}`,link:'https://example.com/fatura-ficticia',observacao:'Registro de demonstração com dados fictícios'}))form.set(k,v);
      const pdf=new Blob([`%PDF-1.4\n1 0 obj<<>>endobj\n% anexo ficticio ${i+1}\n%%EOF`],{type:'application/pdf'});
      form.set('oc',pdf,`ordem-${i+1}.pdf`);form.set('nf',pdf,`nota-${i+1}.pdf`);
      const resposta=await fetch(`${base}/api/pagamentos`,{method:'POST',headers:{cookie,'idempotency-key':`pagamento-demo-key-${i}-v1`},body:form});
      const dados=await resposta.json();if(!resposta.ok)throw new Error(`Falha ao semear pagamento ficticio (${resposta.status}).`);
      estado[chave]=dados.id;salvar();
    }
  } finally {await fetch(`${base}/api/logout`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'});}
}
