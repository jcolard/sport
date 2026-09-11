/**
 * Google Apps Script pour GymTracker
 * Dossier cible : 1jwULoXWhFWF4yHaJFP0svfivK0z0ezWK
 */

const FOLDER_ID = '1jwULoXWhFWF4yHaJFP0svfivK0z0ezWK';

/**
 * Point d'entrée pour les requêtes GET
 * Exemple : URL_DE_L_APPLICATION?action=restore
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'restore';
    
    if (action === 'restore') {
      return getLatestBackup();
    }
    
    return jsonResponse({
      success: false,
      message: 'Action non reconnue. Utilisez ?action=restore'
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      error: err.toString()
    });
  }
}

/**
 * Point d'entrée pour les requêtes POST
 * Accepte { action: 'backup', data: { ... } } ou { action: 'restore' }
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({
        success: false,
        message: 'Aucun contenu reçu dans le corps de la requête.'
      });
    }

    const payload = JSON.parse(e.postData.contents);
    const action = payload.action || 'backup';

    if (action === 'backup') {
      return saveBackup(payload.data || payload);
    } else if (action === 'restore') {
      return getLatestBackup();
    } else {
      return jsonResponse({
        success: false,
        message: 'Action non reconnue : ' + action
      });
    }
  } catch (err) {
    return jsonResponse({
      success: false,
      error: err.toString()
    });
  }
}

/**
 * Sauvegarde les données dans un fichier JSON daté avec heure et minute
 */
function saveBackup(data) {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  
  // Formatage de la date en heure de Paris : AAAA-MM-JJ_HHhmm
  const now = new Date();
  const dateStr = Utilities.formatDate(now, "Europe/Paris", "yyyy-MM-dd_HH'h'mm'm'ss");
  const fileName = `gymtracker_backup_${dateStr}.json`;
  
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const file = folder.createFile(fileName, content, MimeType.PLAIN_TEXT);
  
  return jsonResponse({
    success: true,
    message: 'Sauvegarde enregistrée avec succès sur Google Drive.',
    fileName: fileName,
    fileId: file.getId(),
    createdAt: now.toISOString()
  });
}

/**
 * Récupère le dernier fichier JSON créé dans le dossier (le plus récent)
 */
function getLatestBackup() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const files = folder.getFiles();
  
  let latestFile = null;
  let latestDate = 0;
  
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName().toLowerCase();
    
    // On ne prend en compte que les fichiers .json
    if (name.endsWith('.json')) {
      const updated = file.getDateCreated().getTime();
      if (updated > latestDate) {
        latestDate = updated;
        latestFile = file;
      }
    }
  }
  
  if (!latestFile) {
    return jsonResponse({
      success: false,
      message: 'Aucun fichier de sauvegarde trouvé dans le dossier Google Drive.'
    });
  }
  
  const contentStr = latestFile.getBlob().getDataAsString();
  const backupData = JSON.parse(contentStr);
  
  return jsonResponse({
    success: true,
    message: 'Dernière sauvegarde récupérée avec succès.',
    fileName: latestFile.getName(),
    createdAt: latestFile.getDateCreated().toISOString(),
    data: backupData
  });
}

/**
 * Helper pour renvoyer une réponse JSON propre
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
