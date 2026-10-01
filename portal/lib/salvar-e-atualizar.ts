export async function salvarEAtualizar<T>(save: () => Promise<T>, refresh: () => Promise<unknown>, onSaved: () => void, onRefreshError: (error: unknown) => void): Promise<T> {
  const result = await save();
  onSaved();
  try { await refresh(); } catch (error) { onRefreshError(error); }
  return result;
}
