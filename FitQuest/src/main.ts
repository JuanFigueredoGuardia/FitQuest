import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  onAuthStateChanged, 
  GoogleAuthProvider, 
  signInWithRedirect, 
  getRedirectResult,
  signInAnonymously,
  linkWithRedirect,
  signOut,
  deleteUser,
  setPersistence,
  browserLocalPersistence
} from 'firebase/auth';
import { 
  getFirestore, 
  initializeFirestore,
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  limit, 
  addDoc, 
  deleteDoc, 
  serverTimestamp,
  getDocFromServer,
  writeBatch
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import './index.css';

// Elementos del DOM
const screens = {
  loading: document.getElementById('screen-loading')!,
  auth: document.getElementById('screen-auth')!,
  app: document.getElementById('screen-app')!
};

const views = {
  dashboard: document.getElementById('view-dashboard')!,
  ranking: document.getElementById('view-ranking')!,
  achievements: document.getElementById('view-achievements')!,
  profile: document.getElementById('view-profile')!
};

const elements = {
  header: document.getElementById('main-header')!,
  bottomNav: document.getElementById('bottom-nav')!,
  headerAvatar: document.getElementById('header-avatar') as HTMLImageElement,
  displayLevel: document.getElementById('display-level')!,
  displayXP: document.getElementById('display-xp')!,
  displayRangeBadge: document.getElementById('display-range-badge')!,
  progressCircle: document.getElementById('progress-circle') as unknown as SVGCircleElement,
  exerciseList: document.getElementById('exercise-list')!,
  rankingList: document.getElementById('ranking-list')!,
  achievementsList: document.getElementById('achievements-list')!,
  profileAvatar: document.getElementById('profile-avatar') as HTMLImageElement,
  inputDisplayName: document.getElementById('input-display-name') as HTMLInputElement,
  displayStreak: document.getElementById('display-streak')!,
  displayRangeText: document.getElementById('display-range-text')!,
  modalContainer: document.getElementById('modal-container')!,
  modalNewRange: document.getElementById('modal-new-range')!,
  modalNewMission: document.getElementById('modal-new-mission')!,
  modalConfirm: document.getElementById('modal-confirm')!,
  spanRangeName: document.getElementById('span-range-name')!,
  confirmTitle: document.getElementById('confirm-title')!,
  confirmMessage: document.getElementById('confirm-message')!,
  btnModalConfirmAction: document.getElementById('btn-modal-confirm-action')!,
  inputMissionTitle: document.getElementById('input-mission-title') as HTMLInputElement,
  guestWarning: document.getElementById('guest-warning')!,
  btnLinkGoogle: document.getElementById('btn-link-google')!
};

// Inicialización de Firebase con manejo de errores
let app, db, auth;
const provider = new GoogleAuthProvider();

try {
  console.log('Intentando inicializar Firebase...');
  app = initializeApp(firebaseConfig);
  
  // Forzamos Long Polling para asegurar conexión en entornos con proxies/restricciones
  db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    experimentalAutoDetectLongPolling: false // Obligamos a usar Long Polling siempre
  });
  
  auth = getAuth(app);
  
  // Configurar persistencia
  setPersistence(auth, browserLocalPersistence).catch(e => console.error('Persistencia fallida:', e));
  
  console.log('✅ Firebase inicializado correctamente.');
} catch (err: any) {
  console.error('❌ ERROR FATAL AL INICIALIZAR FIREBASE:', err);
  setTimeout(() => {
    if (screens.loading) {
      screens.loading.innerHTML = `
        <div class="text-center p-8 glass-card border-red-500">
          <span class="material-symbols-outlined text-red-500 text-5xl mb-4">error</span>
          <h2 class="text-xl font-bold text-red-500 mb-2">Error de Configuración</h2>
          <p class="text-white/60 text-sm mb-4">No se pudo conectar con Firebase. Revisa el archivo <b>firebase-applet-config.json</b>.</p>
          <button onclick="window.location.reload()" class="bg-white/10 px-4 py-2 rounded-full text-xs font-bold">Reintentar</button>
        </div>
      `;
    }
  }, 100);
}

// Estado Local
let currentUserData: any = null;
let currentView = 'dashboard';
let currentExercises: any[] = [];
let pendingAction: (() => Promise<void>) | null = null;
const unsubs: (() => void)[] = [];

