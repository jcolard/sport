// --- Database Config & Helper ---
const DB_NAME = 'sport_pwa_db';
const DB_VERSION = 3;
let db = null;

// Initialize IndexedDB
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (e) => {
      console.error("IndexedDB Open Error:", e);
      reject(e);
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (e) => {
      const dbInstance = e.target.result;
      const oldVersion = e.oldVersion;
      
      // Store 1: Séances (Sessions)
      if (!dbInstance.objectStoreNames.contains('sessions')) {
        dbInstance.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      }

      // Store 2: Exercices (Exercises)
      let exerciseStore;
      if (!dbInstance.objectStoreNames.contains('exercises')) {
        exerciseStore = dbInstance.createObjectStore('exercises', { keyPath: 'id', autoIncrement: true });
      } else {
        exerciseStore = e.target.transaction.objectStore('exercises');
      }

      // MultiEntry index on sessionIds
      if (!exerciseStore.indexNames.contains('sessionIds')) {
        exerciseStore.createIndex('sessionIds', 'sessionIds', { multiEntry: true, unique: false });
      }

      // Store 3: Résultats (Results)
      if (!dbInstance.objectStoreNames.contains('results')) {
        const resultStore = dbInstance.createObjectStore('results', { keyPath: 'id', autoIncrement: true });
        resultStore.createIndex('exerciseId', 'exerciseId', { unique: false });
      }

      // Store 4: Vidéos d'exercices (Exercise Videos)
      if (!dbInstance.objectStoreNames.contains('exercise_videos')) {
        dbInstance.createObjectStore('exercise_videos', { keyPath: 'exerciseId' });
      }

      // Migration: Convert legacy sessionId to sessionIds array
      if (oldVersion < 2 && exerciseStore) {
        const cursorReq = exerciseStore.openCursor();
        cursorReq.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (cursor) {
            const ex = cursor.value;
            if (!Array.isArray(ex.sessionIds)) {
              ex.sessionIds = ex.sessionId != null ? [Number(ex.sessionId)] : [];
              cursor.update(ex);
            }
            cursor.continue();
          }
        };
      }
    };
  });
}

