export async function semearUsuarios(api, exemplo) {
  const { users } = await api('/users');
  const ids = {};
  for (const usuario of exemplo.usuarios) {
    const existente = users.find(u => u.email === usuario.email);
    ids[usuario.role] = existente?.id || (await api('/users', 'POST', usuario)).id;
  }
  return ids;
}