function clearListeners() {
  unsubs.forEach(unsub => {
    try { unsub(); } catch (e) { console.error('Error al limpiar listener:', e); }
  });
  unsubs.length = 0;
}

// --- Lógica de Gamificación ---

function getRange(xp: number) {
  if (xp >= 20000) return 'LEYENDA FIT';
  if (xp >= 10000) return 'Platino';
  if (xp >= 5000) return 'Oro';
  if (xp >= 2000) return 'Plata';
  return 'Bronce';
}

function getLevel(xp: number) {
  return Math.floor(xp / 1000) + 1;
}

// --- Navegación ---

function switchView(viewName: string) {
  Object.keys(views).forEach(key => {
    (views as any)[key].classList.add('hidden');
  });
  (views as any)[viewName].classList.remove('hidden');
  
  // Actualizar Bottom Nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('text-orange-500');
    item.classList.add('text-white/40');
    if (item.getAttribute('data-view') === viewName) {
      item.classList.add('text-orange-500');
      item.classList.remove('text-white/40');
    }
  });
  
  currentView = viewName;
}

// --- Modales ---

function showModal(modalId: string, title?: string, message?: string, onConfirm?: () => Promise<void>) {
  elements.modalContainer.classList.remove('hidden');
  if (modalId === 'range') elements.modalNewRange.classList.remove('hidden');
  if (modalId === 'mission') elements.modalNewMission.classList.remove('hidden');
  if (modalId === 'confirm') {
    elements.modalConfirm.classList.remove('hidden');
    if (title) elements.confirmTitle.innerText = title;
    if (message) elements.confirmMessage.innerText = message;
    pendingAction = onConfirm || null;
  }
}

function hideModals() {
  elements.modalContainer.classList.add('hidden');
  elements.modalNewRange.classList.add('hidden');
  elements.modalNewMission.classList.add('hidden');
  elements.modalConfirm.classList.add('hidden');
  pendingAction = null;
}

// --- Operaciones de Datos ---

async function initializeUser(user: any) {
  try {
    const userRef = doc(db, 'users', user.uid);
    // Intentamos obtener el usuario del servidor
    const userSnap = await getDocFromServer(userRef).catch(() => getDoc(userRef));

    if (!userSnap.exists()) {
      console.log('Creando nuevo usuario en Firestore...');
      const initialXP = user.isAnonymous ? 100 : 500; // Menos XP inicial para invitados
      const initialData = {
        displayName: user.isAnonymous ? 'Atleta Invitado' : (user.displayName || 'Guerrero Fit'),
        photoURL: user.isAnonymous ? 'https://picsum.photos/seed/guest/100/100' : (user.photoURL || ''),
        xp: initialXP,
        level: Math.floor(initialXP / 1000) + 1,
        range: getRange(initialXP),
        streak: 0,
        isGuest: user.isAnonymous,
        updatedAt: serverTimestamp()
      };
      await setDoc(userRef, initialData);
      console.log('¡Perfil creado!');
    }
  } catch (err: any) {
    console.error('Error en initializeUser:', err);
    if (err.code === 'permission-denied') {
      throw new Error('PERMISOS_DENEGADOS: Tu base de datos tiene las reglas bloqueadas.');
    }
    throw err;
  }
}

function syncUserData(user: any) {
  const userRef = doc(db, 'users', user.uid);
  const unsub = onSnapshot(userRef, (doc) => {
    if (doc.exists()) {
      const newData = doc.data();
      
      // Notificación de Cambio de Rango
      if (currentUserData && newData.range !== currentUserData.range) {
        elements.spanRangeName.innerText = newData.range.toUpperCase();
        showModal('range');
      }

      currentUserData = newData;
      updateUI();
    }
  }, (err) => {
    console.warn('Listener de Usuario interrumpido:', err.message);
  });
  unsubs.push(unsub);
}

