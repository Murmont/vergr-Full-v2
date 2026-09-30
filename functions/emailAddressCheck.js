// Can this address actually receive mail? (founder, 2026-09-29: "I don't want
// users to type nonsense then add an @gmail and be able to create an account").
//
// Three checks, all free of any paid service:
//   1. shape      one @, a dotted domain, no spaces
//   2. typo       gmial.com / hotmial.com ... -> "did you mean gmail.com?"
//   3. disposable a shipped list of throwaway-mail domains
//   4. MX         the domain publishes a mail server (dns.resolveMx)
//
// The MX lookup FAILS OPEN on a DNS timeout or resolver error: a flaky resolver
// must never stop a real person signing up. It fails CLOSED only on a definite
// answer that no mail server exists (ENOTFOUND / ENODATA / empty list).
//
// Note that a valid domain does not prove the MAILBOX exists (typing nonsense
// before @gmail.com still passes here). That part is proved by the verification
// email itself: until the owner taps the link or enters the code, the account
// cannot post, message or buy.

const dns = require('dns').promises;

// Common throwaway providers. Not exhaustive by design; the verification email
// is the real proof. Add to it when support sees a new one.
const DISPOSABLE = new Set([
  '10minutemail.com', '10minutemail.net', '20minutemail.com', '33mail.com', 'anonaddy.me',
  'burnermail.io', 'byom.de', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamail.biz', 'guerrillamail.de', 'guerrillamailblock.com', 'sharklasers.com', 'grr.la',
  'pokemail.net', 'spam4.me', 'mailinator.com', 'mailinator.net', 'mailinator2.com', 'mailinater.com',
  'maildrop.cc', 'mailnesia.com', 'mailcatch.com', 'mintemail.com', 'mohmal.com', 'mytemp.email',
  'temp-mail.org', 'temp-mail.io', 'tempmail.com', 'tempmail.net', 'tempmail.dev', 'tempmailo.com',
  'tempmail.plus', 'tempr.email', 'tempinbox.com', 'tempail.com', 'temporary-mail.net', 'throwawaymail.com',
  'trashmail.com', 'trashmail.net', 'trashmail.de', 'trash-mail.com', 'yopmail.com', 'yopmail.net',
  'yopmail.fr', 'cool.fr.nf', 'jetable.fr.nf', 'nospam.ze.tc', 'nomail.xl.cx', 'mega.zik.dj',
  'speed.1s.fr', 'courriel.fr.nf', 'moncourrier.fr.nf', 'monemail.fr.nf', 'monmail.fr.nf',
  'dispostable.com', 'discard.email', 'discardmail.com', 'discardmail.de', 'emailondeck.com',
  'fakeinbox.com', 'fakemail.net', 'getairmail.com', 'getnada.com', 'nada.email', 'inboxkitten.com',
  'harakirimail.com', 'incognitomail.org', 'mailpoof.com', 'mail.tm', 'mail.gw', 'emlhub.com',
  'emltmp.com', 'emlpro.com', 'spamgourmet.com', 'spambox.us', 'spamex.com', 'mvrht.net',
  'owlymail.com', 'luxusmail.org', 'tmail.ws', 'tmpmail.org', 'tmpmail.net', 'tmpeml.com',
  'fexpost.com', 'fexbox.org', 'rover.info', 'mailforspam.com', 'eyepaste.com', 'wegwerfmail.de',
  'wegwerfmail.net', 'einrot.com', 'spoofmail.de', 'fleckens.hu', 'dayrep.com', 'armyspy.com',
  'cuvox.de', 'gustr.com', 'jourrapide.com', 'rhyta.com', 'superrito.com', 'teleworm.us',
  'mailbox52.ga', 'emailfake.com', 'generator.email', 'email-fake.com', 'fake-box.com', 'cmail.club',
  'linshiyouxiang.net', 'bccto.me', 'chacuo.net', '027168.com', 'tempmailaddress.com', 'mailtemp.info',
  'minuteinbox.com', 'mailsac.com', 'inboxbear.com', 'crazymailing.com', 'deadaddress.com',
  'kurzepost.de', 'objectmail.com', 'proxymail.eu', 'rcpt.at', 'trash2009.com', 'mt2015.com',
  'thankyou2010.com', 'boun.cr', 'spamfree24.org', 'dropmail.me', '1secmail.com', '1secmail.net',
  '1secmail.org', 'esiix.com', 'wwjmp.com', 'xojxe.com', 'yoggm.com', 'vjuum.com', 'laafd.com',
  'txcct.com', 'rteet.com', 'dpptd.com', 'kzccv.com', 'qiott.com', 'wuuvo.com', 'icznn.com',
  'ezztt.com', 'firemailbox.club', 'hidemail.de', 'spambog.com', 'spambog.de', 'spambog.ru',
  'mailexpire.com', 'mailmoat.com', 'mailnull.com', 'meltmail.com', 'mytrashmail.com', 'nowmymail.com',
  'sogetthis.com', 'spamherelots.com', 'spamthisplease.com', 'tradermail.info', 'veryrealemail.com',
  'zippymail.info', 'zetmail.com', 'zoemail.org', 'emailtemporanea.net', 'correotemporal.org',
]);

