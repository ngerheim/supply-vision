// Homologacao somente leitura: recibos SMTP dos Alertas e entregas do Portal.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { localizarBanco } from './banco-local.mjs';

export function ultimasEntregas(privado) {
  const resultado={alertas:[],relatorios:[],avisos:[]};
  const pasta=path.join(privado,'alertas','estado-envios');
  if(fs.existsSync(pasta)){
    for(const nome of fs.readdirSync(pasta).filter(n=>n.endsWith('.json'))){
      try{
        const recibo=JSON.parse(fs.readFileSync(path.join(pasta,nome),'utf8').replace(/^\uFEFF/,''));
        const data=new Date(recibo.atualizado);
        if(!['enviado','parcial','incerto'].includes(recibo.estado)||!Number.isFinite(data.getTime()))throw new Error('Recibo invalido');
        resultado.alertas.push({data:data.toISOString(),estado:recibo.estado});
      }catch{resultado.avisos.push('Recibo dos Alertas ilegivel ou sem data valida; confira estado-envios.');}
    }
  }
  try{
    const arquivo=localizarBanco(null,path.join(privado,'portal'));
    if(arquivo){
      const db=new DatabaseSync(arquivo,{readOnly:true});
      try{
        db.exec('PRAGMA busy_timeout=5000');
        if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='daily_report_deliveries'").get()){
          resultado.relatorios=db.prepare("SELECT sent_at AS data,'enviado' AS estado FROM daily_report_deliveries WHERE status='sent' AND sent_at IS NOT NULL ORDER BY sent_at DESC LIMIT 5").all();
        }
      }finally{db.close();}
    }
  }catch{resultado.avisos.push('Entregas de relatorios indisponiveis; confira o banco local do Portal.');}
  resultado.alertas.sort((a,b)=>b.data.localeCompare(a.data));
  resultado.alertas=resultado.alertas.slice(0,5);
  return resultado;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const pos=process.argv.indexOf('--privado');
  if(pos<0||!process.argv[pos+1])throw new Error('Informe --privado.');
  console.log(JSON.stringify(ultimasEntregas(path.resolve(process.argv[pos+1]))));
}
