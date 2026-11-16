const STORE = 'state';
const RECORD = 'current';
const FIELDS = new Set(['config', 'templates', 'job', 'privatePresetImported']);

function generation() {
  return crypto.randomUUID();
}

function initial(value = {}) {
  return {
    schema: 1,
    generation: generation(),
    revision: 0,
    config: value.config ?? null,
    templates: value.templates ?? [],
    job: value.job ?? null,
    privatePresetImported: value.privatePresetImported === true,
  };
}

function transact(db, mode, operation) {
  return new Promise((resolve, reject) => {
    let result;
    let failure;
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const request = store.get(RECORD);
    request.onsuccess = () => {
      try { result = operation(store, request.result); }
      catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(failure || transaction.error || new Error('State transaction aborted.'));
    transaction.onerror = () => {};
  });
}

export async function openStateStore({ name = 'agent-continue-state-v1' } = {}) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('State database could not be opened.'));
  });
  return {
    read() {
      return transact(db, 'readonly', (_store, record) => record ?? null);
    },
    initialize(seed = {}) {
      return transact(db, 'readwrite', (store, record) => {
        if (record) return record;
        const value = initial(seed);
        store.put(value, RECORD);
        return value;
      });
    },
    clear() {
      return transact(db, 'readwrite', store => {
        const value = initial({ privatePresetImported: true });
        store.put(value, RECORD);
        return value;
      });
    },
    commit(token, patch) {
      return transact(db, 'readwrite', (store, record) => {
        if (!record) return { ok: false, reason: 'uninitialized' };
        if (token?.generation !== record.generation) return { ok: false, reason: 'generation' };
        if (token?.revision !== record.revision) return { ok: false, reason: 'revision' };
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)
            || Object.keys(patch).some(key => !FIELDS.has(key))) throw new TypeError('Invalid state patch.');
        if (!Number.isSafeInteger(record.revision) || record.revision >= Number.MAX_SAFE_INTEGER) throw new Error('State revision exhausted.');
        const value = { ...record, ...patch, revision: record.revision + 1 };
        store.put(value, RECORD);
        return { ok: true, state: value };
      });
    },
    close() { db.close(); },
  };
}