// Database Actions Wrapper
const dbActions = {
  // --- Sessions ---
  getAllSessions() {
    return new Promise((resolve) => {
      const transaction = db.transaction(['sessions'], 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
    });
  },
  getSession(id) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['sessions'], 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.get(Number(id));
      request.onsuccess = () => resolve(request.result);
    });
  },
  addSession(session) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.add({ ...session, createdAt: new Date().toISOString() });
      request.onsuccess = () => resolve(request.result);
    });
  },
  updateSession(session) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.put(session);
      request.onsuccess = () => resolve(request.result);
    });
  },
  deleteSession(sessionId) {
    return new Promise(async (resolve) => {
      const targetSessionId = Number(sessionId);
      // Clean up session reference from exercises without deleting exercises shared with other sessions
      const exercises = await this.getExercisesBySession(targetSessionId);
      for (const ex of exercises) {
        const currentIds = Array.isArray(ex.sessionIds) ? ex.sessionIds : (ex.sessionId != null ? [Number(ex.sessionId)] : []);
        const remaining = currentIds.filter(id => id !== targetSessionId);
        if (remaining.length === 0) {
          await this.deleteExercise(ex.id);
        } else {
          await this.updateExercise({
            ...ex,
            sessionIds: remaining
          });
        }
      }
      
      const transaction = db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.delete(targetSessionId);
      request.onsuccess = () => resolve(true);
    });
  },

  // --- Exercises ---
  getExercisesBySession(sessionId) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['exercises'], 'readonly');
      const store = transaction.objectStore('exercises');
      const idNum = Number(sessionId);

      if (store.indexNames.contains('sessionIds')) {
        try {
          const index = store.index('sessionIds');
          const request = index.getAll(idNum);
          request.onsuccess = () => {
            const list = request.result || [];
            if (list.length > 0) {
              resolve(list);
            } else {
              this.fallbackFilterExercises(store, idNum, resolve);
            }
          };
          request.onerror = () => this.fallbackFilterExercises(store, idNum, resolve);
          return;
        } catch (err) {}
      }
      this.fallbackFilterExercises(store, idNum, resolve);
    });
  },

  fallbackFilterExercises(store, idNum, resolve) {
    const request = store.getAll();
    request.onsuccess = () => {
      const all = request.result || [];
      const filtered = all.filter(ex => {
        if (Array.isArray(ex.sessionIds)) {
          return ex.sessionIds.includes(idNum);
        }
        return Number(ex.sessionId) === idNum;
      });
      resolve(filtered);
    };
    request.onerror = () => resolve([]);
  },

  getExercise(id) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['exercises'], 'readonly');
      const store = transaction.objectStore('exercises');
      const request = store.get(Number(id));
      request.onsuccess = () => {
        const ex = request.result;
        if (ex && !Array.isArray(ex.sessionIds) && ex.sessionId != null) {
          ex.sessionIds = [Number(ex.sessionId)];
        }
        resolve(ex);
      };
    });
  },

  addExercise(exercise) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['exercises'], 'readwrite');
      const store = transaction.objectStore('exercises');
      const sessionIds = (exercise.sessionIds || []).map(Number);
      const request = store.add({ 
        ...exercise, 
        sessionIds,
        sessionId: sessionIds[0] || null,
        createdAt: new Date().toISOString() 
      });
      request.onsuccess = () => resolve(request.result);
    });
  },

  updateExercise(exercise) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['exercises'], 'readwrite');
      const store = transaction.objectStore('exercises');
      const sessionIds = (exercise.sessionIds || []).map(Number);
      const request = store.put({
        ...exercise,
        sessionIds,
        sessionId: sessionIds[0] || null
      });
      request.onsuccess = () => resolve(request.result);
    });
  },

  removeExerciseFromSession(exerciseId, sessionId) {
    return new Promise(async (resolve) => {
      const exercise = await this.getExercise(exerciseId);
      if (!exercise) return resolve(false);

      const targetSessionId = Number(sessionId);
      const currentIds = Array.isArray(exercise.sessionIds) ? exercise.sessionIds : (exercise.sessionId != null ? [Number(exercise.sessionId)] : []);
      const remaining = currentIds.filter(id => id !== targetSessionId);

      if (remaining.length === 0) {
        await this.deleteExercise(exerciseId);
      } else {
        await this.updateExercise({
          ...exercise,
          sessionIds: remaining
        });
      }
      resolve(true);
    });
  },

  getExercisesNotInSession(sessionId) {
    return new Promise(async (resolve) => {
      const targetSessionId = Number(sessionId);
      const allExercises = await this.getAllExercises();
      const notInSession = allExercises.filter(ex => {
        const ids = Array.isArray(ex.sessionIds) ? ex.sessionIds : (ex.sessionId != null ? [Number(ex.sessionId)] : []);
        return !ids.includes(targetSessionId);
      });
      resolve(notInSession);
    });
  },

  addExercisesToSession(exerciseIds, sessionId) {
    return new Promise(async (resolve) => {
      const targetSessionId = Number(sessionId);
      for (const exId of exerciseIds) {
        const exercise = await this.getExercise(exId);
        if (exercise) {
          const currentIds = Array.isArray(exercise.sessionIds) ? exercise.sessionIds : (exercise.sessionId != null ? [Number(exercise.sessionId)] : []);
          if (!currentIds.includes(targetSessionId)) {
            currentIds.push(targetSessionId);
            await this.updateExercise({
              ...exercise,
              sessionIds: currentIds
            });
          }
        }
      }
      resolve(true);
    });
  },

  deleteExercise(id) {
    return new Promise(async (resolve) => {
      // Also delete video if present
      await this.deleteExerciseVideo(id);

      // Deleting an exercise should also clean up its results
      const transactionResults = db.transaction(['results'], 'readwrite');
      const resultsStore = transactionResults.objectStore('results');
      const index = resultsStore.index('exerciseId');
      const requestResults = index.openCursor(Number(id));
      
      requestResults.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transactionResults.oncomplete = () => {
        const transactionEx = db.transaction(['exercises'], 'readwrite');
        const storeEx = transactionEx.objectStore('exercises');
        const requestEx = storeEx.delete(Number(id));
        requestEx.onsuccess = () => resolve(true);
      };
    });
  },

  // --- Exercise Videos ---
  saveExerciseVideo(exerciseId, blob, meta = {}) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['exercise_videos'], 'readwrite');
      const store = transaction.objectStore('exercise_videos');
      const request = store.put({
        exerciseId: Number(exerciseId),
        blob,
        fileName: meta.fileName || 'video.mp4',
        fileSize: meta.fileSize || blob.size,
        fileType: blob.type || 'video/mp4',
        updatedAt: new Date().toISOString()
      });
      request.onsuccess = () => resolve(true);
      request.onerror = (e) => {
        console.error("Failed to save video:", e);
        resolve(false);
      };
    });
  },
  getExerciseVideo(exerciseId) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['exercise_videos'], 'readonly');
      const store = transaction.objectStore('exercise_videos');
      const request = store.get(Number(exerciseId));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  },
  deleteExerciseVideo(exerciseId) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['exercise_videos'], 'readwrite');
      const store = transaction.objectStore('exercise_videos');
      const request = store.delete(Number(exerciseId));
      request.onsuccess = () => resolve(true);
      request.onerror = () => resolve(false);
    });
  },

  // --- Results ---
  getResultsByExercise(exerciseId) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['results'], 'readonly');
      const store = transaction.objectStore('results');
      const index = store.index('exerciseId');
      const request = index.getAll(Number(exerciseId));
      request.onsuccess = () => {
        // Sort results descending by timestamp
        const sorted = (request.result || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        resolve(sorted);
      };
    });
  },
  addResult(result) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['results'], 'readwrite');
      const store = transaction.objectStore('results');
      const request = store.add({
        ...result,
        exerciseId: Number(result.exerciseId),
        timestamp: new Date().toISOString()
      });
      request.onsuccess = () => resolve(request.result);
    });
  },
  getAllExercises() {
    return new Promise((resolve) => {
      const transaction = db.transaction(['exercises'], 'readonly');
      const store = transaction.objectStore('exercises');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
    });
  },
  getAllResults() {
    return new Promise((resolve) => {
      const transaction = db.transaction(['results'], 'readonly');
      const store = transaction.objectStore('results');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
    });
  },

  replaceAllData(backupData, localMediaMap) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['sessions', 'exercises', 'results'], 'readwrite');
      const sessionsStore = transaction.objectStore('sessions');
      const exercisesStore = transaction.objectStore('exercises');
      const resultsStore = transaction.objectStore('results');

      sessionsStore.clear();
      exercisesStore.clear();
      resultsStore.clear();

      // Insert sessions
      for (const s of (backupData.sessions || [])) {
        sessionsStore.put(s);
      }

      // Insert exercises, preserving local media where available
      for (const ex of (backupData.exercises || [])) {
        const localMedia = localMediaMap ? localMediaMap.get(ex.id) : null;
        const photo = ex.photo || (localMedia ? localMedia.photo : null);
        const hasVideo = ex.hasVideo != null ? ex.hasVideo : (localMedia ? localMedia.hasVideo : false);
        const sessionIds = Array.isArray(ex.sessionIds) ? ex.sessionIds : (ex.sessionId != null ? [Number(ex.sessionId)] : []);

        exercisesStore.put({
          ...ex,
          sessionIds,
          photo,
          hasVideo
        });
      }

      // Insert results
      for (const r of (backupData.results || [])) {
        resultsStore.put(r);
      }

      transaction.oncomplete = () => resolve(true);
      transaction.onerror = (e) => reject(e);
    });
  }
};

// --- Toast System ---
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

// --- Image Compression Utility ---
function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Export compressed as jpeg
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

// --- Date Formatter Helper ---
function formatDate(isoString) {
  const date = new Date(isoString);
  const options = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  return date.toLocaleDateString('fr-FR', options);
}

