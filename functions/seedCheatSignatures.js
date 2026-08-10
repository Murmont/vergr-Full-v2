// One-time seed for the cheat-tool signature database. Idempotent on the
// `id` field — re-running the callable updates entries in place. Each
// signature was sourced from publicly-known cheat-tool names + commonly
// observed command-line patterns; severities are conservative (false-
// positive risk is real for general-purpose tools like AHK / Process Hacker
// → orange not red).
//
// Run once: from /admin/cheat-signatures admin screen, or call the
// `adminSeedCheatSignatures` callable directly.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const SEED = [
  // ─── Memory editors (RED — direct game manipulation) ───────────────
  { id: 'cheatengine_exe', kind: 'exe_name', value: 'cheatengine.exe', severity: 'red', label: 'Cheat Engine' },
  { id: 'cheatengine_x64', kind: 'exe_name', value: 'cheatengine-x86_64.exe', severity: 'red', label: 'Cheat Engine (x64)' },
  { id: 'cheatengine_x86', kind: 'exe_name', value: 'cheatengine-i386.exe', severity: 'red', label: 'Cheat Engine (x86)' },
  { id: 'artmoney', kind: 'exe_name', value: 'artmoney.exe', severity: 'red', label: 'ArtMoney' },
  { id: 'wemod', kind: 'exe_name', value: 'wemod.exe', severity: 'red', label: 'WeMod trainer launcher' },
  { id: 'gamehack', kind: 'exe_name', value: 'gamehack.exe', severity: 'red', label: 'Generic GameHack tool' },
  { id: 'trainer_generic', kind: 'cmd_substring', value: '+inf-health', severity: 'red', label: 'Trainer infinite-health flag' },

  // ─── Debuggers + reverse engineering (ORANGE — legit for devs, suspicious mid-match) ───
  { id: 'x64dbg', kind: 'exe_name', value: 'x64dbg.exe', severity: 'orange', label: 'x64dbg debugger' },
  { id: 'x32dbg', kind: 'exe_name', value: 'x32dbg.exe', severity: 'orange', label: 'x32dbg debugger' },
  { id: 'ollydbg', kind: 'exe_name', value: 'ollydbg.exe', severity: 'orange', label: 'OllyDbg' },
  { id: 'ida_exe', kind: 'exe_name', value: 'ida.exe', severity: 'orange', label: 'IDA Pro' },
  { id: 'ida64_exe', kind: 'exe_name', value: 'ida64.exe', severity: 'orange', label: 'IDA Pro (64-bit)' },
  { id: 'ghidra', kind: 'cmd_substring', value: 'ghidrarun', severity: 'orange', label: 'Ghidra reverse engineering' },
  { id: 'processhacker', kind: 'exe_name', value: 'processhacker.exe', severity: 'orange', label: 'Process Hacker' },
  { id: 'apimonitor', kind: 'exe_name', value: 'apimonitor-x64.exe', severity: 'orange', label: 'API Monitor' },

  // ─── Aimbots / ESP injectors (RED) ─────────────────────────────────
  { id: 'osiris_cs', kind: 'exe_name', value: 'osiris.exe', severity: 'red', label: 'Osiris CS multihack' },
  { id: 'aimware', kind: 'exe_name', value: 'aimware.exe', severity: 'red', label: 'Aimware cheat loader' },
  { id: 'csgosimple', kind: 'exe_name', value: 'csgosimple.exe', severity: 'red', label: 'CSGOSimple cheat' },
  { id: 'fatality_loader', kind: 'exe_name', value: 'fatality.exe', severity: 'red', label: 'Fatality cheat loader' },
  { id: 'gamesense', kind: 'exe_name', value: 'gamesense.exe', severity: 'red', label: 'Gamesense cheat' },
  { id: 'inject_dll_cmd', kind: 'cmd_substring', value: 'injectdll', severity: 'red', label: 'DLL injection command pattern' },
  { id: 'manual_map_cmd', kind: 'cmd_substring', value: 'manualmap', severity: 'red', label: 'Manual-map injection pattern' },

  // ─── Automation / macros (ORANGE — common legit use) ───────────────
  { id: 'autohotkey', kind: 'exe_name', value: 'autohotkey.exe', severity: 'orange', label: 'AutoHotkey' },
  { id: 'autohotkey64', kind: 'exe_name', value: 'autohotkey64.exe', severity: 'orange', label: 'AutoHotkey (64-bit)' },
  { id: 'autoit3', kind: 'exe_name', value: 'autoit3.exe', severity: 'orange', label: 'AutoIt' },
  { id: 'logitech_ghub', kind: 'cmd_substring', value: 'no-recoil', severity: 'orange', label: 'Logitech G Hub no-recoil macro flag' },
  { id: 'pulsar_macro', kind: 'exe_name', value: 'pulsar.exe', severity: 'orange', label: 'Pulsar macro suite' },

  // ─── ESP / wallhack overlays (RED) ─────────────────────────────────
  { id: 'esp_overlay_arg', kind: 'cmd_substring', value: '--enable-esp', severity: 'red', label: 'ESP-overlay command flag' },
  { id: 'wallhack_cfg', kind: 'cmd_substring', value: 'wallhack=1', severity: 'red', label: 'Wallhack config flag' },

  // ─── Input modifier hardware drivers (ORANGE) ──────────────────────
  { id: 'cronus_zen_drv', kind: 'exe_name', value: 'gtuner.exe', severity: 'orange', label: 'Cronus Zen GTuner driver' },
  { id: 'rewasd', kind: 'exe_name', value: 'rewasd.exe', severity: 'orange', label: 'ReWASD remapper' },
  { id: 'xim_apex', kind: 'exe_name', value: 'ximmanager.exe', severity: 'orange', label: 'XIM Manager' },
  { id: 'xim_apex_alt', kind: 'exe_name', value: 'xim.exe', severity: 'orange', label: 'XIM Apex client' },

  // ─── Map hacks / radar (RED) ───────────────────────────────────────
  { id: 'radarhack_generic', kind: 'cmd_substring', value: 'minimap-reveal', severity: 'red', label: 'Map-reveal cheat flag' },
  { id: 'sc_maphack', kind: 'exe_name', value: 'maphack.exe', severity: 'red', label: 'StarCraft maphack' },

  // ─── Misc YELLOW (mention only) ────────────────────────────────────
  { id: 'obs_studio', kind: 'exe_name', value: 'obs64.exe', severity: 'yellow', label: 'OBS Studio (recording — usually legit)' },
  { id: 'nvidia_share', kind: 'exe_name', value: 'nvidia share.exe', severity: 'yellow', label: 'NVIDIA ShareOverlay' },
  { id: 'wireshark', kind: 'exe_name', value: 'wireshark.exe', severity: 'yellow', label: 'Wireshark packet capture' },
  { id: 'fiddler', kind: 'exe_name', value: 'fiddler.exe', severity: 'yellow', label: 'Fiddler proxy' },
  { id: 'charles', kind: 'exe_name', value: 'charles.exe', severity: 'yellow', label: 'Charles HTTP proxy' },
];

exports.adminSeedCheatSignatures = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const u = await db.collection('users').doc(req.auth.uid).get();
  if (u.data()?.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }
  const batch = db.batch();
  let count = 0;
  for (const sig of SEED) {
    const { id, ...rest } = sig;
    const ref = db.collection('cheat_signatures').doc(id);
    batch.set(ref, {
      ...rest,
      value: rest.value.toLowerCase(),
      active: true,
      addedByUid: req.auth.uid,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    count++;
  }
  await batch.commit();
  return { ok: true, count };
});
