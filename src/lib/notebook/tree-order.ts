import fs from 'fs/promises';
import path from 'path';

export const NOTEBOOK_TREE_ORDER_FILE = '.ace-tree-order.json';

interface NotebookTreeOrderFile {
  order: string[];
  icons?: Record<string, string>;
}

async function readTreeMetaFile(dirPath: string): Promise<NotebookTreeOrderFile> {
  try {
    const raw = await fs.readFile(path.join(dirPath, NOTEBOOK_TREE_ORDER_FILE), 'utf-8');
    const data = JSON.parse(raw) as NotebookTreeOrderFile;
    const order = Array.isArray(data?.order)
      ? data.order.filter((name): name is string => typeof name === 'string' && name.length > 0)
      : [];
    const icons = Object.fromEntries(
      Object.entries(data?.icons || {}).filter(
        ([name, icon]) => typeof name === 'string' && name.length > 0 && typeof icon === 'string' && icon.trim().length > 0,
      ),
    );
    return { order, icons };
  } catch {
    return { order: [], icons: {} };
  }
}

async function writeTreeMetaFile(dirPath: string, data: NotebookTreeOrderFile): Promise<void> {
  const dedupedOrder = Array.from(new Set((data.order || []).filter(Boolean)));
  const icons = Object.fromEntries(
    Object.entries(data.icons || {}).filter(
      ([name, icon]) => Boolean(name) && typeof icon === 'string' && icon.trim().length > 0,
    ),
  );
  if (dedupedOrder.length === 0 && Object.keys(icons).length === 0) {
    await fs.rm(path.join(dirPath, NOTEBOOK_TREE_ORDER_FILE), { force: true }).catch(() => undefined);
    return;
  }
  await fs.writeFile(
    path.join(dirPath, NOTEBOOK_TREE_ORDER_FILE),
    JSON.stringify({ order: dedupedOrder, icons }, null, 2),
    'utf-8',
  );
}

async function writeOrderFile(dirPath: string, order: string[]): Promise<void> {
  const deduped = Array.from(new Set(order.filter(Boolean)));
  const current = await readTreeMetaFile(dirPath);
  await writeTreeMetaFile(dirPath, { order: deduped, icons: current.icons || {} });
}

export async function listNotebookOrderableChildren(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.name !== NOTEBOOK_TREE_ORDER_FILE)
    .map((entry) => entry.name);
}

export async function getNotebookDirectoryOrder(dirPath: string): Promise<string[]> {
  const [stored, current] = await Promise.all([
    readTreeMetaFile(dirPath).then((data) => data.order),
    listNotebookOrderableChildren(dirPath),
  ]);
  const currentSet = new Set(current);
  const merged = stored.filter((name) => currentSet.has(name));
  current.forEach((name) => {
    if (!merged.includes(name)) merged.push(name);
  });
  return merged;
}

export async function appendNotebookDirectoryOrder(dirPath: string, name: string): Promise<void> {
  const order = await getNotebookDirectoryOrder(dirPath);
  const next = order.filter((item) => item !== name);
  next.push(name);
  await writeOrderFile(dirPath, next);
}

export async function removeNotebookDirectoryOrder(dirPath: string, name: string): Promise<void> {
  const order = await getNotebookDirectoryOrder(dirPath);
  await writeOrderFile(dirPath, order.filter((item) => item !== name));
}

export async function renameNotebookDirectoryOrder(dirPath: string, oldName: string, newName: string): Promise<void> {
  const order = await getNotebookDirectoryOrder(dirPath);
  const next = order.map((item) => (item === oldName ? newName : item)).filter((item, index, list) => list.indexOf(item) === index);
  await writeOrderFile(dirPath, next);
}

export async function reorderNotebookDirectoryEntry(
  dirPath: string,
  sourceName: string,
  targetName: string,
  position: 'before' | 'after',
): Promise<void> {
  const order = await getNotebookDirectoryOrder(dirPath);
  if (!order.includes(sourceName) || !order.includes(targetName)) {
    return;
  }

  const withoutSource = order.filter((item) => item !== sourceName);
  const targetIndex = withoutSource.indexOf(targetName);
  if (targetIndex < 0) return;

  const insertAt = position === 'before' ? targetIndex : targetIndex + 1;
  withoutSource.splice(insertAt, 0, sourceName);
  await writeOrderFile(dirPath, withoutSource);
}

export async function getNotebookDirectoryIcons(dirPath: string): Promise<Record<string, string>> {
  const meta = await readTreeMetaFile(dirPath);
  return meta.icons || {};
}

export async function setNotebookDirectoryIcon(dirPath: string, name: string, icon: string | null): Promise<void> {
  const meta = await readTreeMetaFile(dirPath);
  const icons = { ...(meta.icons || {}) };
  if (icon && icon.trim()) icons[name] = icon.trim();
  else delete icons[name];
  await writeTreeMetaFile(dirPath, { order: meta.order || [], icons });
}

export async function removeNotebookDirectoryIcon(dirPath: string, name: string): Promise<void> {
  await setNotebookDirectoryIcon(dirPath, name, null);
}

export async function renameNotebookDirectoryIcon(dirPath: string, oldName: string, newName: string): Promise<void> {
  const meta = await readTreeMetaFile(dirPath);
  const icons = { ...(meta.icons || {}) };
  if (icons[oldName]) {
    icons[newName] = icons[oldName];
    delete icons[oldName];
    await writeTreeMetaFile(dirPath, { order: meta.order || [], icons });
  }
}

export async function copyNotebookDirectoryIcon(
  srcDirPath: string,
  srcName: string,
  destDirPath: string,
  destName: string,
): Promise<void> {
  const srcIcons = await getNotebookDirectoryIcons(srcDirPath);
  const icon = srcIcons[srcName];
  if (!icon) return;
  await setNotebookDirectoryIcon(destDirPath, destName, icon);
}
