import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { openAPI, organization, twoFactor } from "better-auth/plugins";
import type { PrismaClient } from "@backend-uptime/db";
import { enqueueEmail, type EmailQueue } from "@backend-uptime/notifications";
import type { AuditEvent } from "@backend-uptime/shared";
import type { Redis } from "ioredis";
import { ac, orgAccessRoles } from "./permissions.js";

export { ac, orgAccessRoles } from "./permissions.js";

export interface OAuthProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export interface CreateAuthOptions {
  prisma: PrismaClient;
  redis: Redis;
  emailQueue: EmailQueue;
  /** 32+ byte secret used to sign tokens and cookies. */
  secret: string;
  /** Public URL of the API service, e.g. https://api.backenduptime.dev */
  baseUrl: string;
  /** Public URL of the web app — trusted origin and email link target. */
  webUrl: string;
  isProduction: boolean;
  github?: OAuthProviderCredentials;
  google?: OAuthProviderCredentials;
  /** Audit sink injected by the API service; failures must never block auth. */
  auditLog?: (event: AuditEvent) => Promise<void>;
  /** Expose the generated OpenAPI reference at /api/auth/reference. */
  enableOpenApiReference?: boolean;
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export function createAuth(options: CreateAuthOptions) {
  const audit = async (event: AuditEvent): Promise<void> => {
    try {
      await options.auditLog?.(event);
    } catch {
      // Audit writes are best-effort from inside auth flows; the API layer
      // logs sink failures with full context.
    }
  };

  return betterAuth({
    appName: "Backend Uptime",
    baseURL: options.baseUrl,
    secret: options.secret,
    trustedOrigins: [options.webUrl],

    database: prismaAdapter(options.prisma, { provider: "postgresql" }),

    // Session + rate-limit hot path served from Redis instead of Postgres.
    secondaryStorage: {
      get: (key) => options.redis.get(`ba:${key}`),
      set: async (key, value, ttl) => {
        if (ttl) await options.redis.set(`ba:${key}`, value, "EX", ttl);
        else await options.redis.set(`ba:${key}`, value);
      },
      delete: async (key) => {
        await options.redis.del(`ba:${key}`);
      },
    },

    session: {
      expiresIn: 30 * DAY,
      updateAge: 1 * DAY,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: HOUR,
      sendResetPassword: async ({ user, url }) => {
        await enqueueEmail(options.emailQueue, {
          template: "reset_password",
          to: user.email,
          userName: user.name,
          resetUrl: url,
        });
      },
      onPasswordReset: async ({ user }) => {
        await audit({
          actorId: user.id,
          actorType: "user",
          action: "user.password_reset",
          resourceType: "user",
          resourceId: user.id,
        });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: HOUR,
      sendVerificationEmail: async ({ user, url }) => {
        await enqueueEmail(options.emailQueue, {
          template: "verify_email",
          to: user.email,
          userName: user.name,
          verifyUrl: url,
        });
      },
      afterEmailVerification: async (user) => {
        await enqueueEmail(options.emailQueue, {
          template: "welcome",
          to: user.email,
          userName: user.name,
          dashboardUrl: `${options.webUrl}/dashboard`,
        });
      },
    },

    socialProviders: {
      ...(options.github ? { github: options.github } : {}),
      ...(options.google ? { google: options.google } : {}),
    },

    // Better Auth's built-in limiter guards the auth surface itself
    // (sign-in brute force, verification spam). The API adds a second,
    // Redis-backed limiter for /v1 routes.
    rateLimit: {
      enabled: true,
      storage: "secondary-storage",
      window: 60,
      max: 100,
    },

    advanced: {
      useSecureCookies: options.isProduction,
      defaultCookieAttributes: {
        sameSite: "lax",
        httpOnly: true,
        secure: options.isProduction,
      },
      ipAddress: {
        // Cloudflare sits in front in production.
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
      },
    },

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await audit({
              actorId: user.id,
              actorType: "user",
              action: "user.signed_up",
              resourceType: "user",
              resourceId: user.id,
            });
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            await audit({
              actorId: session.userId,
              actorType: "user",
              action: "user.signed_in",
              resourceType: "session",
              resourceId: session.id,
              ipAddress: session.ipAddress ?? null,
              userAgent: session.userAgent ?? null,
            });
          },
        },
      },
    },

    plugins: [
      organization({
        ac,
        roles: orgAccessRoles,
        creatorRole: "owner",
        invitationExpiresIn: 7 * DAY,
        membershipLimit: 200,
        sendInvitationEmail: async (data) => {
          const acceptUrl = `${options.webUrl}/accept-invitation/${data.id}`;
          await enqueueEmail(options.emailQueue, {
            template: "org_invitation",
            to: data.email,
            inviterName: data.inviter.user.name,
            organizationName: data.organization.name,
            role: data.role ?? "viewer",
            acceptUrl,
          });
          await audit({
            organizationId: data.organization.id,
            actorId: data.inviter.user.id,
            actorType: "user",
            action: "member.invited",
            resourceType: "invitation",
            resourceId: data.id,
            metadata: { email: data.email, role: data.role ?? "viewer" },
          });
        },
        organizationCreation: {
          afterCreate: async ({
            organization: org,
            user,
          }: {
            organization: { id: string; name: string; slug: string };
            user: { id: string };
          }) => {
            await audit({
              organizationId: org.id,
              actorId: user.id,
              actorType: "user",
              action: "organization.created",
              resourceType: "organization",
              resourceId: org.id,
              metadata: { name: org.name, slug: org.slug },
            });
          },
        },
      }),
      twoFactor({
        issuer: "Backend Uptime",
        totpOptions: { digits: 6, period: 30 },
      }),
      ...(options.enableOpenApiReference ? [openAPI()] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"];
