import { z } from 'zod';
import { UserSchema } from './user.schema';

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const RegisterSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(8, 'Confirm password must be at least 8 characters'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

export const AuthResponseSchema = z.object({
  message: z.string(),
  user: UserSchema,
  token: z.string(),
  verification: z
    .object({
      required: z.boolean(),
      status: z.enum(['pending', 'verified', 'already_verified', 'expired']),
      sessionId: z.string().optional(),
      resendAvailableAt: z.number().int().optional(),
      expiresAt: z.number().int().optional(),
    })
    .optional(),
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
