import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut 
} from 'firebase/auth';

let firebaseApp = null;
let firebaseAuth = null;
let cachedAccessToken = null;
let cachedUser = null;
let isSigningIn = false;

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.metadata'
];

export async function initFirebase(config) {
  if (!firebaseApp && config && config.apiKey) {
    firebaseApp = initializeApp(config);
    firebaseAuth = getAuth(firebaseApp);
  }
  return { app: firebaseApp, auth: firebaseAuth };
}

export function getCachedToken() {
  return cachedAccessToken;
}

export function setCachedToken(token) {
  cachedAccessToken = token;
}

export function getCachedUser() {
  return cachedUser;
}

export async function loginWithGoogle() {
  if (!firebaseAuth) {
    throw new Error('Firebase Auth not initialized. Please ensure config is loaded.');
  }
  try {
    isSigningIn = true;
    const provider = new GoogleAuthProvider();
    SCOPES.forEach(s => provider.addScope(s));
    provider.setCustomParameters({ prompt: 'select_account' });

    const result = await signInWithPopup(firebaseAuth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken || null;
    cachedUser = result.user;

    return {
      user: result.user,
      accessToken: cachedAccessToken
    };
  } finally {
    isSigningIn = false;
  }
}

export async function logoutGoogle() {
  if (firebaseAuth) {
    await signOut(firebaseAuth);
  }
  cachedAccessToken = null;
  cachedUser = null;
}

// Google Drive API helper methods
export async function listDriveFiles(token) {
  const t = token || cachedAccessToken;
  if (!t) throw new Error('Not authenticated with Google Drive. Please connect your Google account.');
  
  const q = encodeURIComponent("mimeType='application/json' and (name contains 'THDC' or name contains 'DSM') and trashed=false");
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,size,modifiedTime,webViewLink)&orderBy=modifiedTime desc`;
  
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${t}` }
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Google Drive API error (${res.status})`);
  }
  const data = await res.json();
  return data.files || [];
}

export async function getDriveFileContent(fileId, token) {
  const t = token || cachedAccessToken;
  if (!t) throw new Error('Not authenticated with Google Drive.');
  
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${t}` }
  });
  if (!res.ok) {
    throw new Error(`Failed to download file from Google Drive (${res.status})`);
  }
  return await res.json();
}

export async function saveFileToDrive(fileName, payloadObj, token, options = {}) {
  const t = token || cachedAccessToken;
  if (!t) throw new Error('Not authenticated with Google Drive. Please connect your Google account.');
  
  const jsonString = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj, null, 2);
  
  // Check if file already exists in user Drive
  const searchQ = encodeURIComponent(`name='${fileName}' and trashed=false`);
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${searchQ}&fields=files(id,name,modifiedTime,webViewLink)`, {
    headers: { 'Authorization': `Bearer ${t}` }
  });
  
  let existingFile = null;
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      existingFile = searchData.files[0];
    }
  }

  // If file exists, update it via PATCH upload
  if (existingFile) {
    if (options.confirmOverwrite && typeof options.confirmOverwrite === 'function') {
      const allowed = await options.confirmOverwrite(existingFile);
      if (!allowed) {
        return { cancelled: true };
      }
    }

    const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=media`;
    const updateRes = await fetch(uploadUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${t}`,
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body: jsonString
    });

    if (!updateRes.ok) {
      const err = await updateRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `Failed to update file on Google Drive (${updateRes.status})`);
    }

    const updatedData = await updateRes.json();
    return {
      success: true,
      isNew: false,
      id: updatedData.id || existingFile.id,
      name: fileName,
      webViewLink: existingFile.webViewLink || `https://drive.google.com/file/d/${existingFile.id}/view`,
      modifiedTime: new Date().toISOString()
    };
  }

  // Otherwise, create a new file via multipart upload
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    description: 'THDCIL DSM Reconciliation & Accounting Engine Workspace Data'
  };

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    jsonString +
    closeDelimiter;

  const createRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${t}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: multipartRequestBody
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to create file on Google Drive (${createRes.status})`);
  }

  const createdData = await createRes.json();
  return {
    success: true,
    isNew: true,
    id: createdData.id,
    name: fileName,
    webViewLink: createdData.webViewLink || `https://drive.google.com/file/d/${createdData.id}/view`,
    modifiedTime: new Date().toISOString()
  };
}

export async function deleteDriveFile(fileId, token) {
  const t = token || cachedAccessToken;
  if (!t) throw new Error('Not authenticated with Google Drive.');

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${t}` }
  });
  if (!res.ok) {
    throw new Error(`Failed to delete file from Google Drive (${res.status})`);
  }
  return true;
}

// Global exposure
if (typeof window !== 'undefined') {
  window.THDC_FIREBASE = {
    initializeApp,
    getAuth,
    signInWithPopup,
    GoogleAuthProvider,
    onAuthStateChanged,
    signOut,
    initFirebase,
    loginWithGoogle,
    logoutGoogle,
    getCachedToken,
    setCachedToken,
    getCachedUser,
    SCOPES
  };

  window.THDC_GDRIVE = {
    listDriveFiles,
    getDriveFileContent,
    saveFileToDrive,
    deleteDriveFile,
    getCachedToken,
    loginWithGoogle,
    logoutGoogle
  };
}
