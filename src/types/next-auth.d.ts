import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId?: string;
      organizationName?: string;
      role?: string;
      mfaEnrollRequired?: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    organizationId?: string;
    organizationName?: string;
    role?: string;
    tokenVersion?: number;
    mfaEnrollRequired?: boolean;
  }
}