// Misspellings of the big providers. Only exact domain matches are corrected, so
// a real domain that happens to be close to one is never "fixed" by guesswork.
const TYPOS = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmal.com': 'gmail.com',
  'gmaill.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.con': 'gmail.com',
  'gmail.om': 'gmail.com', 'gmail.cmo': 'gmail.com', 'gmail.comm': 'gmail.com', 'gnail.com': 'gmail.com',
  'gmsil.com': 'gmail.com', 'gmali.com': 'gmail.com', 'gmil.com': 'gmail.com', 'gimail.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmal.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotamil.com': 'hotmail.com', 'hotnail.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.co': 'outlook.com', 'outlook.con': 'outlook.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yhaoo.com': 'yahoo.com',
  'iclod.com': 'icloud.com', 'icloud.co': 'icloud.com', 'icoud.com': 'icloud.com', 'icloud.con': 'icloud.com',
  'protonmail.co': 'protonmail.com', 'protonmial.com': 'protonmail.com', 'proton.m': 'proton.me',
};

const SHAPE = /^[^\s@]+@([a-z0-9-]+\.)+[a-z]{2,}$/i;

/**
 * @returns {Promise<{ok:boolean, reason?:string, message?:string, suggestion?:string}>}
 * reason: 'shape' | 'typo' | 'disposable' | 'no_mail_server'
 */
async function checkEmailAddress(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!SHAPE.test(email)) {
    return { ok: false, reason: 'shape', message: 'That is not a valid email address.' };
  }
  const [local, domain] = email.split('@');
  if (TYPOS[domain]) {
    const suggestion = `${local}@${TYPOS[domain]}`;
    return { ok: false, reason: 'typo', suggestion, message: `Did you mean ${suggestion}?` };
  }
  if (DISPOSABLE.has(domain) || [...DISPOSABLE].some((d) => domain.endsWith('.' + d))) {
    return { ok: false, reason: 'disposable', message: 'Temporary email addresses cannot be used. Use an address you keep.' };
  }
  try {
    const mx = await Promise.race([
      dns.resolveMx(domain),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), 4000)),
    ]);
    if (!Array.isArray(mx) || !mx.some((r) => r && r.exchange && r.exchange !== '.')) {
      return { ok: false, reason: 'no_mail_server', message: `${domain} cannot receive email. Check the address.` };
    }
  } catch (e) {
    if (e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA' || e.code === 'NXDOMAIN')) {
      return { ok: false, reason: 'no_mail_server', message: `${domain} cannot receive email. Check the address.` };
    }
    // Resolver trouble: fail open. The verification email is the real proof.
  }
  return { ok: true };
}

module.exports = { checkEmailAddress, _DISPOSABLE: DISPOSABLE, _TYPOS: TYPOS };