function syncExercises(user: any) {
  const q = query(
    collection(db, 'exercises'), 
    where('userId', '==', user.uid)
  );
  
  const unsub = onSnapshot(q, (snapshot) => {
    elements.exerciseList.innerHTML = '';
    currentExercises = [];
    let hasCompleted = false;

    snapshot.forEach((docSnap) => {
      const exercise = docSnap.data();
      const id = docSnap.id;
      currentExercises.push({ id, ...exercise });
      if (exercise.completed) hasCompleted = true;
      
      const item = document.createElement('div');
      item.className = 'glass-card p-5 rounded-2xl flex items-center justify-between animate-in fade-in zoom-in duration-300';
      item.innerHTML = `
        <div class="flex items-center gap-4">
          <button class="check-btn w-6 h-6 rounded-full border-2 border-orange-500/50 flex items-center justify-center transition-all ${exercise.completed ? 'bg-orange-500 border-orange-500' : ''}">
            ${exercise.completed ? '<span class="material-symbols-outlined text-black text-sm font-black">check</span>' : ''}
          </button>
          <span class="font-bold ${exercise.completed ? 'line-through text-white/30' : ''}">${exercise.title}</span>
        </div>
        <button class="delete-btn text-white/20 hover:text-red-500 transition-colors">
          <span class="material-symbols-outlined text-xl">delete</span>
        </button>
      `;

      // Eventos
      item.querySelector('.check-btn')?.addEventListener('click', () => toggleExercise(id, exercise));
      item.querySelector('.delete-btn')?.addEventListener('click', () => deleteExerciseConfirm(id));
      
      elements.exerciseList.appendChild(item);
    });

    // Mostrar/Ocultar botón de limpieza
    const clearBtn = document.getElementById('btn-clear-completed');
    if (clearBtn) {
      if (hasCompleted) clearBtn.classList.remove('hidden');
      else clearBtn.classList.add('hidden');
    }

    if (snapshot.empty) {
      elements.exerciseList.innerHTML = '<p class="text-center text-white/20 py-8 italic">No tienes misiones activas.</p>';
    }

    // Actualizar logros cada vez que los ejercicios cambian
    updateAchievements();
  }, (err) => {
    console.warn('Listener de Ejercicios interrumpido:', err.message);
  });
  unsubs.push(unsub);
}

function syncRanking() {
  const q = query(
    collection(db, 'users'), 
    orderBy('xp', 'desc'), 
    limit(20)
  );
  
  const unsub = onSnapshot(q, (snapshot) => {
    elements.rankingList.innerHTML = '';
    let rank = 1;
    snapshot.forEach((doc) => {
      const user = doc.data();
      const isMe = auth.currentUser?.uid === doc.id;
      
      const item = document.createElement('div');
      item.className = `glass-card p-4 rounded-2xl flex items-center gap-4 ${isMe ? 'border-orange-500/50 bg-orange-500/5' : ''}`;
      item.innerHTML = `
        <span class="w-6 font-black text-xs text-white/20">${rank}</span>
        <img src="${user.photoURL || 'https://via.placeholder.com/40'}" class="w-10 h-10 rounded-full object-cover bg-white/10" />
        <div class="flex-1 min-w-0">
          <p class="font-bold truncate text-sm">${user.displayName} ${isMe ? '(Tú)' : ''}</p>
          <p class="text-[10px] font-black uppercase text-orange-500/60 tracking-wider">${user.range}</p>
        </div>
        <div class="text-right">
          <p class="font-black text-sm">${user.xp.toLocaleString()}</p>
          <p class="text-[8px] font-black uppercase text-white/20">XP</p>
        </div>
      `;
      elements.rankingList.appendChild(item);
      rank++;
    });
  }, (err) => {
    console.warn('Listener de Ranking interrumpido:', err.message);
  });
  unsubs.push(unsub);
}

