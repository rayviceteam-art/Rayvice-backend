import { Router } from 'express';
import * as authController from './auth.controller';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/authenticate';
import { authRateLimiter } from '../middleware/rateLimiter';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  googleAuthSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.validators';

const router = Router();

// --- Public endpoints (BACKEND-04 §4 Authentication module) ---
router.post('/register', authRateLimiter, validateRequest(registerSchema), authController.register);
router.post('/login', authRateLimiter, validateRequest(loginSchema), authController.login);
router.post('/google', authRateLimiter, validateRequest(googleAuthSchema), authController.googleAuth);
router.post('/refresh', authRateLimiter, authController.refresh);
router.post('/logout', authController.logout);
router.post('/verify-email', authRateLimiter, validateRequest(verifyEmailSchema), authController.verifyEmail);
router.post('/resend-verification', authRateLimiter, validateRequest(resendVerificationSchema), authController.resendVerification);
router.post('/forgot-password', authRateLimiter, validateRequest(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', authRateLimiter, validateRequest(resetPasswordSchema), authController.resetPassword);

// --- Protected endpoints ---
router.get('/me', authenticate, authController.getMe);
router.post('/change-password', authenticate, validateRequest(changePasswordSchema), authController.changePassword);

export default router;
