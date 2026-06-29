// --- Database Config & Helper ---
const DB_NAME = 'sport_pwa_db';
const DB_VERSION = 1;
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
      
      // Store 1: Séances (Sessions)
      if (!dbInstance.objectStoreNames.contains('sessions')) {
        dbInstance.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      }

      // Store 2: Exercices (Exercises)
      if (!dbInstance.objectStoreNames.contains('exercises')) {
        const exerciseStore = dbInstance.createObjectStore('exercises', { keyPath: 'id', autoIncrement: true });
        exerciseStore.createIndex('sessionId', 'sessionId', { unique: false });
      }

      // Store 3: Résultats (Results)
      if (!dbInstance.objectStoreNames.contains('results')) {
        const resultStore = dbInstance.createObjectStore('results', { keyPath: 'id', autoIncrement: true });
        resultStore.createIndex('exerciseId', 'exerciseId', { unique: false });
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
      // Deleting a session should also clean up its exercises and results
      const exercises = await this.getExercisesBySession(sessionId);
      for (const ex of exercises) {
        await this.deleteExercise(ex.id);
      }
      
      const transaction = db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.delete(Number(sessionId));
      request.onsuccess = () => resolve(true);
    });
  },

  // --- Exercises ---
  getExercisesBySession(sessionId) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['exercises'], 'readonly');
      const store = transaction.objectStore('exercises');
      const index = store.index('sessionId');
      const request = index.getAll(Number(sessionId));
      request.onsuccess = () => resolve(request.result || []);
    });
  },
  getExercise(id) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['exercises'], 'readonly');
      const store = transaction.objectStore('exercises');
      const request = store.get(Number(id));
      request.onsuccess = () => resolve(request.result);
    });
  },
  addExercise(exercise) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['exercises'], 'readwrite');
      const store = transaction.objectStore('exercises');
      const request = store.add({ 
        ...exercise, 
        sessionId: Number(exercise.sessionId),
        createdAt: new Date().toISOString() 
      });
      request.onsuccess = () => resolve(request.result);
    });
  },
  updateExercise(exercise) {
    return new Promise((resolve) => {
      const transaction = db.transaction(['exercises'], 'readwrite');
      const store = transaction.objectStore('exercises');
      const request = store.put({
        ...exercise,
        sessionId: Number(exercise.sessionId)
      });
      request.onsuccess = () => resolve(request.result);
    });
  },
  deleteExercise(id) {
    return new Promise(async (resolve) => {
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
      <h3 class="card-title">${escapeHTML(session.title)}</h3>
      <p class="card-desc">${escapeHTML(session.description || 'Aucune description.')}</p>
      <div class="card-meta">
        <span>${exercises.length} exercice${exercises.length > 1 ? 's' : ''}</span>
        <span>Créé le ${formatDate(session.createdAt).split(' à ')[0]}</span>
      </div>
    `;
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
  document.getElementById('session-detail-title').textContent = session.title;
  document.getElementById('session-detail-desc').textContent = session.description || '';
  
  document.getElementById('btn-edit-session').onclick = () => {
    window.location.hash = `#/session/${sessionId}/edit`;
  };
  
  document.getElementById('btn-add-exercise').onclick = () => {
    window.location.hash = `#/session/${sessionId}/exercise/new/edit`;
  };

  const container = document.getElementById('exercises-container');
  container.innerHTML = '<div class="empty-state">Chargement des exercices...</div>';

  const exercises = await dbActions.getExercisesBySession(sessionId);

  if (exercises.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💪</div>
        <h3>Aucun exercice dans cette séance</h3>
        <p>Ajoutez des exercices pour commencer à suivre votre entraînement !</p>
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

    let imgHTML = '';
    if (ex.photo) {
      imgHTML = `<img src="${ex.photo}" class="exercise-img" alt="${escapeHTML(ex.title)}" loading="lazy">`;
    }

    card.innerHTML = `
      ${imgHTML}
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
  const sessionSelect = document.getElementById('exercise-session-select');
  const fileInput = document.getElementById('exercise-photo-file');
  const photoPreview = document.getElementById('exercise-photo-preview');
  const photoContainer = document.getElementById('exercise-photo-container');
  const deleteBtn = document.getElementById('btn-delete-exercise-form');
  const formTitle = document.getElementById('exercise-form-heading');

  // Clear inputs and previews
  titleInput.value = '';
  descInput.value = '';
  repsInput.value = '';
  fileInput.value = '';
  photoPreview.src = '';
  photoPreview.classList.remove('active');
  photoContainer.classList.remove('has-image');
  
  let currentPhotoBase64 = '';

  // Setup Back Link
  document.getElementById('exercise-back-link').onclick = () => {
    window.location.hash = sessionId === 'new' ? '#/' : `#/session/${sessionId}`;
  };

  // Populate workout sessions dropdown
  const allSessions = await dbActions.getAllSessions();
  sessionSelect.innerHTML = allSessions.map(s => `
    <option value="${s.id}" ${s.id === Number(sessionId) ? 'selected' : ''}>${escapeHTML(s.title)}</option>
  `).join('');

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

  if (exerciseId === 'new') {
    formTitle.textContent = "Nouvel Exercice";
    deleteBtn.style.display = 'none';

    document.getElementById('exercise-edit-form').onsubmit = async (e) => {
      e.preventDefault();
      const title = titleInput.value.trim();
      const desc = descInput.value.trim();
      const expectedReps = repsInput.value.trim();
      const targetSessionId = Number(sessionSelect.value);

      if (!title || !targetSessionId) return;

      await dbActions.addExercise({
        title,
        description: desc,
        expectedReps,
        sessionId: targetSessionId,
        photo: currentPhotoBase64
      });

      showToast("Exercice créé !");
      window.location.hash = `#/session/${targetSessionId}`;
    };
  } else {
    formTitle.textContent = "Modifier l'Exercice";
    deleteBtn.style.display = 'block';

    const exercise = await dbActions.getExercise(exerciseId);
    if (!exercise) {
      showToast("Exercice introuvable");
      window.location.hash = `#/session/${sessionId}`;
      return;
    }

    titleInput.value = exercise.title;
    descInput.value = exercise.description || '';
    repsInput.value = exercise.expectedReps || '';
    sessionSelect.value = exercise.sessionId;
    
    if (exercise.photo) {
      currentPhotoBase64 = exercise.photo;
      photoPreview.src = exercise.photo;
      photoPreview.classList.add('active');
      photoContainer.classList.add('has-image');
    }

    // Handle exercise deletion
    deleteBtn.onclick = async () => {
      if (confirm("Voulez-vous vraiment supprimer cet exercice et tout son historique de résultats ?\nCette action est irréversible.")) {
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
      const targetSessionId = Number(sessionSelect.value);

      if (!title || !targetSessionId) return;

      await dbActions.updateExercise({
        ...exercise,
        title,
        description: desc,
        expectedReps,
        sessionId: targetSessionId,
        photo: currentPhotoBase64
      });

      showToast("Exercice mis à jour !");
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

    // Strip out base64 photos to keep backup light and clean
    const exercisesWithoutPhotos = exercises.map(ex => {
      const { photo, ...rest } = ex;
      return rest;
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

// --- Agile Timer Logic ---
let timerInterval = null;
let timerSeconds = 80;

function initTimer() {
  const timerBtn = document.getElementById('timer-btn');
  if (!timerBtn) return;

  timerBtn.addEventListener('click', () => {
    // Vibration on button click (haptic feedback)
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }

    if (timerInterval) {
      // If already running: reset to 80 and keep running
      timerSeconds = 80;
      timerBtn.textContent = '80s';
      
      // Visual flash animation on reset
      timerBtn.style.animation = 'none';
      timerBtn.offsetHeight; /* trigger reflow */
      timerBtn.style.animation = 'pulse-timer 2s infinite';
    } else {
      // Start the timer
      startTimer();
    }
  });
}

function startTimer() {
  const timerBtn = document.getElementById('timer-btn');
  timerSeconds = 80;
  timerBtn.textContent = '80s';
  timerBtn.classList.add('running');

  timerInterval = setInterval(() => {
    timerSeconds--;
    timerBtn.textContent = `${timerSeconds}s`;

    if (timerSeconds <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      timerBtn.classList.remove('running');
      timerBtn.textContent = '80s';
      
      // Vibrate 3 times: [vibrate 300ms, pause 200ms, vibrate 300ms, pause 200ms, vibrate 300ms]
      if ('vibrate' in navigator) {
        navigator.vibrate([300, 200, 300, 200, 300]);
      }
    }
  }, 1000);
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

  // Initialize Export and Timer
  initTimer();
  const exportBtn = document.getElementById('btn-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if ('vibrate' in navigator) {
        navigator.vibrate(50);
      }
      exportDatabase();
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
