export type SessionUser = {
  id: string;
  feishuOpenId: string;
  displayName: string;
  avatarUrl: string | null;
};

export type PublicUser = Pick<SessionUser, "displayName" | "avatarUrl">;

export function toPublicUser(user: SessionUser): PublicUser {
  return { displayName: user.displayName, avatarUrl: user.avatarUrl };
}
