import { doc, getDoc, collection, query, where, limit, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { getMembershipTiers } from '../firebase/firestore';
import { getVergrMeProduct, getMyVergrMePurchase } from './vergrMeShop';

// Enrich vergr_* cross-promo blocks with live data so the public page shows
// real titles/status (the thing Linktree can't do). Each fetch is wrapped so
// a failure just leaves the block's default label. Runs on the public page
// only (not the editor preview).
export async function enrichBlocks(uid, blocks) {
  if (!Array.isArray(blocks)) return blocks;
  return Promise.all(
    blocks.map(async (b) => {
      try {
        switch (b.type) {
          case 'vergr_stream': {
            const snap = await getDocs(
              query(collection(db, 'streams'), where('streamerId', '==', uid), where('isLive', '==', true), limit(1))
            );
            // vergr.me is a PUBLIC, unauthenticated page, so an adult stream is
            // never surfaced here: there is no viewer to have opted in and no
            // identity to have verified. Filtered in JS, not in the query, because
            // a Firestore `!=` also excludes documents where the field is ABSENT,
            // which is every stream created before this shipped.
            if (!snap.empty && snap.docs[0].data()?.contentRating !== 'nsfw') {
              const s = snap.docs[0];
              return { ...b, _title: s.data().title || 'Live now', _subtitle: '🔴 LIVE now', streamId: s.id, _live: true };
            }
            return { ...b, _title: 'My streams', _subtitle: 'Offline · view profile' };
          }
          // vergr_tournament retired: nothing to enrich, the block no longer
          // renders. Saves a document read per surviving saved block too.
          case 'vergr_event': {
            if (!b.eventId) return b;
            const s = await getDoc(doc(db, 'tournaments', b.eventId));
            if (s.exists()) {
              const d = s.data();
              const price = d.ticket?.priceCoins;
              return { ...b, _title: d.name || 'Ticketed event', _subtitle: price ? `Tickets from ${price} coins` : 'Get tickets' };
            }
            return b;
          }
          case 'vergr_squad': {
            if (!b.squadId) return b;
            const s = await getDoc(doc(db, 'squads', b.squadId));
            if (s.exists()) {
              const d = s.data();
              return { ...b, _title: d.name || 'My squad', _subtitle: d.memberCount ? `${d.memberCount} members` : 'Join my squad' };
            }
            return b;
          }
          case 'vergr_group': {
            if (!b.groupId) return b;
            const s = await getDoc(doc(db, 'conversations', b.groupId));
            if (s.exists()) {
              const d = s.data();
              const n = (d.participants || []).length;
              return { ...b, _title: d.groupName || d.name || 'Group chat', _subtitle: n ? `${n} members · tap to join` : 'Tap to join' };
            }
            return b;
          }
          case 'membership': {
            const { tiers, seasonPass } = await getMembershipTiers(uid);
            return { ...b, _tiers: tiers, _seasonPass: seasonPass };
          }
          case 'digital_product': {
            if (!b.productId) return b;
            const p = await getVergrMeProduct(uid, b.productId);
            if (!p || p.published === false) return b; // unpublished → block renders nothing
            const viewer = auth.currentUser?.uid;
            let owned = false;
            if (p.kind !== 'physical') { // physical = repeat orders, no owned state
              owned = viewer === uid; // seller always "owns" their own file
              if (viewer && !owned) {
                owned = !!(await getMyVergrMePurchase(viewer, uid, b.productId));
              }
            }
            return { ...b, _product: p, _owned: owned };
          }
          default:
            return b;
        }
      } catch {
        return b;
      }
    })
  );
}
