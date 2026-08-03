import { z } from 'zod';

/**
 * Shared password policy.
 * BACKEND-03 §2 "Secure Password Hashing" / GLOBAL-RULES §9 "Hash passwords
 * securely" require secure storage; this complexity policy is the
 * conventional baseline enforced at the input-validation layer alongside it
 * (min length + mixed character classes) to reduce weak-credential risk.
 */
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long.')
  .max(128, 'Password must be at most 128 characters long.')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter.')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter.')
  .regex(/[0-9]/, 'Password must contain at least one number.');

const emailSchema = z.string().trim().toLowerCase().email('A valid email address is required.');

export const registerSchema = z.object({
  body: z.object({
    businessName: z.string().trim().min(2).max(150),
    businessPhone: z.string().trim().min(7).max(20).optional(),
    industry: z.string().trim().max(100).optional(),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: emailSchema,
    password: passwordSchema,
  }),
});
export type RegisterInput = z.infer<typeof registerSchema>['body'];

export const loginSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required.'),
  }),
});
export type LoginInput = z.infer<typeof loginSchema>['body'];

export const verifyEmailSchema = z.object({
  body: z.object({
    token: z.string().min(1),
  }),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>['body'];

export const resendVerificationSchema = z.object({
  body: z.object({
    email: emailSchema,
  }),
});
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>['body'];

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: emailSchema,
  }),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>['body'];

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1),
    newPassword: passwordSchema,
  }),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>['body'];

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
  }),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>['body'];

export { passwordSchema, emailSchema };
