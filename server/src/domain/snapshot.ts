export function stripSnapshotSecrets(snapshot: string): string {
  try {
    const obj = JSON.parse(snapshot) as { environments?: { variables?: { secret?: boolean; value?: string }[] }[] };
    for (const env of obj.environments ?? []) {
      for (const v of env.variables ?? []) if (v.secret === true) v.value = "";
    }
    return JSON.stringify(obj);
  } catch {
    return snapshot;
  }
}