function updateAchievements() {
  if (!currentUserData) return;

  const completedCount = currentExercises.filter(e => e.completed).length;
  
  const achievements = [
    {
      id: 'first-step',
      title: 'Primer Paso',
      desc: 'Completa tu primera misión.',
      icon: 'directions_walk',
      condition: completedCount >= 1
    },
    {
      id: 'mission-master',
      title: 'Maestro de Misiones',
      desc: 'Completa 5 misiones.',
      icon: 'task_alt',
      condition: completedCount >= 5
    },
    {
      id: 'level-up',
      title: 'Ascenso Rápido',
      desc: 'Llega al Nivel 5.',
      icon: 'trending_up',
      condition: currentUserData.level >= 5
    },
    {
      id: 'silver-warrior',
      title: 'Guerrero de Plata',
      desc: 'Alcanza el rango Plata.',
      icon: 'shield',
      condition: currentUserData.xp >= 2000
    },
    {
      id: 'legend-start',
      title: 'Camino a la Leyenda',
      desc: 'Alcanza el rango Oro.',
      icon: 'workspace_premium',
      condition: currentUserData.xp >= 5000
    },
    {
      id: 'streak-king',
      title: 'Rey de la Constancia',
      desc: 'Ten una racha de 3 días.',
      icon: 'local_fire_department',
      condition: currentUserData.streak >= 3
    }
  ];

  elements.achievementsList.innerHTML = '';
  achievements.forEach(ach => {
    const card = document.createElement('div');
    card.className = `glass-card p-4 rounded-2xl flex items-center gap-4 transition-all ${ach.condition ? 'border-orange-500/40 bg-orange-500/5' : 'opacity-40 grayscale'}`;
    card.innerHTML = `
      <div class="w-12 h-12 rounded-xl flex items-center justify-center ${ach.condition ? 'bg-orange-500 text-black' : 'bg-white/10 text-white/40'}">
        <span class="material-symbols-outlined text-2xl" style="${ach.condition ? "font-variation-settings: 'FILL' 1;" : ''}">${ach.icon}</span>
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="font-black italic text-sm ${ach.condition ? 'text-orange-500' : 'text-white/60'}">${ach.title}</h3>
        <p class="text-[10px] font-medium text-white/40">${ach.desc}</p>
      </div>
      ${ach.condition ? '<span class="material-symbols-outlined text-orange-500 text-lg">check_circle</span>' : '<span class="material-symbols-outlined text-white/10 text-lg">lock</span>'}
    `;
    elements.achievementsList.appendChild(card);
  });
}

// --- Acciones del Usuario ---

async function toggleExercise(id: string, exercise: any) {
  try {
    const completed = !exercise.completed;
    await updateDoc(doc(db, 'exercises', id), { completed });
    
    if (completed) {
      // Al completar: +50 XP
      const newXP = currentUserData.xp + 50;
      await updateDoc(doc(db, 'users', auth.currentUser!.uid), {
        xp: newXP,
        level: getLevel(newXP),
        range: getRange(newXP),
        updatedAt: serverTimestamp()
      });
      console.log('¡Misión cumplida! +50 XP');
    }
  } catch (err) {
    console.error('Error al actualizar ejercicio:', err);
    alert('Error al actualizar: ' + err);
  }
}

async function deleteExerciseConfirm(id: string) {
  showModal(
    'confirm', 
    '¿Eliminar Misión?', 
    'Esta acción borrará la misión permanentemente.',
    async () => {
      try {
        await deleteDoc(doc(db, 'exercises', id));
        console.log('Misión eliminada correctamente de Firestore');
        hideModals();
      } catch (err: any) {
        console.error('Error al borrar mision:', err);
        alert('Error: ' + err.message);
      }
    }
  );
}

async function addExercise() {
  const title = elements.inputMissionTitle.value.trim();
  if (!title) return;

  await addDoc(collection(db, 'exercises'), {
    title,
    completed: false,
    userId: auth.currentUser!.uid,
    createdAt: serverTimestamp()
  });
  
  elements.inputMissionTitle.value = '';
  hideModals();
}

async function clearCompletedExercises() {
  const completed = currentExercises.filter(e => e.completed);
  if (completed.length === 0) return;

  showModal(
    'confirm',
    '¿Limpiar Misiones?',
    `Se borrarán ${completed.length} misiones ya cumplidas.`,
    async () => {
      try {
        const promises = completed.map(e => deleteDoc(doc(db, 'exercises', e.id)));
        await Promise.all(promises);
        console.log('Limpieza de misiones completada');
        hideModals();
      } catch (err: any) {
        console.error('Error al limpiar misiones:', err);
        alert('Error en la limpieza: ' + err);
      }
    }
  );
}

async function shareApp() {
  const shareData = {
    title: 'FitQuest - Mi Carrera Legendaria',
    text: `¡Mira mi progreso en FitQuest! Soy ${currentUserData.range} con ${currentUserData.xp} XP. ¡Retame!`,
    url: window.location.href
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      await navigator.clipboard.writeText(window.location.href);
      alert('¡Enlace de la app copiado al portapapeles! Compártelo con tus guerreros.');
    }
  } catch (err) {
    console.error('Error al compartir:', err);
  }
}

