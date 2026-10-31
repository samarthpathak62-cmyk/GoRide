const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');

router.use(require('../middlewares/authMiddleware').protect);

router.get('/methods', (_req,res) => {
 let available=true;
 try { require('../config/payments').requireConfig(); } catch (_) { available=false; }
 res.json({currency:'INR',onlineCheckoutAvailable:available,
  checkoutMethods:['UPI','Cards','Netbanking'],
  notice:'Methods offered depend on your merchant account and provider eligibility. No direct card details are stored by GoRide.',
  bankPayoutAvailable:false,cashRideAvailable:false,refundAutomationAvailable:false});
});
router.get('/balance', walletController.getBalance);
router.get('/history', walletController.getTransactionHistory);
router.post('/topup', (req, res) => res.status(410).json({ message: 'Direct top-ups are disabled. Update the app and use verified checkout.' }));
router.post('/payment-link', walletController.topup);
router.post('/payout', walletController.payout);

module.exports = router;
