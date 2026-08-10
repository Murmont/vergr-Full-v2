// src/screens/wallet/v2/CartScreen.jsx
//
// Mobile basket: a real page at /wallet/cart, not a sheet.
//
// A drawer on a 390px screen is a page with less room and a worse close
// target, and it cannot be linked to, shared, or reached with the back button.
// A checkout that a reviewer can open by URL is also simply easier to review.
//
// Desktop uses the drawer instead; both render the same CartContents, so the
// lines, the totals and the terms are identical on either.
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/Icon';
import CartContents from '../../../components/wallet/CartContents';
import { useCart } from '../../../context/CartContext';
import { WALLET_TOKENS } from '../../../components/wallet/primitives';
import { useUI } from '../../../context/UIContext';
import { useBuyCheckout, checkoutCartViaPlay } from './buyCheckout';
import { auth } from '../../../firebase/config';

export default function CartScreen() {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const { clear } = useCart();
  const { checkout, startCheckout } = useBuyCheckout(showToast);

  const onCheckout = async (lines, _quote, method) => {
    if (method === 'googlePlay') {
      const res = await checkoutCartViaPlay(lines, auth.currentUser?.uid, showToast);
      if (res.bought === res.total) clear();
      return;
    }
    // The cart travels as SKUs and quantities. The server re-prices it, which
    // is why nothing here sends an amount.
    const ok = await startCheckout({ cart: lines }, 'your basket');
    // Only emptied once the payment page has actually opened: clearing on the
    // click would lose the basket if the popup were blocked.
    if (ok === true) clear();
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 0 32px', color: WALLET_TOKENS.text }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          style={{ background: 'none', border: 0, cursor: 'pointer', color: WALLET_TOKENS.text, padding: 4 }}
        >
          <Icon name="arrow_back" size={22} />
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 800 }}>Your basket</h1>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '60vh' }}>
        <CartContents
          onCheckout={onCheckout}
          busy={!!checkout}
          onClose={() => navigate('/wallet/buy')}
          variant="page"
        />
      </div>
    </div>
  );
}