async function saveProfile() {
  const newName = elements.inputDisplayName.value.trim();
  if (!newName) return;
  
  await updateDoc(doc(db, 'users', auth.currentUser!.uid), {
    displayName: newName,
    updatedAt: serverTimestamp()
  });
  alert('¡Perfil actualizado, leyenda!');
}

async function deleteAccount() {
  showModal(
    'confirm',
    '¿BORRAR CUENTA?',
    'Perderás todo tu progreso y XP para siempre. Requiere haber iniciado sesión recientemente.',
    async () => {
      const user = auth.currentUser;
      if (user) {
        try {
          console.log('Iniciando borrado total para:', user.uid);
          await deleteDoc(doc(db, 'users', user.uid));
          await deleteUser(user);
          console.log('Adiós, leyenda.');
          window.location.reload();
        } catch (err: any) {
          console.error('Error al borrar cuenta:', err);
          if (err.code === 'auth/requires-recent-login') {
            alert('Por seguridad, debes cerrar sesión y volver a entrar justo antes de borrar tu cuenta.');
          } else {
            alert('Error de sistema: ' + err.message);
          }
        }
      }
    }
  );
}

// --- UI Updates ---

function updateUI() {
  if (!currentUserData) return;

  const isGuest = auth.currentUser?.isAnonymous;
  if (isGuest) {
    elements.guestWarning.classList.remove('hidden');
  } else {
    elements.guestWarning.classList.add('hidden');
  }

  elements.headerAvatar.src = currentUserData.photoURL || '';
  elements.profileAvatar.src = currentUserData.photoURL || '';
  elements.displayLevel.innerText = `Nivel ${currentUserData.level}`;
  elements.displayXP.innerText = `${currentUserData.xp.toLocaleString()} XP`;
  elements.displayRangeBadge.innerText = currentUserData.range;
  elements.displayRangeText.innerText = currentUserData.range.toUpperCase();
  elements.displayStreak.innerText = `${currentUserData.streak} días`;
  elements.inputDisplayName.value = currentUserData.displayName;

  // Actualizar círculo de progreso (XP hacia el siguiente nivel)
  const xpInLevel = currentUserData.xp % 1000;
  const percentage = xpInLevel / 1000;
  const dashoffset = 553 - (553 * percentage);
  elements.progressCircle.style.strokeDashoffset = dashoffset.toString();

  // Actualizar logros cada vez que cambia el estado
  updateAchievements();
}

// --- Auth Handling ---

onAuthStateChanged(auth, async (user) => {
  console.log('Estado de Auth cambiado:', user ? 'Sesión activa' : 'Sin sesión');

  // Capturamos el resultado de una redirección (por si falla o para limpiar flag de invitado)
  try {
    const result = await getRedirectResult(auth);
    if (result && result.user && !result.user.isAnonymous) {
      // Si veníamos de una vinculación exitosa, actualizamos Firestore
      const userRef = doc(db, 'users', result.user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists() && userSnap.data().isGuest) {
        await updateDoc(userRef, {
          isGuest: false,
          displayName: result.user.displayName || userSnap.data().displayName,
          photoURL: result.user.photoURL || userSnap.data().photoURL,
          updatedAt: serverTimestamp()
        });
        alert('¡Cuenta vinculada con éxito!');
      }
    }
  } catch (err: any) {
    handleAuthError(err);
  }
  
  if (user) {
    try {
      // Intentamos inicializar los datos del usuario antes de quitar la pantalla de carga
      await initializeUser(user);
      syncUserData(user);
      syncExercises(user);
      syncRanking();
      
      // Una vez todo listo, mostramos la App
      screens.loading.classList.add('hidden');
      screens.auth.classList.add('hidden');
      screens.app.classList.remove('hidden');
      elements.header.classList.remove('hidden');
      elements.bottomNav.classList.remove('hidden');
      switchView('dashboard');
    } catch (err: any) {
      console.error('Error crítico en Auth Flow:', err);
      
      screens.loading.classList.add('hidden');
      screens.auth.classList.remove('hidden');

      let msg = err.message;
      if (msg.includes('PERMISOS_DENEGADOS')) {
        alert('⚠️ ERROR DE PERMISOS:\n\nFirebase ha denegado el acceso. Por favor, asegúrate de haber pegado las REGLAS (Rules) en tu consola de Firebase y haber pulsado "PUBLISH".');
      } else {
        alert('⚠️ Error al cargar perfil: ' + msg);
      }
    }
  } else {
    // Si no hay sesión, vamos directo al login
    clearListeners();
    screens.loading.classList.add('hidden');
    screens.auth.classList.remove('hidden');
    screens.app.classList.add('hidden');
    elements.header.classList.add('hidden');
    elements.bottomNav.classList.add('hidden');
  }
});

