# Especificación de Seguridad de FitQuest

## Invariantes de Datos
1. Los usuarios no pueden asignarse XP arbitrario. El incremento de XP debe ser de +50 al completar un ejercicio.
2. El Nivel es una función pura del XP: `Math.floor(xp / 1000) + 1`.
3. El Rango es una función pura del XP.
4. Un ejercicio no puede completarse dos veces para ganar XP doble (la lógica de la app debe manejar esto, pero las reglas deben proteger contra escrituras maliciosas de XP).
5. El nombre de usuario es obligatorio y debe tener un límite de caracteres.

## "The Dirty Dozen" Payloads (Denegados)
1. Usuario intenta cambiar el XP de otro usuario.
2. Usuario intenta incrementarse XP sin completar una acción válida.
3. Usuario intenta borrar el ranking global.
4. Usuario intenta ponerse un rango "LEYENDA FIT" teniendo 0 XP.
5. Usuario intenta borrar un ejercicio que no le pertenece.
6. Usuario intenta crear un ejercicio para otro ID de usuario.
7. Usuario intenta poner un nombre de 5000 caracteres.
8. Usuario intenta saltarse niveles.
9. Usuario intenta cambiar el `userId` de un ejercicio existente.
10. Usuario sin autenticar intenta leer perfiles privados (si los hubiera).
11. Usuario intenta inyectar código en el nombre.
12. Usuario intenta resetear su racha negativamente de forma maliciosa.

## Estructura de Reglas (Draft)
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Helpers
    function isSignedIn() { return request.auth != null; }
    function isOwner(userId) { return request.auth.uid == userId; }
    
    match /users/{userId} {
      allow read: if true; // Ranking público
      allow create: if isSignedIn() && isOwner(userId) && request.resource.data.xp == 500;
      allow update: if isSignedIn() && isOwner(userId) 
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['displayName', 'xp', 'level', 'range', 'streak', 'updatedAt', 'photoURL']);
    }

    match /exercises/{exerciseId} {
      allow read: if isSignedIn() && resource.data.userId == request.auth.uid;
      allow create: if isSignedIn() && request.resource.data.userId == request.auth.uid;
      allow update, delete: if isSignedIn() && resource.data.userId == request.auth.uid;
    }
  }
}
```
