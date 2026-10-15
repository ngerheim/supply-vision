import { exportarTabelas } from './exportacao-snapshot.ts';
import { dataDeNegocio } from './data-negocio.ts';
import { SITUACAO_EFETIVA_SQL } from './situacao-acordos.ts';
import * as XLSX from 'xlsx';
import { type ContextoApi, type User } from './api-compartilhada.ts';

export function exportacoesApi(contexto: ContextoApi) {
  const { audit, now, rawDb, NextResponse, all } = contexto;

  async function exportDatabase(){
    const tables=await exportarTabelas(rawDb());
    const data={
      format:'portal-suprimentos-data-export',
      formatVersion:1,
      exportedAt:now(),
      securityNotice:'Senhas, sessões e tentativas de acesso não fazem parte desta exportação de dados.',
      recordCounts:Object.fromEntries(Object.entries(tables).map(([name,records])=>[name,records.length])),
      tables,
    };
    return new NextResponse(JSON.stringify(data),{headers:{
      'cache-control':'no-store',
      'content-type':'application/json; charset=utf-8',
      'content-disposition':`attachment; filename="exportacao-portal-suprimentos-${now().slice(0,10)}.json"`,
      'x-content-type-options':'nosniff',
    }});
  }

  async function exportAgreements(){
    const headers=['MODELO','PECA_SERVICO','CIDADE','UF','CNPJ','PRECO','FORNECEDOR','MEDIDA','MARCAS','INICIO_VIGENCIA','FIM_VIGENCIA','STATUS_ACORDO','SITUACAO_EFETIVA'];
    const rows=await all<{modelo:string;item:string;cidade:string;uf:string;cnpj:string;preco:number;fornecedor:string;medida:string;marcas:string|null;inicio:string;fim:string|null;status:string;effectiveStatus:string}>(`SELECT
    vm.name modelo,ci.name item,l.city cidade,l.state uf,s.cnpj,ai.price preco,s.trade_name fornecedor,
    un.code medida,ai.brands_text marcas,a.start_date inicio,a.end_date fim,a.status,${SITUACAO_EFETIVA_SQL} AS effectiveStatus
    FROM agreements a JOIN suppliers s ON s.id=a.supplier_id
    JOIN agreement_items ai ON ai.version_id=a.current_version_id
    JOIN catalog_items ci ON ci.id=ai.catalog_item_id JOIN vehicle_models vm ON vm.id=ai.vehicle_model_id
    JOIN units un ON un.id=ai.unit_id JOIN locations l ON l.id=ai.location_id
    ORDER BY s.trade_name,vm.name,ci.name,l.state,l.city,ai.id`,[dataDeNegocio()]);
    const excelDate=(value:string|null)=>value?new Date(`${value}T12:00:00.000Z`):null;
    const sheet=XLSX.utils.aoa_to_sheet([headers,...rows.map(row=>[
      row.modelo,row.item,row.cidade,row.uf,String(row.cnpj).padStart(14,'0'),Number(row.preco),row.fornecedor,row.medida,row.marcas||'',excelDate(row.inicio),excelDate(row.fim),row.status,row.effectiveStatus,
    ])],{cellDates:true});
    sheet['!autofilter']={ref:`A1:M${rows.length+1}`};
    sheet['!cols']=[18,30,20,6,17,13,28,10,28,17,17,18,20].map(wch=>({wch}));
    for(let line=2;line<=rows.length+1;line++){
      const cnpjCell=sheet[`E${line}`]; if(cnpjCell){cnpjCell.t='s';cnpjCell.z='@';}
      const priceCell=sheet[`F${line}`]; if(priceCell) priceCell.z='R$ #,##0.00';
      for(const column of ['J','K']){const cell=sheet[`${column}${line}`];if(cell)cell.z='dd/mm/yyyy';}
    }
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,sheet,'ACORDOS');
    const content=XLSX.write(workbook,{bookType:'xlsx',type:'array',cellDates:true}) as ArrayBuffer;
    return new NextResponse(content,{headers:{
      'cache-control':'no-store','content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':`attachment; filename="ACORDOS-${now().slice(0,10)}.xlsx"`,'x-content-type-options':'nosniff',
    }});
  }

  async function downloadAgreements(user: User) {
    const resposta = await exportAgreements();
    await audit(user.id, 'EXPORT', 'agreement', null, 'Planilha de acordos gerada para download');
    return resposta;
  }

  async function downloadDatabase(user: User) {
    // Monta primeiro e so entao registra: gravar antes faria a auditoria
    // afirmar que houve download mesmo se a exportacao falhasse.
    const resposta = await exportDatabase();
    await audit(user.id, 'EXPORT', 'system', null, 'Backup completo da base gerado para download');
    return resposta;
  }

  return { downloadDatabase, downloadAgreements };
}
