// Shared squad-screen helpers — role mapping, avatar colours, formatters.
// Role colours (CLAUDE.md): Leader=gold, Co-Leader=violet, Officer=cyan, Member=grey.

// Firestore stores roles as president | vice_president | treasury | security |
// member (and some older docs use co-leader / officer). Normalise all of them.
const ROLE_ALIASES = {
  president: 'leader',
  leader: 'leader',
  owner: 'leader',
  vice_president: 'co',
  'co-leader': 'co',
  co_leader: 'co',
  co: 'co',
  treasury: 'officer',
  security: 'officer',
  officer: 'officer',
  member: 'member',
};

export const ROLE_META = {
  leader:  { label: 'Leader',    icon: 'workspace_premium', pill: 'role-leader',  name: 'gold',   mem: 'leader'  },
  co:      { label: 'Co-Leader', icon: 'shield',            pill: 'role-co',      name: 'violet', mem: 'co'      },
  officer: { label: 'Officer',   icon: 'stars',             pill: 'role-officer', name: 'cyan',   mem: 'officer' },
  member:  { label: 'Member',    icon: '',                  pill: 'role-member',  name: '',       mem: ''        },
};

export function roleKey(role) {
  return ROLE_ALIASES[(role || '').toLowerCase()] || 'member';
}

export function roleMeta(role) {
  return ROLE_META[roleKey(role)];
}

const AV_CLASSES = ['av-violet', 'av-pink', 'av-cyan', 'av-gold', 'av-ember', 'av-blue', 'av-slate'];

export function avatarClass(id) {
  if (!id) return 'av-violet';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AV_CLASSES[h % AV_CLASSES.length];
}

export function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase();
}

export function compact(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

const nameOf = (u) => u?.displayName || u?.username || 'Member';
export { nameOf };