// --- Event Listeners ---

const loginAction = async () => {
  const btn = document.getElementById('btn-login') as HTMLButtonElement;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="loader w-5 h-5 border-2 border-black/20 rounded-full inline-block mr-2 align-middle"></div> redireccionando...';
  }

  try {
    // Usamos Redirect en lugar de Popup
    await signInWithRedirect(auth, provider);
  } catch (err: any) {
    handleAuthError(err);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined">account_circle</span> Entrar con Google';
    }
  }
};

const guestLoginAction = async () => {
  const btn = document.getElementById('btn-guest') as HTMLButtonElement;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="loader w-5 h-5 border-2 border-white/20 rounded-full inline-block mr-2 align-middle"></div> entrando...';
  }

  try {
    await signInAnonymously(auth);
    console.log('Entrada como invitado exitosa');
  } catch (err: any) {
    console.error('Error al entrar como invitado:', err);
    if (err.code === 'auth/admin-restricted-operation') {
      alert('⚠️ MODO INVITADO DESACTIVADO:\n\nDebes activar el "Inicio de sesión anónimo" en tu consola de Firebase:\n\n1. Ve a Authentication\n2. Sign-in method\n3. Añadir nuevo proveedor -> Anónimo\n4. Activar y Guardar.');
    } else {
      alert('Error al entrar como invitado: ' + err.message);
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined text-xl">person_outline</span> Probar como Invitado';
    }
  }
};

const linkGoogleAction = async () => {
  try {
    const user = auth.currentUser;
    if (!user) return;
    
    // Vinculamos usando redirección
    await linkWithRedirect(user, provider);
  } catch (err: any) {
    console.error('Error al vincular cuenta:', err);
    if (err.code === 'auth/credential-already-in-use') {
      alert('Esta cuenta de Google ya está vinculada a otro perfil de FitQuest.');
    } else {
      handleAuthError(err);
    }
  }
};

function handleAuthError(err: any) {
  console.error('Error de Auth:', err);
  if (err.code === 'auth/popup-blocked') {
    alert('⚠️ VENTANA BLOQUEADA: Tu navegador impidió abrir el login. Por favor, permite las ventanas emergentes.');
  } else if (err.code === 'auth/unauthorized-domain') {
    alert(`⚠️ DOMINIO NO AUTORIZADO: Debes añadir ${window.location.hostname} en Firebase Console.`);
  } else {
    alert('Error: ' + err.message);
  }
}

document.getElementById('btn-login')?.addEventListener('click', loginAction);
document.getElementById('btn-guest')?.addEventListener('click', guestLoginAction);
elements.btnLinkGoogle?.addEventListener('click', linkGoogleAction);
document.getElementById('btn-logout')?.addEventListener('click', () => signOut(auth));
document.getElementById('btn-add-exercise')?.addEventListener('click', () => showModal('mission'));
document.getElementById('btn-clear-completed')?.addEventListener('click', clearCompletedExercises);
document.getElementById('btn-share-app')?.addEventListener('click', shareApp);
document.getElementById('btn-cancel-mission')?.addEventListener('click', hideModals);
document.getElementById('btn-confirm-mission')?.addEventListener('click', addExercise);
document.getElementById('btn-close-modal')?.addEventListener('click', () => {
  hideModals();
  switchView('profile');
});
document.getElementById('btn-save-profile')?.addEventListener('click', saveProfile);
document.getElementById('btn-delete-account')?.addEventListener('click', () => deleteAccount());
document.getElementById('btn-modal-confirm-cancel')?.addEventListener('click', hideModals);
document.getElementById('btn-modal-confirm-action')?.addEventListener('click', async () => {
  if (pendingAction) {
    const btn = elements.btnModalConfirmAction as HTMLButtonElement;
    btn.disabled = true;
    btn.innerText = 'PROCESANDO...';
    await pendingAction();
    btn.disabled = false;
    btn.innerText = 'CONFIRMAR';
  }
});

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view')!;
    switchView(view);
  });
});
