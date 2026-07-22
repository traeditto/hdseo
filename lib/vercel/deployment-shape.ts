export type ProviderDeploymentWithIdentifier<T extends object> = T & {
  id?: string;
  uid?: string;
};

export function normalizeProviderDeployment<T extends object>(
  item: ProviderDeploymentWithIdentifier<T>,
): T & { id: string } {
  const id = item.id ?? item.uid;
  if (!id) throw new Error("Vercel returned a deployment without an identifier.");
  return { ...item, id };
}
