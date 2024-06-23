"use server";

/* eslint @typescript-eslint/no-explicit-any:0, @typescript-eslint/prefer-optional-chain:0 */

import { z } from "zod";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { generateId, Scrypt } from "lucia";
import { isWithinExpirationDate, TimeSpan, createDate } from "oslo";
import { generateRandomString, alphabet } from "oslo/crypto";
import { eq } from "drizzle-orm";
import { lucia } from "@/lib/actions/auth";
import { db } from "@/server/db";
import {
  loginSchema,
  signupSchema,
  type LoginInput,
  type SignupInput,
  resetPasswordSchema,
} from "@/lib/validators/auth";
import {
  emailVerificationCodes,
  organizations,
  passwordResetTokens,
  sessions,
  userOrganizations,
  users,
} from "@/server/db/schema";
import { sendMail, EmailTemplate } from "@/lib/email";
import { validateRequest } from "@/lib/actions/auth/validate-request";
import { Paths } from "../../constants";
import { env } from "@/env";
import { processFieldErrors } from "../../utils";

export interface ActionResponse<T> {
  fieldError?: Partial<Record<keyof T, string | undefined>>;
  formError?: string;
}

export async function login(
  _: any,
  formData: FormData,
  apiCall?: boolean,
): Promise<ActionResponse<LoginInput> & { success?: boolean; error?: string }> {
  const obj = Object.fromEntries(formData.entries());

  const parsed = loginSchema.safeParse(obj);
  if (!parsed.success) {
    if (apiCall) {
      return { error: processFieldErrors(parsed.error) };
    }
    const err = parsed.error.flatten();

    return {
      fieldError: {
        email: err.fieldErrors.email?.[0],
        password: err.fieldErrors.password?.[0],
      },
    };
  }

  const { email, password } = parsed.data;

  const userWithOrg = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .leftJoin(userOrganizations, eq(userOrganizations.userId, users.id))
    .leftJoin(organizations, eq(organizations.id, userOrganizations.organizationId));

  const existingUser = userWithOrg[0]?.users;
  const orgs = userWithOrg.map(({ organizations }) => ({
    id: organizations?.id,
    name: organizations?.name,
  }));

  if (!existingUser) {
    return {
      formError: "Incorrect email or password",
      error: "Incorrect email or password",
    };
  }

  if (!existingUser || !existingUser.hashedPassword) {
    return {
      formError: "Incorrect email or password",
      error: "Incorrect email or password",
    };
  }

  const validPassword = await new Scrypt().verify(existingUser.hashedPassword, password);
  if (!validPassword) {
    return {
      formError: "Incorrect email or password",
      error: "Incorrect email or password",
    };
  }
  const session = orgs[0]
    ? await lucia.createSession(existingUser.id, {
        isUserVerified: false,
        organization: orgs[0].id,
      })
    : await lucia.createSession(existingUser.id, {
        isUserVerified: false,
      });
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookies().set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
  const verificationCode = await generateEmailVerificationCode(existingUser.id, email);
  await sendMail(email, EmailTemplate.EmailVerification, { code: verificationCode });

  if (apiCall) return { success: true };
  return redirect(Paths.VerifyEmail);
}

export async function signup(
  _: any,
  formData: FormData,
  apiCall?: boolean,
): Promise<ActionResponse<SignupInput> & { success?: boolean; error?: string }> {
  const obj = Object.fromEntries(formData.entries());

  const parsed = signupSchema.safeParse(obj);
  if (!parsed.success) {
    if (apiCall) return { error: processFieldErrors(parsed.error) };
    const err = parsed.error.flatten();
    return {
      fieldError: {
        userType: err.fieldErrors.userType?.[0],
        email: err.fieldErrors.email?.[0],
        password: err.fieldErrors.password?.[0],
        lastName: err.fieldErrors.lastName?.[0],
        firstName: err.fieldErrors.firstName?.[0],
      },
    };
  }

  const { email, password, userType, firstName, lastName } = parsed.data;

  const existingUser = await db.query.users.findFirst({
    where: (table, { eq }) => eq(table.email, email),
    columns: { email: true },
  });

  if (existingUser) {
    return {
      formError: "Cannot create account with that email",
      error: "Cannot create account with that email",
    };
  }

  const userId = generateId(21);
  const hashedPassword = await new Scrypt().hash(password);
  await db.insert(users).values({
    id: userId,
    email,
    hashedPassword,
    userType: userType,
    firstName,
    lastName,
  });

  const session = await lucia.createSession(userId, { isUserVerified: false });
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookies().set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
  const verificationCode = await generateEmailVerificationCode(userId, email);
  await sendMail(email, EmailTemplate.EmailVerification, { code: verificationCode });

  if (apiCall) return { success: true };
  return redirect(Paths.VerifyEmail);
}

export async function logout(
  _?: any,
  __?: FormData,
  apiCall?: boolean,
): Promise<{ error?: string } & { success?: boolean }> {
  const { user, session } = await validateRequest();
  session;
  if (!session) {
    return {
      error: "No session found",
    };
  }

  await db.delete(sessions).where(eq(sessions.id, session.id));
  await db.delete(emailVerificationCodes).where(eq(emailVerificationCodes.email, user.email));
  await lucia.invalidateSession(session.id);
  const sessionCookie = lucia.createBlankSessionCookie();
  cookies().set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
  if (apiCall) return { success: true };
  return redirect("/");
}

