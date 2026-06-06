import { z } from 'zod';

export const RoleSchema = z.enum(['user', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(80).optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** The public-safe view of a user (never includes the password hash). */
export const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: RoleSchema,
  displayName: z.string().optional(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthResponseSchema = z.object({
  token: z.string(),
  user: AuthUserSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

/** The verified identity carried by an access token (JWT claims). */
export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: Role;
}
