const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
export async function assinarIpLogin(ip: string, token: string) {
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(token),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('login-ip:'+ip)));
}
export async function ipLoginAssinado(headers: Headers, token: string | undefined) {
  const ip=headers.get('x-sv-client-ip'), prova=headers.get('x-sv-client-proof');
  if(!token||!ip||!/^[a-f0-9:.]{1,64}$/i.test(ip)||!prova||!/^[a-f0-9]{64}$/.test(prova))return null;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(token),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(prova.match(/../g)!, n=>parseInt(n,16));
  return await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode('login-ip:'+ip))?ip:null;
}
