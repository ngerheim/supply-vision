import path from 'node:path';

const produto = path.resolve(import.meta.dirname, '../..');
export const privado = path.resolve(process.env.SUPPLY_VISION_PRIVADO || path.join(produto, 'privado'));
export const portalPrivado = path.join(privado, 'portal');