export async function resendVerificationEmail(): Promise<{
  error?: string;
  success?: boolean;
}> {
  const { user } = await validateRequest();
  if (!user) {
    return redirect(Paths.Login);
  }
  const lastSent = await db.query.emailVerificationCodes.findFirst({
    where: (table, { eq }) => eq(table.userId, user.id),
    columns: { expiresAt: true },
  });

  if (lastSent && isWithinExpirationDate(lastSent.expiresAt)) {
    return {
      error: `Please wait ${timeFromNow(lastSent.expiresAt)} before resending`,
    };
  }
  const verificationCode = await generateEmailVerificationCode(user.id, user.email);
  await sendMail(user.email, EmailTemplate.EmailVerification, { code: verificationCode });

  return { success: true };
}

export async function verifyEmail(
  _: any,
  formData: FormData,
  apiCall?: boolean,
): Promise<{ error?: string } & { success?: boolean }> {
  const code = formData.get("code");
  if (typeof code !== "string" || code.length !== 6) {
    return { error: "Invalid code" };
  }
  const { user, session: currentSession } = await validateRequest();

  if (!user) {
    if (apiCall) return { error: "No session" };
    return redirect(Paths.Login);
  }

  const item = await db.query.emailVerificationCodes.findFirst({
    where: (table, { eq }) => eq(table.userId, user.id),
  });

  if (!item || item.code !== code) return { error: "Invalid verification code" };

  if (!isWithinExpirationDate(item.expiresAt)) return { error: "Verification code expired" };

  if (item.email !== user.email) return { error: "Email does not match" };

  // await lucia.invalidateUserSessions(user.id); //single session method
  await lucia.invalidateSession(currentSession.id); //multi session method
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
  if (item) {
    await db.delete(emailVerificationCodes).where(eq(emailVerificationCodes.id, item.id));
  }
  const session = currentSession.organization
    ? await lucia.createSession(user.id, {
        isUserVerified: true,
        organization: currentSession.organization,
      })
    : await lucia.createSession(user.id, {
        isUserVerified: true,
      });
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookies().set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
  if (apiCall) return { success: true };
  redirect(Paths.Dashboard);
}

export async function sendPasswordResetLink(
  _: any,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const email = formData.get("email");
  const parsed = z.string().trim().email().safeParse(email);
  if (!parsed.success) {
    return { error: "Provided email is invalid." };
  }
  try {
    const user = await db.query.users.findFirst({
      where: (table, { eq }) => eq(table.email, parsed.data),
    });

    if (!user || !user.emailVerified) return { error: "Provided email is invalid." };

    const verificationToken = await generatePasswordResetToken(user.id);

    const verificationLink = `${env.NEXT_PUBLIC_APP_URL}/reset-password/${verificationToken}`;

    await sendMail(user.email, EmailTemplate.PasswordReset, { link: verificationLink });

    return { success: true };
  } catch (error) {
    return { error: "Failed to send verification email." };
  }
}

export async function resetPassword(
  _: any,
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  const obj = Object.fromEntries(formData.entries());

  const parsed = resetPasswordSchema.safeParse(obj);

  if (!parsed.success) {
    const err = parsed.error.flatten();
    return {
      error: err.fieldErrors.password?.[0] ?? err.fieldErrors.token?.[0],
    };
  }
  const { token, password } = parsed.data;

  const dbToken = await db.transaction(async (tx) => {
    const item = await tx.query.passwordResetTokens.findFirst({
      where: (table, { eq }) => eq(table.id, token),
    });
    if (item) {
      await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.id, item.id));
    }
    return item;
  });

  if (!dbToken) return { error: "Invalid password reset link" };

  if (!isWithinExpirationDate(dbToken.expiresAt)) return { error: "Password reset link expired." };

  await lucia.invalidateUserSessions(dbToken.userId);
  const hashedPassword = await new Scrypt().hash(password);
  await db.update(users).set({ hashedPassword }).where(eq(users.id, dbToken.userId));
  const session = await lucia.createSession(dbToken.userId, { isUserVerified: false });
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookies().set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
  redirect(Paths.Dashboard);
}

const timeFromNow = (time: Date) => {
  const now = new Date();
  const diff = time.getTime() - now.getTime();
  const minutes = Math.floor(diff / 1000 / 60);
  const seconds = Math.floor(diff / 1000) % 60;
  return `${minutes}m ${seconds}s`;
};

async function generateEmailVerificationCode(userId: string, email: string): Promise<string> {
  await db.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, userId));
  const code = generateRandomString(6, alphabet("0-9")); // 6 digit code
  await db.insert(emailVerificationCodes).values({
    userId,
    email,
    code,
    expiresAt: createDate(new TimeSpan(5, "m")), // 5 minutes
  });
  return code;
}

async function generatePasswordResetToken(userId: string): Promise<string> {
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
  const tokenId = generateId(40);
  await db.insert(passwordResetTokens).values({
    id: tokenId,
    userId,
    expiresAt: createDate(new TimeSpan(2, "h")),
  });
  return tokenId;
}