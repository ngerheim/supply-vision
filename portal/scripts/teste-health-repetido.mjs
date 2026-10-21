import assert from 'node:assert/strict';
import { setTimeout as esperar } from 'node:timers/promises';
const porta=Number(process.env.PORTAL_TESTE_PORTA),rodadas=Number(process.env.PORTAL_TESTE_HEALTH_RODADAS||30);
if(process.env.PORTAL_TESTE_DESCARTAVEL!=='SIM'||!Number.isInteger(porta)||porta<1024||porta>65534||!Number.isInteger(rodadas)||rodadas<1||rodadas>1000)throw new Error('Exige instancia descartavel.');
let total=0;
for(let n=0;n<rodadas;n++){
 // Entre ondas nao ha fixtures nem escritor externo: apenas ociosidade.
 await esperar(100);
 const respostas=await Promise.all(Array.from({length:20},()=>fetch(`http://127.0.0.1:${porta}/api/health`,{signal:AbortSignal.timeout(5000)})));
 for(const r of respostas){assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).status,'ok');total++;}
}
console.log(`[OK] Health: ${total} leituras em ${rodadas} ondas com ociosidade, zero erros e nenhuma nova tentativa.`);
