const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');



const loginLimiter=require('express-rate-limit').rateLimit({windowMs:15*60000,limit:30,standardHeaders:'draft-7',legacyHeaders:false,message:{message:'Too many sign-in attempts. Please wait before retrying.'}});
router.post('/signup', loginLimiter, authController.signup);
router.post('/login', loginLimiter, authController.login);

router.use(protect);
router.post('/update-profile', authController.updateProfile);

router.post('/mfa/enroll', authController.enrollMfa);
router.post('/mfa/challenge', authController.challengeMfa);
router.post('/mfa/verify', authController.verifyMfa);
router.get('/mfa/factors', authController.listMfaFactors);
router.delete('/mfa/factors/:factorId', authController.unenrollMfa);
router.post('/update-fcm-token', authController.updateFcmToken);
router.post('/logout', authController.logout);

module.exports = router;
