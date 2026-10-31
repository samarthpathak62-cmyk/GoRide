const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driverController');
const { protect } = require('../middlewares/authMiddleware');

const onboarding = require('../controllers/onboardingController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

router.get('/requirements', onboarding.requirements);
router.get('/draft', protect, onboarding.getDraft);
router.post('/draft', protect, onboarding.saveDraft);
router.post('/submit-verification', protect, onboarding.submit);
router.get('/status', protect, driverController.getDriverStatus);
router.post('/upload-document', protect, upload.single('document'), onboarding.upload);
router.post('/toggle-online', protect, driverController.toggleOnline);

module.exports = router;
