import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";
import { encrypt } from "./encryption";

// Validate required environment variables
const requiredEnvVars = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
};

const missingVars = Object.entries(requiredEnvVars)
  .filter(([_, value]) => !value)
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.error("[Auth] Missing required environment variables:", missingVars);
  throw new Error(
    `Missing required environment variables: ${missingVars.join(", ")}. ` +
    `Please check your .env.local file or environment configuration.`
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  trustHost: true, // Required for NextAuth v5 in some deployment scenarios
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/gmail.send", // For AI reply drafts
          ].join(" "),
        },
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  cookies: {
    sessionToken: {
      name: `${process.env.NODE_ENV === "production" ? "__Secure-" : ""}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    callbackUrl: {
      name: `${process.env.NODE_ENV === "production" ? "__Secure-" : ""}next-auth.callback-url`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    csrfToken: {
      name: `${process.env.NODE_ENV === "production" ? "__Host-" : ""}next-auth.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    pkceCodeVerifier: {
      name: `${process.env.NODE_ENV === "production" ? "__Secure-" : ""}next-auth.pkce.code_verifier`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 15, // 15 minutes
      },
    },
  },
  callbacks: {
    async jwt({ token, account, user }) {
      // Initial sign in
      if (account && user) {
        console.log("[Auth] JWT callback - Initial sign in", {
          userId: user.id,
          provider: account.provider,
          hasAccessToken: !!account.access_token,
          hasRefreshToken: !!account.refresh_token,
        });

        // Store OAuth tokens encrypted
        if (account.access_token && account.refresh_token) {
          try {
            await prisma.oAuthToken.upsert({
              where: {
                userId_provider: {
                  userId: user.id!,
                  provider: "google",
                },
              },
              update: {
                accessTokenEnc: encrypt(account.access_token),
                refreshTokenEnc: encrypt(account.refresh_token),
                expiry: account.expires_at
                  ? new Date(account.expires_at * 1000)
                  : null,
                scope: account.scope,
              },
              create: {
                userId: user.id!,
                provider: "google",
                accessTokenEnc: encrypt(account.access_token),
                refreshTokenEnc: encrypt(account.refresh_token),
                expiry: account.expires_at
                  ? new Date(account.expires_at * 1000)
                  : null,
                scope: account.scope,
              },
            });

            console.log("[Auth] Successfully stored OAuth tokens in database", {
              userId: user.id,
              provider: "google",
              hasExpiry: !!account.expires_at,
              scope: account.scope,
            });
          } catch (error) {
            console.error("[Auth] Failed to store OAuth tokens:", error);
            throw error;
          }

          // Create default user settings if not exists
          try {
            await prisma.userSettings.upsert({
              where: { userId: user.id! },
              update: {},
              create: {
                userId: user.id!,
              },
            });
            console.log("[Auth] User settings created/verified for user", user.id);
          } catch (error) {
            console.error("[Auth] Failed to create user settings:", error);
            // Don't throw - settings are not critical for OAuth
          }
        } else {
          console.warn("[Auth] Missing OAuth tokens from provider", {
            userId: user.id,
            provider: account.provider,
            hasAccessToken: !!account.access_token,
            hasRefreshToken: !!account.refresh_token,
          });
        }

        return {
          ...token,
          id: user.id,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at ? account.expires_at * 1000 : 0,
        };
      }

      // Return previous token if the access token has not expired yet
      if (token.accessTokenExpires && Date.now() < (token.accessTokenExpires as number)) {
        return token;
      }

      // Access token has expired, try to refresh it
      console.log("[Auth] Access token expired, refreshing...", {
        userId: token.id,
        expiry: token.accessTokenExpires,
      });
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.accessToken = token.accessToken as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  events: {
    async signIn({ user, account }) {
      if (account?.provider === "google" && user.id) {
        console.log(`[Auth] Sign-in event - User ${user.email} signed in with Google`, {
          userId: user.id,
          hasAccessToken: !!account.access_token,
          hasRefreshToken: !!account.refresh_token,
        });
      }
    },
  },
});

async function refreshAccessToken(token: any) {
  try {
    console.log("[Auth] Refreshing access token", {
      userId: token.id,
      hasRefreshToken: !!token.refreshToken,
    });

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });

    const refreshedTokens = await response.json();

    if (!response.ok) {
      console.error("[Auth] Token refresh failed", {
        status: response.status,
        error: refreshedTokens,
      });
      throw refreshedTokens;
    }

    console.log("[Auth] Token refresh successful", {
      userId: token.id,
      expiresIn: refreshedTokens.expires_in,
    });

    // Update stored tokens
    if (token.id) {
      try {
        await prisma.oAuthToken.update({
          where: {
            userId_provider: {
              userId: token.id,
              provider: "google",
            },
          },
          data: {
            accessTokenEnc: encrypt(refreshedTokens.access_token),
            expiry: new Date(Date.now() + refreshedTokens.expires_in * 1000),
          },
        });
        console.log("[Auth] Updated OAuth token in database", {
          userId: token.id,
        });
      } catch (dbError) {
        console.error("[Auth] Failed to update OAuth token in database:", dbError);
        // Continue even if database update fails - the token is still refreshed in memory
      }
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
    };
  } catch (error) {
    console.error("[Auth] Error refreshing access token:", error);
    return {
      ...token,
      error: "RefreshAccessTokenError",
    };
  }
}

// Extend types
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
    accessToken?: string;
  }

  interface JWT {
    id?: string;
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    error?: string;
  }
}
