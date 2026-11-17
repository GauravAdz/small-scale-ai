import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

/** GitHub identifies the editor; the separate repository token only publishes data. */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub({ authorization: { params: { scope: "read:user" } } })],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  callbacks: {
    signIn({ profile }) {
      const allowedId = process.env.ADMIN_GITHUB_ID?.trim();
      return Boolean(allowedId && profile?.id && String(profile.id) === allowedId);
    },
    jwt({ token, profile }) {
      if (profile?.id) token.githubId = String(profile.id);
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.id = String(token.githubId ?? "");
      return session;
    },
  },
});

export function adminConfigured(): boolean {
  return Boolean(
    process.env.AUTH_SECRET?.trim() &&
    process.env.AUTH_GITHUB_ID?.trim() &&
    process.env.AUTH_GITHUB_SECRET?.trim() &&
    process.env.ADMIN_GITHUB_ID?.trim() &&
    process.env.ADMIN_GITHUB_TOKEN?.trim(),
  );
}

export async function isAdmin(): Promise<boolean> {
  if (!adminConfigured()) return false;
  const session = await auth();
  return session?.user?.id === process.env.ADMIN_GITHUB_ID?.trim();
}
