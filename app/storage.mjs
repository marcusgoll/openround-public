export const DATABASE_NAME = "openround-pwa";
export const DATABASE_VERSION = 1;
export const ROUND_STORE = "rounds";

let databasePromise;

export function openDatabase(indexedDBApi = globalThis.indexedDB) {
  if (!indexedDBApi) {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDBApi.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ROUND_STORE)) {
        request.result.createObjectStore(ROUND_STORE, { keyPath: "round_id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked"));
  }).catch((error) => {
    databasePromise = undefined;
    throw error;
  });

  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export async function getRound(roundId) {
  const database = await openDatabase();
  const transaction = database.transaction(ROUND_STORE, "readonly");
  return requestResult(transaction.objectStore(ROUND_STORE).get(roundId));
}

export async function listRounds() {
  const database = await openDatabase();
  const transaction = database.transaction(ROUND_STORE, "readonly");
  const rounds = await requestResult(transaction.objectStore(ROUND_STORE).getAll());
  return rounds.sort((left, right) => right.started_at.localeCompare(left.started_at));
}

export async function putRound(round) {
  const database = await openDatabase();
  const transaction = database.transaction(ROUND_STORE, "readwrite");
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(round);
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write aborted"));
    const request = transaction.objectStore(ROUND_STORE).put(round);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB write request failed"));
  });
}
