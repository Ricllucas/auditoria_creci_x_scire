import { UploadFileItem } from '../types';

const DB_NAME = 'creci-auditoria-v1';
const DB_VERSION = 1;
const STORE_NAME = 'persistent-files';

interface StoredFileRecord {
  key: string;
  sectionId: string;
  id: string;
  name: string;
  size: number;
  type: string;
  extension: string;
  importedAt: string;
  status: 'ready' | 'invalid';
  issue?: string;
  data: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function restoreFileItem(record: StoredFileRecord): UploadFileItem {
  const mimeType = record.type || 'application/octet-stream';
  const blob = new Blob([record.data], { type: mimeType });
  const file = new File([blob], record.name, { type: mimeType });
  return {
    id: record.id,
    file,
    name: record.name,
    size: record.size,
    type: record.type,
    extension: record.extension,
    importedAt: record.importedAt,
    status: record.status,
    issue: record.issue,
  };
}

export async function loadPersistentSection(sectionId: string): Promise<UploadFileItem[]> {
  try {
    const db = await openDb();
    const records = await new Promise<StoredFileRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () =>
        resolve((req.result as StoredFileRecord[]).filter((r) => r.sectionId === sectionId));
      req.onerror = () => reject(req.error);
    });
    return records.map(restoreFileItem);
  } catch {
    return [];
  }
}

export async function savePersistentFile(sectionId: string, fileItem: UploadFileItem): Promise<void> {
  try {
    const data = await fileItem.file.arrayBuffer();
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: StoredFileRecord = {
        key: `${sectionId}/${fileItem.id}`,
        sectionId,
        id: fileItem.id,
        name: fileItem.name,
        size: fileItem.size,
        type: fileItem.type,
        extension: fileItem.extension,
        importedAt: fileItem.importedAt,
        status: fileItem.status,
        issue: fileItem.issue,
        data,
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // silent — persistence is best-effort
  }
}

export async function removePersistentFile(sectionId: string, fileId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(`${sectionId}/${fileId}`);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // silent
  }
}

export async function clearPersistentSection(sectionId: string): Promise<void> {
  try {
    const db = await openDb();
    const records = await new Promise<StoredFileRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () =>
        resolve((req.result as StoredFileRecord[]).filter((r) => r.sectionId === sectionId));
      req.onerror = () => reject(req.error);
    });
    if (records.length === 0) return;
    const db2 = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db2.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      let pending = records.length;
      for (const record of records) {
        const req = store.delete(`${sectionId}/${record.id}`);
        req.onsuccess = () => {
          if (--pending === 0) resolve();
        };
        req.onerror = () => reject(req.error);
      }
    });
  } catch {
    // silent
  }
}
