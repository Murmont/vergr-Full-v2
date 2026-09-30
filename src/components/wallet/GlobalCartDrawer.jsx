// The basket, available on EVERY page.
//
// ⚠ Founder, 2026-08-28: *"the card drawer will need to be able to come out on
// any page, so checkout can finish fast, like if I am on a stream I won't want to
// leave the stream in order to purchase more coins."*
//
// Until now `CartDrawer` was mounted inside `wallet/v2/BuyScreen` only, so a
// basket opened from anywhere else had nowhere to render. `CartProvider` was
// already global (AppRouter wraps the whole app in it), so the STATE travelled
// and only the UI was trapped on one screen.
//
// This is a thin host: it owns the checkout call and nothing else, and renders
// nothing at all until the cart is open, so it costs an idle component on every
// page and not a line of layout.
import { useCart } from '../../context/CartContext';
import { useUI } from '../../context/UIContext';
import { auth } from '../../firebase/config';
import { useBuyCheckout, checkoutCartViaPlay } from '../../screens/wallet/v2/buyCheckout';
import CartDrawer from './CartDrawer';

export default function GlobalCartDrawer() {
  const cart = useCart();
  const { showToast } = useUI();
  const { checkout, startCheckout } = useBuyCheckout(showToast);
  // Codapay runs INSIDE the basket (CodaPay.jsx); the basket only tells us when
  // the server has settled the order.
  const onCodaSettled = (s) => {
    cart.clear(); cart.setOpen(false);
    showToast(Number(s?.coins) > 0 ? `Added ${Number(s.coins).toLocaleString()} coins to your wallet!` : 'Purchase complete!', 'success');
  };

  // ⚠ Identical to BuyScreen's checkoutCart, deliberately: two baskets that
  // check out differently is the drift this whole file exists to avoid. If that
  // one changes, change this one in the same edit.
  const checkoutCart = async (lines, _quote, method) => {
    // Google Play cannot take a basket in one go, so it buys line by line.
    // Billing digital goods inside a Play app any other way is a policy breach.
    if (method === 'googlePlay') {
      const res = await checkoutCartViaPlay(lines, auth.currentUser?.uid, showToast);
      if (res.bought === res.total) { cart.clear(); cart.setOpen(false); }
      return;
    }
    // SKUs and quantities only — the server re-prices the basket, so no amount
    // is sent from the client.
    const ok = await startCheckout({ cart: lines }, 'your basket');
    if (ok === true) { cart.clear(); cart.setOpen(false); }
  };

  // Nothing rendered while closed, so this is free on every other page.
  if (!cart.open) return null;

  return <CartDrawer onCheckout={checkoutCart} busy={checkout?.status === 'waiting'} onCodaSettled={onCodaSettled} />;
}
