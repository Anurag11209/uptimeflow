import { z } from "zod";
import { emailSchema, passwordSchema } from "./common.js";

export const signUpSchema = z.object({
  name: z.string().trim().min(2, "Tell us your name.").max(80),
  email: emailSchema,
  password: passwordSchema,
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
  rememberMe: z.boolean().optional().default(true),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
  trustDevice: z.boolean().optional().default(false),
});
