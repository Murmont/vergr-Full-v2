// staff — the founder's own account perks, as a FLAG instead of a hardcoded email.
//
// ⚠⚠ WHAT THIS REPLACED, AND WHY IT HAD TO GO. Fifteen server files carried
// `u.role === 'admin' || u.email === 'vergenerd@gmail.com'`. Two problems:
//
//   1. The email string is a BACKDOOR. Anyone who takes that Gmail inherits
//      every check that trusts it, on a platform that otherwise decides
//      authority from a Firebase Auth custom claim (functions/operator.js).
//   2. ELEVEN OF THE FIFTEEN WERE ALREADY DEAD and nobody had noticed. They
//      read `email` off the users DOCUMENT, and that field was removed on
//      2026-09-16 because `users/{uid}` is publicly listable. Measured
//      2026-09-20: 0 of 53 user docs carry an email. Those checks could not
//      match anything. Only the four reading `request.auth.token.email`
//      (announcements, discordClone, whatsappImport, scheduledMessages) still
//      fired, which is exactly the set that was a live backdoor.
//
// ⚠ THESE ARE PERKS, NOT AUTHORITY. Upload caps, stream limits, the translate
// quota, the geo block, vergr.me limits, username-policy exemption. Admin
// POWER is the operator claim and nothing here grants it. Keep the two apart:
// if a new check decides who may moderate, grant or ban, it belongs in
// functions/operator.js, never here.
//
// ⚠ `users/{uid}.staff` is SERVER-ONLY in firestore.rules (lockedUserFields).
// Owner-writable would let anyone lift their own upload cap and geo block.

/**
 * @param {object|null|undefined} userDoc a users/{uid} document's data
 * @returns {boolean}
 */
function isStaffDoc(userDoc) {
  return userDoc?.staff === true;
}

module.exports = { isStaffDoc };