// --- File Size Formatter ---
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 Octet';
  const k = 1024;
  const sizes = ['Octets', 'Ko', 'Mo', 'Go'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// --- Dedicated Video Player Modal ---
let activeVideoUrl = null;

function setupVideoModal() {
  const modal = document.getElementById('modal-video-player');
  const closeBtn = document.getElementById('btn-close-video-modal');
  const videoElem = document.getElementById('exercise-video-element');

  function closeVideoModal() {
    if (!modal) return;
    modal.classList.remove('active');
    if (videoElem) {
      videoElem.pause();
      videoElem.src = '';
      videoElem.load();
    }
    if (activeVideoUrl) {
      URL.revokeObjectURL(activeVideoUrl);
      activeVideoUrl = null;
    }
  }

  if (closeBtn) {
    closeBtn.onclick = closeVideoModal;
  }

  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) {
        closeVideoModal();
      }
    };
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
      closeVideoModal();
    }
  });

  return { closeVideoModal };
}

async function openVideoModal(exerciseId, title) {
  const modal = document.getElementById('modal-video-player');
  const titleElem = document.getElementById('video-player-title');
  const videoElem = document.getElementById('exercise-video-element');

  if (!modal || !videoElem) return;

  showToast("Chargement de la vidéo...");
  const videoRecord = await dbActions.getExerciseVideo(exerciseId);

  if (!videoRecord || !videoRecord.blob) {
    showToast("Vidéo introuvable ou corrompue.");
    return;
  }

  if (activeVideoUrl) {
    URL.revokeObjectURL(activeVideoUrl);
    activeVideoUrl = null;
  }

  activeVideoUrl = URL.createObjectURL(videoRecord.blob);
  videoElem.src = activeVideoUrl;
  if (titleElem) {
    titleElem.textContent = title || "Démonstration";
  }

  modal.classList.add('active');
  videoElem.play().catch(() => {});
}

// --- Views Routing & Logic ---
const router = {
  async init() {
    window.addEventListener('hashchange', () => this.handleRoute());
    await this.handleRoute();
  },

  async handleRoute() {
    const hash = window.location.hash || '#/';
    
    // Hide all views first
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    // Route: #/
    if (hash === '#/') {
      this.showView('view-sessions-list');
      await renderSessionsList();
    }
    // Route: #/session/:id
    else if (hash.startsWith('#/session/') && !hash.endsWith('/edit') && !hash.includes('/exercise/')) {
      const sessionId = hash.split('/')[2];
      this.showView('view-session-detail');
      await renderSessionDetail(sessionId);
    }
    // Route: #/session/:sessionId/exercise/:id/edit
    else if (hash.startsWith('#/session/') && hash.includes('/exercise/') && hash.endsWith('/edit')) {
      const parts = hash.split('/');
      const sessionId = parts[2];
      const exerciseId = parts[4];
      this.showView('view-exercise-form');
      await setupExerciseForm(sessionId, exerciseId);
    }
    // Route: #/session/:id/edit
    else if (hash.startsWith('#/session/') && hash.endsWith('/edit') && !hash.includes('/exercise/')) {
      const sessionId = hash.split('/')[2];
      this.showView('view-session-form');
      await setupSessionForm(sessionId);
    }
    // Fallback
    else {
      window.location.hash = '#/';
    }
  },

  showView(viewId) {
    const view = document.getElementById(viewId);
    if (view) {
      view.classList.add('active');
      window.scrollTo(0, 0);
    }
  }
};

// --- RENDER FUNCTIONS ---

// 1. Render Workout Sessions List
async function renderSessionsList() {
  const container = document.getElementById('sessions-container');
  container.innerHTML = '<div class="empty-state">Chargement...</div>';
  
  const sessions = await dbActions.getAllSessions();
  
  if (sessions.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🏋️‍♂️</div>
        <h3>Aucune séance pour le moment</h3>
        <p>Commencez par ajouter votre première séance d'entraînement !</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'card-grid';

  // Gather exercise counts for each session to display on cards
  for (const session of sessions) {
    const exercises = await dbActions.getExercisesBySession(session.id);
    
    // Check if session is fully completed today
    let isSessionCompletedToday = false;
    if (exercises.length > 0) {
      let allExCompleted = true;
      for (const ex of exercises) {
        const results = await dbActions.getResultsByExercise(ex.id);
        const hasTodayResult = results.some(r => {
          const d = new Date(r.timestamp);
          const today = new Date();
          return d.getDate() === today.getDate() &&
                 d.getMonth() === today.getMonth() &&
                 d.getFullYear() === today.getFullYear();
        });
        if (!hasTodayResult) {
          allExCompleted = false;
          break;
        }
      }
      isSessionCompletedToday = allExCompleted;
    }
    
    const card = document.createElement('div');
    card.className = `card${isSessionCompletedToday ? ' completed-today' : ''}`;
    card.onclick = () => { window.location.hash = `#/session/${session.id}`; };
    
    card.innerHTML = `
      <div class="session-card-header">
        <h3 class="card-title">${escapeHTML(session.title)}</h3>
        <button type="button" class="btn-edit-session-card" title="Modifier la séance" aria-label="Modifier la séance">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
      </div>
      <p class="card-desc">${escapeHTML(session.description || 'Aucune description.')}</p>
      <div class="card-meta">
        <span>${exercises.length} exercice${exercises.length > 1 ? 's' : ''}</span>
        <span>Créé le ${formatDate(session.createdAt).split(' à ')[0]}</span>
      </div>
    `;

    const editBtn = card.querySelector('.btn-edit-session-card');
    if (editBtn) {
      editBtn.onclick = (e) => {
        e.stopPropagation();
        window.location.hash = `#/session/${session.id}/edit`;
      };
    }

    grid.appendChild(card);
  }
  container.appendChild(grid);
}

// 2. Render Workout Session Detail (Exercises)
async function renderSessionDetail(sessionId) {
  const session = await dbActions.getSession(sessionId);
  if (!session) {
    showToast("Séance introuvable");
    window.location.hash = '#/';
    return;
  }

  // Set titles and action links
  const titleElem = document.getElementById('session-detail-title');
  if (titleElem) titleElem.textContent = session.title;
  
  const addExerciseBtn = document.getElementById('btn-add-exercise');
  if (addExerciseBtn) {
    addExerciseBtn.onclick = () => {
      window.location.hash = `#/session/${sessionId}/exercise/new/edit`;
    };
  }

  const container = document.getElementById('exercises-container');
  container.innerHTML = '<div class="empty-state">Chargement des exercices...</div>';

  const exercises = await dbActions.getExercisesBySession(sessionId);
  const allSessions = await dbActions.getAllSessions();

  if (exercises.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💪</div>
        <h3>Aucun exercice dans cette séance</h3>
        <p>Ajoutez votre premier exercice à l'aide du bouton ci-dessus !</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'exercise-list';

  for (const ex of exercises) {
    // Load results history
    const results = await dbActions.getResultsByExercise(ex.id);

    // Check if any performance was logged today (local time)
    const hasTodayResult = results.some(r => {
      const d = new Date(r.timestamp);
      const today = new Date();
      return d.getDate() === today.getDate() &&
             d.getMonth() === today.getMonth() &&
             d.getFullYear() === today.getFullYear();
    });

    const card = document.createElement('div');
    card.className = `exercise-card${hasTodayResult ? ' has-today-result' : ''}`;
    card.id = `exercise-card-${ex.id}`;

    // Exercise Media (Square photo and/or video play overlay)
    let mediaHTML = '';
    if (ex.photo || ex.hasVideo) {
      let innerContent = '';
      if (ex.photo) {
        innerContent = `<img src="${ex.photo}" class="exercise-img" alt="${escapeHTML(ex.title)}" loading="lazy">`;
      } else {
        innerContent = `
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.7;">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          <span style="font-size: 0.85rem; font-weight: 500;">Démonstration vidéo</span>
        `;
      }

      let playOverlayHTML = '';
      if (ex.hasVideo) {
        playOverlayHTML = `
          <button type="button" class="video-play-overlay" title="Lire la vidéo de démonstration" aria-label="Lire la vidéo">
            <svg width="26" height="26" viewBox="0 0 24 24">
              <polygon points="6 4 20 12 6 20 6 4"></polygon>
            </svg>
          </button>
        `;
      }

      const wrapperClass = ex.photo ? 'exercise-media-wrapper' : 'exercise-media-wrapper video-only-placeholder';
      mediaHTML = `
        <div class="${wrapperClass}" ${ex.hasVideo ? `data-video-id="${ex.id}" data-video-title="${escapeHTML(ex.title)}"` : ''}>
          ${innerContent}
          ${playOverlayHTML}
        </div>
      `;
    }

    const exSessionIds = Array.isArray(ex.sessionIds) ? ex.sessionIds : (ex.sessionId != null ? [Number(ex.sessionId)] : []);
    let sessionBadgesHTML = '';
    if (exSessionIds.length > 1) {
      const chips = exSessionIds.map(sId => {
        const sObj = allSessions.find(s => s.id === sId);
        const name = sObj ? sObj.title : `Séance #${sId}`;
        const isCurrent = sId === Number(sessionId);
        return `<span class="session-chip${isCurrent ? ' current' : ''}">${escapeHTML(name)}</span>`;
      }).join('');
      sessionBadgesHTML = `<div class="exercise-sessions-badges">${chips}</div>`;
    }

    card.innerHTML = `
      ${mediaHTML}
      <div class="exercise-body">
        <div class="exercise-header">
          <div class="exercise-title">${escapeHTML(ex.title)}</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="exercise-reps">${escapeHTML(ex.expectedReps || '0')} reps attendues</span>
            <button class="btn btn-secondary btn-sm btn-icon-only edit-exercise-trigger" title="Modifier l'exercice">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
          </div>
        </div>
        ${sessionBadgesHTML}
        ${ex.description ? `<p class="exercise-desc">${escapeHTML(ex.description)}</p>` : ''}
        
        <div class="quick-input-section">
          <div class="quick-input-title">Enregistrer une performance</div>
          <form class="quick-input-form" id="result-form-${ex.id}">
            <input type="text" class="quick-input" placeholder="ex: 50kg - 10/10/8" required autocomplete="off">
            <button type="submit" class="btn btn-primary btn-sm">Valider</button>
          </form>
        </div>

        <div class="results-history" id="results-history-${ex.id}">
          <!-- Results history list -->
        </div>
      </div>
    `;

    // Video play trigger on media wrapper
    if (ex.hasVideo) {
      const mediaWrapper = card.querySelector('.exercise-media-wrapper');
      if (mediaWrapper) {
        mediaWrapper.onclick = (e) => {
          e.stopPropagation();
          openVideoModal(ex.id, ex.title);
        };
      }
    }

    // Edit button click event
    card.querySelector('.edit-exercise-trigger').onclick = () => {
      window.location.hash = `#/session/${sessionId}/exercise/${ex.id}/edit`;
    };

    // Render results history list items
    const historyContainer = card.querySelector(`#results-history-${ex.id}`);
    renderResultsHistoryList(results, historyContainer);

    // Form submit listener for recording new result
    const form = card.querySelector(`#result-form-${ex.id}`);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const textVal = input.value.trim();
      if (!textVal) return;

      const newResult = {
        exerciseId: ex.id,
        text: textVal
      };

      await dbActions.addResult(newResult);
      input.value = '';
      if ('vibrate' in navigator) {
        navigator.vibrate(80);
      }
      showToast("Performance enregistrée !");
      
      // Re-render only the history container for this card
      const updatedResults = await dbActions.getResultsByExercise(ex.id);
      renderResultsHistoryList(updatedResults, historyContainer);

      // Highlight the card immediately
      card.classList.add('has-today-result');
    };

    list.appendChild(card);
  }
  container.appendChild(list);
}

// 3. Render Results History inside Exercise Card
function renderResultsHistoryList(results, container) {
  if (results.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; font-style: italic;">Aucun historique récent.</div>';
    return;
  }
  container.innerHTML = results.map(r => `
    <div class="result-item">
      <span class="result-text">${escapeHTML(r.text)}</span>
      <span class="result-date">${formatDate(r.timestamp)}</span>
    </div>
  `).join('');
}

// 4. Setup Session Edit / Add Form
async function setupSessionForm(sessionId) {
  const titleInput = document.getElementById('session-title');
  const descInput = document.getElementById('session-desc');
  const deleteBtn = document.getElementById('btn-delete-session-form');
  const formTitle = document.getElementById('session-form-heading');

  titleInput.value = '';
  descInput.value = '';

  if (sessionId === 'new') {
    formTitle.textContent = "Nouvelle Séance";
    deleteBtn.style.display = 'none';
    
    document.getElementById('session-edit-form').onsubmit = async (e) => {
      e.preventDefault();
      const title = titleInput.value.trim();
      const desc = descInput.value.trim();
      if (!title) return;

      const newId = await dbActions.addSession({ title, description: desc });
      showToast("Séance créée !");
      window.location.hash = `#/session/${newId}`;
    };
  } else {
    formTitle.textContent = "Modifier la Séance";
    deleteBtn.style.display = 'block';

    const session = await dbActions.getSession(sessionId);
    if (!session) {
      showToast("Séance introuvable");
      window.location.hash = '#/';
      return;
    }

    titleInput.value = session.title;
    descInput.value = session.description || '';

    // Handle session deletion
    deleteBtn.onclick = async () => {
      if (confirm("Voulez-vous vraiment supprimer cette séance ainsi que tous ses exercices et résultats ?\nCette action est irréversible.")) {
        await dbActions.deleteSession(sessionId);
        showToast("Séance supprimée !");
        window.location.hash = '#/';
      }
    };

    document.getElementById('session-edit-form').onsubmit = async (e) => {
      e.preventDefault();
      const title = titleInput.value.trim();
      const desc = descInput.value.trim();
      if (!title) return;

      await dbActions.updateSession({ ...session, title, description: desc });
      showToast("Séance mise à jour !");
      window.location.hash = `#/session/${sessionId}`;
    };
  }
}

// 5. Setup Exercise Edit / Add Form
async function setupExerciseForm(sessionId, exerciseId) {
  const titleInput = document.getElementById('exercise-title');
  const descInput = document.getElementById('exercise-desc');
  const repsInput = document.getElementById('exercise-reps-input');
  const sessionsSelector = document.getElementById('exercise-sessions-selector');
  const sessionsError = document.getElementById('exercise-sessions-error');
  const fileInput = document.getElementById('exercise-photo-file');
  const photoPreview = document.getElementById('exercise-photo-preview');
  const photoContainer = document.getElementById('exercise-photo-container');
  const removeSessionBtn = document.getElementById('btn-remove-exercise-session');
  const deleteBtn = document.getElementById('btn-delete-exercise-form');
  const formTitle = document.getElementById('exercise-form-heading');

  // Video Form Controls
  const videoFileInput = document.getElementById('exercise-video-file');
  const videoContainer = document.getElementById('exercise-video-container');
  const videoPlaceholder = document.getElementById('video-upload-placeholder');
  const videoInfo = document.getElementById('video-upload-info');
  const videoFileName = document.getElementById('video-file-name');
  const videoFileSize = document.getElementById('video-file-size');
  const removeVideoBtn = document.getElementById('btn-remove-video');
  const videoWarning = document.getElementById('video-size-warning');

  // Existing Exercise Linker Controls
  const sectionPickExisting = document.getElementById('section-pick-existing-exercise');
  const selectExisting = document.getElementById('select-existing-exercise');
  const btnLinkSelected = document.getElementById('btn-link-selected-exercise');
  const dividerNew = document.getElementById('divider-new-exercise');

  // Clear inputs and previews
  titleInput.value = '';
  descInput.value = '';
  repsInput.value = '';
  fileInput.value = '';
  photoPreview.src = '';
  photoPreview.classList.remove('active');
  photoContainer.classList.remove('has-image');
  sessionsError.style.display = 'none';
  removeSessionBtn.style.display = 'none';
  deleteBtn.style.display = 'none';
  
  // Clear video state
  videoFileInput.value = '';
  videoPlaceholder.style.display = 'flex';
  videoInfo.style.display = 'none';
  videoWarning.style.display = 'none';
  let selectedVideoFile = null;
  let videoAction = 'keep'; // 'keep', 'replace', 'remove'

  let currentPhotoBase64 = '';

  // Setup Back Link
  document.getElementById('exercise-back-link').onclick = () => {
    window.location.hash = sessionId === 'new' ? '#/' : `#/session/${sessionId}`;
  };

  // Populate workout sessions checkboxes
  const allSessions = await dbActions.getAllSessions();
  sessionsSelector.innerHTML = allSessions.map(s => `
    <label class="session-checkbox-label" id="session-label-${s.id}">
      <input type="checkbox" name="exercise-sessions" value="${s.id}">
      <span class="session-checkbox-title">${escapeHTML(s.title)}</span>
    </label>
  `).join('');

  // Add change listeners to toggle checked styling
  sessionsSelector.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const label = cb.closest('.session-checkbox-label');
      if (label) {
        label.classList.toggle('checked', cb.checked);
      }
      if (sessionsSelector.querySelectorAll('input[type="checkbox"]:checked').length > 0) {
        sessionsError.style.display = 'none';
      }
    });
  });

  const getSelectedSessionIds = () => {
    const checked = sessionsSelector.querySelectorAll('input[name="exercise-sessions"]:checked');
    return Array.from(checked).map(cb => Number(cb.value));
  };

  const setSelectedSessionIds = (ids) => {
    const idSet = new Set((ids || []).map(Number));
    sessionsSelector.querySelectorAll('input[name="exercise-sessions"]').forEach(cb => {
      const isChecked = idSet.has(Number(cb.value));
      cb.checked = isChecked;
      const label = cb.closest('.session-checkbox-label');
      if (label) {
        label.classList.toggle('checked', isChecked);
      }
    });
  };

  // Setup Image Picker Trigger
  photoContainer.onclick = () => {
    fileInput.click();
  };

  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        showToast("Traitement de l'image...");
        currentPhotoBase64 = await compressImage(file, 800, 800, 0.7);
        photoPreview.src = currentPhotoBase64;
        photoPreview.classList.add('active');
        photoContainer.classList.add('has-image');
      } catch (err) {
        console.error(err);
        showToast("Erreur lors de l'importation de l'image");
      }
    }
  };

  // Setup Video Picker Trigger
  videoContainer.onclick = (e) => {
    if (e.target.closest('#btn-remove-video')) return;
    videoFileInput.click();
  };

  videoFileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      selectedVideoFile = file;
      videoAction = 'replace';
      videoFileName.textContent = file.name;
      videoFileSize.textContent = formatBytes(file.size);
      videoPlaceholder.style.display = 'none';
      videoInfo.style.display = 'flex';

      if (file.size > 50 * 1024 * 1024) {
        videoWarning.style.display = 'block';
      } else {
        videoWarning.style.display = 'none';
      }
    }
  };

  removeVideoBtn.onclick = (e) => {
    e.stopPropagation();
    selectedVideoFile = null;
    videoAction = 'remove';
    videoFileInput.value = '';
    videoPlaceholder.style.display = 'flex';
    videoInfo.style.display = 'none';
    videoWarning.style.display = 'none';
  };

  if (exerciseId === 'new') {
    formTitle.textContent = "Nouvel Exercice";
    deleteBtn.style.display = 'none';
    removeSessionBtn.style.display = 'none';

    // Populate existing exercises picker if there are exercises not yet in this session
    if (sessionId !== 'new') {
      const unlinkedExercises = await dbActions.getExercisesNotInSession(sessionId);
      if (unlinkedExercises.length > 0) {
        if (sectionPickExisting) sectionPickExisting.style.display = 'block';
        if (dividerNew) dividerNew.style.display = 'flex';
        if (selectExisting) {
          selectExisting.innerHTML = '<option value="">-- Choisir un exercice existant (' + unlinkedExercises.length + ') --</option>' +
            unlinkedExercises.map(ex => `<option value="${ex.id}">${escapeHTML(ex.title)}${ex.expectedReps ? ' (' + escapeHTML(ex.expectedReps) + ')' : ''}</option>`).join('');
          selectExisting.value = '';
        }
        if (btnLinkSelected) {
          btnLinkSelected.disabled = true;
          selectExisting.onchange = () => {
            btnLinkSelected.disabled = !selectExisting.value;
          };
          btnLinkSelected.onclick = async () => {
            const chosenId = Number(selectExisting.value);
            if (!chosenId) return;
            await dbActions.addExercisesToSession([chosenId], sessionId);
            showToast("Exercice ajouté à la séance !");
            window.location.hash = `#/session/${sessionId}`;
          };
        }
      } else {
        if (sectionPickExisting) sectionPickExisting.style.display = 'none';
        if (dividerNew) dividerNew.style.display = 'none';
      }
    } else {
      if (sectionPickExisting) sectionPickExisting.style.display = 'none';
      if (dividerNew) dividerNew.style.display = 'none';
    }

    // Preselect current session if valid
    if (sessionId !== 'new') {
      setSelectedSessionIds([Number(sessionId)]);
    }

    document.getElementById('exercise-edit-form').onsubmit = async (e) => {
      e.preventDefault();
      const title = titleInput.value.trim();
      const desc = descInput.value.trim();
      const expectedReps = repsInput.value.trim();
      const selectedSessionIds = getSelectedSessionIds();

      if (!title) return;
      if (selectedSessionIds.length === 0) {
        sessionsError.style.display = 'block';
        sessionsError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const hasVideo = (videoAction === 'replace' && selectedVideoFile !== null);

      const newId = await dbActions.addExercise({
        title,
        description: desc,
        expectedReps,
        sessionIds: selectedSessionIds,
        photo: currentPhotoBase64,
        hasVideo
      });

      if (hasVideo && selectedVideoFile) {
        showToast("Enregistrement de la vidéo...");
        await dbActions.saveExerciseVideo(newId, selectedVideoFile, {
          fileName: selectedVideoFile.name,
          fileSize: selectedVideoFile.size
        });
      }

      showToast("Exercice créé !");
      const targetSessionId = selectedSessionIds.includes(Number(sessionId)) ? sessionId : selectedSessionIds[0];
      window.location.hash = `#/session/${targetSessionId}`;
    };
  } else {
    formTitle.textContent = "Modifier l'Exercice";
    deleteBtn.style.display = 'block';
    if (sectionPickExisting) sectionPickExisting.style.display = 'none';
    if (dividerNew) dividerNew.style.display = 'none';

    const exercise = await dbActions.getExercise(exerciseId);
    if (!exercise) {
      showToast("Exercice introuvable");
      window.location.hash = `#/session/${sessionId}`;
      return;
    }

    titleInput.value = exercise.title;
    descInput.value = exercise.description || '';
    repsInput.value = exercise.expectedReps || '';
    
    const exSessionIds = Array.isArray(exercise.sessionIds) ? exercise.sessionIds : (exercise.sessionId != null ? [Number(exercise.sessionId)] : []);
    setSelectedSessionIds(exSessionIds);

    // Show "Retirer de cette séance" button if exercise belongs to > 1 session and is present in current session
    if (exSessionIds.length > 1 && sessionId !== 'new' && exSessionIds.includes(Number(sessionId))) {
      removeSessionBtn.style.display = 'block';
      removeSessionBtn.onclick = async () => {
        if (confirm("Voulez-vous retirer cet exercice de la séance actuelle ?\nIl restera présent dans vos autres séances.")) {
          await dbActions.removeExerciseFromSession(exerciseId, sessionId);
          showToast("Exercice retiré de la séance");
          window.location.hash = `#/session/${sessionId}`;
        }
      };
    } else {
      removeSessionBtn.style.display = 'none';
    }
    
    if (exercise.photo) {
      currentPhotoBase64 = exercise.photo;
      photoPreview.src = exercise.photo;
      photoPreview.classList.add('active');
      photoContainer.classList.add('has-image');
    }

    // Load existing video metadata if present
    if (exercise.hasVideo) {
      const videoRecord = await dbActions.getExerciseVideo(exerciseId);
      if (videoRecord) {
        videoFileName.textContent = videoRecord.fileName || 'Vidéo enregistrée';
        videoFileSize.textContent = formatBytes(videoRecord.fileSize || 0);
        videoPlaceholder.style.display = 'none';
        videoInfo.style.display = 'flex';
        videoAction = 'keep';
      }
    }

    // Handle exercise total deletion
    deleteBtn.onclick = async () => {
      const isMulti = exSessionIds.length > 1;
      const confirmMsg = isMulti
        ? "Cet exercice est associé à plusieurs séances.\nVoulez-vous vraiment le supprimer DÉFINITIVEMENT de TOUTES les séances ainsi que tout son historique de résultats ?\nCette action est irréversible."
        : "Voulez-vous vraiment supprimer cet exercice et tout son historique de résultats ?\nCette action est irréversible.";

      if (confirm(confirmMsg)) {
        await dbActions.deleteExercise(exerciseId);
        showToast("Exercice supprimé !");
        window.location.hash = `#/session/${sessionId}`;
      }
    };

    document.getElementById('exercise-edit-form').onsubmit = async (e) => {
      e.preventDefault();
      const title = titleInput.value.trim();
      const desc = descInput.value.trim();
      const expectedReps = repsInput.value.trim();
      const selectedSessionIds = getSelectedSessionIds();

      if (!title) return;
      if (selectedSessionIds.length === 0) {
        sessionsError.style.display = 'block';
        sessionsError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const willHaveVideo = (videoAction === 'replace' && selectedVideoFile !== null) || (videoAction === 'keep' && !!exercise.hasVideo);

      await dbActions.updateExercise({
        ...exercise,
        title,
        description: desc,
        expectedReps,
        sessionIds: selectedSessionIds,
        photo: currentPhotoBase64,
        hasVideo: willHaveVideo
      });

      if (videoAction === 'replace' && selectedVideoFile) {
        showToast("Enregistrement de la vidéo...");
        await dbActions.saveExerciseVideo(exerciseId, selectedVideoFile, {
          fileName: selectedVideoFile.name,
          fileSize: selectedVideoFile.size
        });
      } else if (videoAction === 'remove') {
        await dbActions.deleteExerciseVideo(exerciseId);
      }

      showToast("Exercice mis à jour !");
      const targetSessionId = selectedSessionIds.includes(Number(sessionId)) ? sessionId : selectedSessionIds[0];
      window.location.hash = `#/session/${targetSessionId}`;
    };
  }
}

// --- Escaping and Safety Helpers ---
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Data Backup (Export) ---
async function exportDatabase() {
  try {
    showToast("Préparation de l'export...");
    const sessions = await dbActions.getAllSessions();
    const exercises = await dbActions.getAllExercises();
    const results = await dbActions.getAllResults();

    // Strip out base64 photos to keep backup light and clean, and ensure sessionIds is exported
    const exercisesWithoutPhotos = exercises.map(ex => {
      const { photo, ...rest } = ex;
      const sessionIds = Array.isArray(ex.sessionIds) ? ex.sessionIds : (ex.sessionId != null ? [Number(ex.sessionId)] : []);
      return { ...rest, sessionIds };
    });

    const backupData = {
      sessions,
      exercises: exercisesWithoutPhotos,
      results,
      exportedAt: new Date().toISOString()
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `gymtracker_backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    showToast("Sauvegarde téléchargée !");
  } catch (err) {
    console.error(err);
    showToast("Erreur lors de l'export.");
  }
}

// --- Google Drive Backup & Restore via Apps Script ---
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzC2XuHSzD_X7Agpnql1c_fvadv_M64QBjwSkMp15n71QHTguRoBh53kiAHIDeo2UCB/exec';

async function backupToGoogleDrive() {
  const btn = document.getElementById('btn-cloud-sync');
  if (btn) btn.classList.add('loading');

  try {
    showToast("Sauvegarde sur Google Drive en cours...");

    const sessions = await dbActions.getAllSessions();
    const exercises = await dbActions.getAllExercises();
    const results = await dbActions.getAllResults();

    // Strip out base64 photos to keep backup light and clean
    const exercisesWithoutPhotos = exercises.map(ex => {
      const { photo, ...rest } = ex;
      const sessionIds = Array.isArray(ex.sessionIds) ? ex.sessionIds : (ex.sessionId != null ? [Number(ex.sessionId)] : []);
      return { ...rest, sessionIds };
    });

    const backupPayload = {
      sessions,
      exercises: exercisesWithoutPhotos,
      results,
      exportedAt: new Date().toISOString()
    };

    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        action: 'backup',
        data: backupPayload
      })
    });

    const res = await response.json();
    if (res.success) {
      showToast(`Sauvegarde Drive réussie ! (${res.fileName || ''})`);
      if ('vibrate' in navigator) navigator.vibrate([80, 40, 80]);
    } else {
      showToast(res.message || "Erreur lors de la sauvegarde sur Drive.");
    }
  } catch (err) {
    console.error("Backup error:", err);
    showToast("Échec de la connexion à Google Drive.");
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

async function restoreFromGoogleDrive() {
  const confirmMsg = 
    "Voulez-vous vraiment restaurer les données depuis Google Drive ?\n\n" +
    "⚠️ Vos séances, exercices et historiques locaux actuels seront remplacés par la dernière sauvegarde du Drive.\n" +
    "(Les photos et vidéos déjà enregistrées sur cet appareil seront conservées dans la mesure du possible).";

  if (!confirm(confirmMsg)) return;

  const btn = document.getElementById('btn-cloud-sync');
  if (btn) btn.classList.add('loading');

  try {
    showToast("Récupération de la dernière sauvegarde Drive...");

    const response = await fetch(`${APPS_SCRIPT_URL}?action=restore`);
    const res = await response.json();

    if (!res.success || !res.data) {
      showToast(res.message || "Aucune sauvegarde valide trouvée sur Drive.");
      return;
    }

    const backup = res.data;
    if (!backup.sessions || !backup.exercises) {
      showToast("Fichier de sauvegarde Drive invalide.");
      return;
    }

    showToast("Restauration locale en cours...");

    // Map existing local media (photos & video flags)
    const localExercises = await dbActions.getAllExercises();
    const localMediaMap = new Map();
    for (const le of localExercises) {
      if (le.photo || le.hasVideo) {
        localMediaMap.set(le.id, { photo: le.photo, hasVideo: le.hasVideo });
      }
    }

    await dbActions.replaceAllData(backup, localMediaMap);

    showToast(`Restauration réussie ! (${res.fileName || ''})`);
    if ('vibrate' in navigator) navigator.vibrate([150, 50, 150]);

    // Refresh route/view
    await router.handleRoute();

  } catch (err) {
    console.error("Restore error:", err);
    showToast("Échec de la récupération depuis Google Drive.");
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

// --- Agile Timer Logic ---
let timerInterval = null;
let timerEndTime = 0;
let audioCtx = null;
let silenceNode = null;

// Keep CPU awake by playing looping silence
function playSilence() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    stopSilence();
    
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
    const channel = buffer.getChannelData(0);
    channel.fill(0); // Saturated silence
    
    silenceNode = audioCtx.createBufferSource();
    silenceNode.buffer = buffer;
    silenceNode.loop = true;
    silenceNode.connect(audioCtx.destination);
    silenceNode.start();
  } catch (e) {
    console.warn("Failed to play silence keep-alive:", e);
  }
}

function stopSilence() {
  if (silenceNode) {
    try {
      silenceNode.stop();
      silenceNode.disconnect();
    } catch (e) {}
    silenceNode = null;
  }
}

function initTimer() {
  const timerBtn = document.getElementById('timer-btn');
  if (!timerBtn) return;

  timerBtn.addEventListener('click', () => {
    // Vibration on button click (haptic feedback)
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }

    // Set end time to 80s from now
    timerEndTime = Date.now() + 80 * 1000;
    timerBtn.textContent = '80s';

    // Play silent loop to prevent Chrome from pausing JavaScript when screen turns off
    playSilence();

    if (timerInterval) {
      // Visual flash animation on reset
      timerBtn.style.animation = 'none';
      timerBtn.offsetHeight; /* trigger reflow */
      timerBtn.style.animation = 'pulse-timer 2s infinite';
    } else {
      // Start the timer loop
      startTimer();
    }
  });
}

function startTimer() {
  const timerBtn = document.getElementById('timer-btn');
  timerBtn.classList.add('running');

  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    const remainingMs = timerEndTime - Date.now();
    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    
    timerBtn.textContent = `${remainingSeconds}s`;

    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      timerBtn.classList.remove('running');
      timerBtn.textContent = '80s';
      
      stopSilence();
      
      // Vibrate 3 times: [vibrate 300ms, pause 200ms, vibrate 300ms, pause 200ms, vibrate 300ms]
      if ('vibrate' in navigator) {
        navigator.vibrate([300, 200, 300, 200, 300]);
      }
    }
  }, 250); // check 4 times a second for timestamp precision
}

// --- Setup App Hooks ---
window.addEventListener('DOMContentLoaded', async () => {
  // Check online status
  const updateOnlineStatus = () => {
    const badge = document.getElementById('network-status');
    if (navigator.onLine) {
      badge.textContent = 'En ligne';
      badge.className = 'status-badge online';
    } else {
      badge.textContent = 'Hors ligne';
      badge.className = 'status-badge offline';
    }
  };
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // Initialize Timer, Video Modal, and Cloud Sync
  initTimer();
  setupVideoModal();

  // Cloud Sync Modal Setup
  const cloudSyncBtn = document.getElementById('btn-cloud-sync');
  const cloudSyncModal = document.getElementById('modal-cloud-sync');
  const closeCloudModalBtn = document.getElementById('btn-close-cloud-modal');
  const cancelCloudModalBtn = document.getElementById('btn-cancel-cloud-modal');
  const modalBackupBtn = document.getElementById('btn-cloud-modal-backup');
  const modalRestoreBtn = document.getElementById('btn-cloud-modal-restore');

  const closeCloudSyncModal = () => {
    if (cloudSyncModal) cloudSyncModal.classList.remove('active');
  };

  if (cloudSyncBtn && cloudSyncModal) {
    cloudSyncBtn.addEventListener('click', () => {
      if ('vibrate' in navigator) navigator.vibrate(40);
      cloudSyncModal.classList.add('active');
    });

    if (closeCloudModalBtn) closeCloudModalBtn.addEventListener('click', closeCloudSyncModal);
    if (cancelCloudModalBtn) cancelCloudModalBtn.addEventListener('click', closeCloudSyncModal);

    cloudSyncModal.addEventListener('click', (e) => {
      if (e.target === cloudSyncModal) {
        closeCloudSyncModal();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && cloudSyncModal.classList.contains('active')) {
        closeCloudSyncModal();
      }
    });
  }

  if (modalBackupBtn) {
    modalBackupBtn.addEventListener('click', () => {
      closeCloudSyncModal();
      if ('vibrate' in navigator) navigator.vibrate(50);
      backupToGoogleDrive();
    });
  }

  if (modalRestoreBtn) {
    modalRestoreBtn.addEventListener('click', () => {
      closeCloudSyncModal();
      if ('vibrate' in navigator) navigator.vibrate(50);
      restoreFromGoogleDrive();
    });
  }

  // Initialize DB and router
  try {
    await initDB();
    await router.init();
  } catch (err) {
    showToast("Erreur d'initialisation de la base locale.");
  }

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('Service Worker enregistré avec succès.', reg.scope))
      .catch((err) => console.warn('Échec de l\'enregistrement du Service Worker.', err));
  }
});
